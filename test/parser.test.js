import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseLine,
  parseTranscript,
  dedupeRecords,
  buildTimeline,
  buildTimelineFromFile,
  totalUsage,
} from '../src/parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'session.jsonl');

test('parseLine skips blank lines and malformed JSON', () => {
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('{not valid json'), null);
  assert.deepEqual(parseLine('{"a":1}'), { a: 1 });
});

test('parseTranscript keeps only valid object records', () => {
  const text = '{"a":1}\n\n{not json\n{"b":2}\n';
  const records = parseTranscript(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { a: 1 });
  assert.deepEqual(records[1], { b: 2 });
});

test('dedupeRecords collapses streaming duplicates by requestId, keeping the fullest copy', () => {
  const records = [
    { type: 'assistant', requestId: 'r1', uuid: 'a', message: { content: [{ type: 'text', text: 'partial' }] } },
    { type: 'assistant', requestId: 'r1', uuid: 'a', message: { content: [{ type: 'text', text: 'partial and more' }] } },
    { type: 'user', uuid: 'u1', message: { content: 'hi' } },
  ];
  const deduped = dedupeRecords(records);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].message.content[0].text, 'partial and more');
  assert.equal(deduped[1].uuid, 'u1');
});

test('buildTimeline dedupes the fixture transcript to one message per logical turn', () => {
  const fs = readFixture();
  const timeline = buildTimeline(fs);
  const messages = timeline.filter((e) => e.type === 'message');

  // Two streaming copies of the "I'll check the files." turn must collapse
  // into exactly one message event, and it must carry the fuller text.
  const assistantTurn = messages.find((m) => m.role === 'assistant' && m.text.includes("I'll"));
  assert.ok(assistantTurn, 'expected the deduped assistant turn to be present');
  assert.equal(assistantTurn.text, "I'll check the files.");

  // A user record that is only a tool_result carries no message event.
  const toolResultAsMessage = messages.find((m) => m.text === 'README.md\nsrc/\ntest/');
  assert.equal(toolResultAsMessage, undefined);
});

test('buildTimeline links tool_use blocks to their tool_result and computes latency', () => {
  const timeline = buildTimeline(readFixture());
  const call = timeline.find((e) => e.type === 'tool_call' && e.toolUseId === 'tool_1');

  assert.ok(call, 'expected a tool_call event for tool_1');
  assert.equal(call.name, 'bash');
  assert.deepEqual(call.input, { command: 'ls' });
  assert.equal(call.output, 'README.md\nsrc/\ntest/');
  assert.equal(call.ok, true);
  assert.equal(call.durationMs, 700);
});

test('buildTimeline marks failed tool results and preserves sidechain flag', () => {
  const timeline = buildTimeline(readFixture());
  const call = timeline.find((e) => e.type === 'tool_call' && e.toolUseId === 'tool_2');

  assert.ok(call);
  assert.equal(call.ok, false);
  assert.equal(call.sidechain, true);
  assert.equal(call.durationMs, 1000);
});

test('buildTimeline is sorted by timestamp', () => {
  const timeline = buildTimeline(readFixture());
  const timestamps = timeline.map((e) => Date.parse(e.timestamp)).filter(Number.isFinite);
  for (let i = 1; i < timestamps.length; i++) {
    assert.ok(timestamps[i] >= timestamps[i - 1], 'timeline must be time-ordered');
  }
});

test('buildTimelineFromFile matches buildTimeline on the same content', () => {
  const fromFile = buildTimelineFromFile(fixturePath);
  const fromText = buildTimeline(readFixture());
  assert.deepEqual(fromFile, fromText);
});

test('totalUsage sums token usage across deduped message events only', () => {
  const timeline = buildTimeline(readFixture());
  const usage = totalUsage(timeline);
  // req_1 (deduped to its final copy, 120/18) + req_2 (140/12) + req_3 (50/10)
  assert.equal(usage.inputTokens, 120 + 140 + 50);
  assert.equal(usage.outputTokens, 18 + 12 + 10);
});

function readFixture() {
  return readFileSync(fixturePath, 'utf8');
}
