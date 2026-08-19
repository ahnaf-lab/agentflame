// Parses Claude Code / agent JSONL transcripts into a canonical, deduped
// event timeline: text messages, tool calls (linked to their results and
// latency), and per-turn token usage.
//
// Transcript lines look like the Anthropic Messages API shape, one JSON
// object per line:
//   {"type":"user","message":{"role":"user","content":"..."},
//    "uuid":"...","timestamp":"..."}
//   {"type":"assistant","message":{"role":"assistant","content":[...],
//    "usage":{...}},"uuid":"...","requestId":"req_1","timestamp":"..."}
//
// Two real quirks this module exists to handle:
//
// 1. Streaming duplicates: a single assistant turn is written to the file
//    multiple times while it streams, each copy under the same requestId
//    with the same cumulative usage but growing content. Only the final
//    (fullest) copy should survive into the timeline.
// 2. Tool calls and their results are two separate records (an assistant
//    "tool_use" block, later a user "tool_result" block carrying the same
//    tool_use_id) that need to be linked back together to compute latency.

import { readFileSync } from 'node:fs';

/**
 * Parse a single JSONL line into an object, or null if the line is blank
 * or not valid JSON. Malformed lines are skipped rather than thrown on,
 * since a transcript being tailed live can contain a partially written
 * final line.
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}

/** Parse full JSONL text into an array of raw record objects. */
export function parseTranscript(text) {
  const records = [];
  for (const line of text.split('\n')) {
    const record = parseLine(line);
    if (record) records.push(record);
  }
  return records;
}

/** Read a transcript file from disk and parse it. */
export function loadTranscript(filePath) {
  return parseTranscript(readFileSync(filePath, 'utf8'));
}

/**
 * Build a stable dedup key for a raw record.
 *
 * Assistant records are keyed by requestId, because a single logical turn
 * is rewritten several times while streaming. Everything else is keyed by
 * its own uuid, since each user message / tool result is written exactly
 * once. Records with neither fall back to their line index so they are
 * never silently dropped.
 */
function dedupeKey(record, index) {
  if (record.type === 'assistant' && record.requestId) {
    return `req:${record.requestId}`;
  }
  if (record.uuid) return `uuid:${record.uuid}`;
  return `idx:${index}`;
}

/**
 * Collapse streaming duplicates. Map#set on an existing key updates the
 * value but keeps the key's original insertion position, so this keeps
 * records in first-seen order while retaining the *last* (fullest) copy
 * of each duplicated turn.
 */
export function dedupeRecords(records) {
  const byKey = new Map();
  records.forEach((record, index) => {
    byKey.set(dedupeKey(record, index), record);
  });
  return [...byKey.values()];
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function blocksFromContent(content) {
  return Array.isArray(content) ? content : [];
}

function usageFromMessage(message) {
  const usage = message && message.usage;
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Turn deduped raw records into canonical timeline events. Each event has
 * a `type` of "message" or "tool_call".
 *
 * User records whose content is entirely tool_result blocks produce no
 * "message" event of their own (there is no user-authored text to show);
 * their tool_result blocks are instead used to fill in the matching
 * tool_call's output, duration, and status.
 */
export function canonicalize(records) {
  const events = [];
  const pendingCallsById = new Map();

  records.forEach((record, index) => {
    const message = record.message || {};
    const role = message.role || record.type;
    const blocks = blocksFromContent(message.content);
    const timestamp = record.timestamp ?? null;
    const sidechain = record.isSidechain === true;

    const toolResultBlocks = blocks.filter((b) => b && b.type === 'tool_result');
    const toolUseBlocks = blocks.filter((b) => b && b.type === 'tool_use');
    const text = textFromContent(message.content);

    // Link tool results back to their calls.
    for (const block of toolResultBlocks) {
      const call = pendingCallsById.get(block.tool_use_id);
      if (!call) continue;
      call.output = typeof block.content === 'string' ? block.content : block.content ?? null;
      call.ok = block.is_error !== true;
      call.endTimestamp = timestamp;
      if (call.timestamp && timestamp) {
        const duration = Date.parse(timestamp) - Date.parse(call.timestamp);
        call.durationMs = Number.isFinite(duration) ? duration : null;
      }
    }

    // A record made only of tool_result blocks carries no message text of
    // its own; skip emitting a message event for it.
    const isToolResultOnly = toolResultBlocks.length > 0 && text.trim() === '' && toolUseBlocks.length === 0;

    if (!isToolResultOnly && (text.trim() !== '' || record.type === 'summary')) {
      events.push({
        type: 'message',
        role,
        text,
        timestamp,
        uuid: record.uuid ?? null,
        parentUuid: record.parentUuid ?? null,
        sidechain,
        tokens: usageFromMessage(message),
        seq: index,
      });
    }

    for (const block of toolUseBlocks) {
      const call = {
        type: 'tool_call',
        name: block.name,
        input: block.input ?? null,
        toolUseId: block.id,
        timestamp,
        endTimestamp: null,
        durationMs: null,
        output: null,
        ok: null,
        uuid: record.uuid ?? null,
        sidechain,
        seq: index,
      };
      pendingCallsById.set(block.id, call);
      events.push(call);
    }
  });

  return events;
}

function compareEvents(a, b) {
  const ta = a.timestamp ? Date.parse(a.timestamp) : NaN;
  const tb = b.timestamp ? Date.parse(b.timestamp) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
  return a.seq - b.seq;
}

/**
 * Full pipeline: raw JSONL text -> canonical, deduped, time-ordered event
 * timeline. This is the main entry point most callers want.
 */
export function buildTimeline(text) {
  const records = parseTranscript(text);
  const deduped = dedupeRecords(records);
  const events = canonicalize(deduped);
  events.sort(compareEvents);
  return events.map(({ seq, ...event }) => event);
}

/** Same as buildTimeline, but reads the transcript from a file path. */
export function buildTimelineFromFile(filePath) {
  return buildTimeline(readFileSync(filePath, 'utf8'));
}

/** Sum token usage across all message events in a timeline. */
export function totalUsage(timeline) {
  const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const event of timeline) {
    if (event.type !== 'message' || !event.tokens) continue;
    total.inputTokens += event.tokens.inputTokens;
    total.outputTokens += event.tokens.outputTokens;
    total.cacheReadTokens += event.tokens.cacheReadTokens;
    total.cacheCreationTokens += event.tokens.cacheCreationTokens;
  }
  return total;
}
