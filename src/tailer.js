// Watches a directory of Claude Code / agent JSONL transcripts, tracking
// per-file byte offsets so a live-tailing daemon only ever reads the bytes
// appended since the last scan rather than re-reading whole files on every
// poll.
//
// scan() is synchronous and side-effect-free beyond updating internal
// state, so it can be driven either by a setInterval in a long-running
// daemon or called directly (as the tests do) for deterministic behaviour.

import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { buildTimeline, totalUsage } from './parser.js';

const DEFAULT_PATTERN = /\.jsonl$/;

export class Tailer {
  constructor(dirPath, { pattern = DEFAULT_PATTERN } = {}) {
    this.dirPath = dirPath;
    this.pattern = pattern;
    this.files = new Map(); // filename -> { size, text }
    this.version = 0;
  }

  /**
   * Scan the directory for new or grown *.jsonl files, reading only the
   * bytes appended since the last scan. Returns the current version, which
   * is bumped by exactly one if anything changed. Missing/unreadable
   * directories and files are treated as "no change" rather than thrown,
   * since a transcript being written can briefly disappear/rotate.
   */
  scan() {
    let changed = false;
    let entries;
    try {
      entries = readdirSync(this.dirPath);
    } catch {
      return this.version;
    }

    for (const name of entries) {
      if (!this.pattern.test(name)) continue;
      const filePath = join(this.dirPath, name);
      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      let entry = this.files.get(name);
      if (!entry) {
        entry = { size: 0, text: '' };
        this.files.set(name, entry);
      }

      if (stat.size > entry.size) {
        entry.text += readChunk(filePath, entry.size, stat.size);
        entry.size = stat.size;
        changed = true;
      } else if (stat.size < entry.size) {
        // File shrank: treat as truncated/rotated and restart from scratch
        // rather than trying to compute a diff against stale bytes.
        entry.text = readChunk(filePath, 0, stat.size);
        entry.size = stat.size;
        changed = true;
      }
    }

    if (changed) this.version += 1;
    return this.version;
  }

  /** Build the current combined state for every tracked file. */
  getState() {
    const sessions = [];
    for (const [name, entry] of this.files) {
      const timeline = buildTimeline(entry.text);
      sessions.push({
        file: name,
        eventCount: timeline.length,
        usage: totalUsage(timeline),
        timeline,
      });
    }
    sessions.sort((a, b) => a.file.localeCompare(b.file));
    return {
      version: this.version,
      generatedAt: new Date().toISOString(),
      sessions,
    };
  }
}

function readChunk(filePath, start, end) {
  const length = end - start;
  if (length <= 0) return '';
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}
