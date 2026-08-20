import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Tailer } from '../src/tailer.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentflame-tailer-'));
}

test('scan() picks up a new file and bumps the version by one', () => {
  const dir = makeTempDir();
  try {
    const tailer = new Tailer(dir);
    assert.equal(tailer.scan(), 0, 'empty directory produces no change');

    writeFileSync(
      join(dir, 'session.jsonl'),
      '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    );
    assert.equal(tailer.scan(), 1);

    const state = tailer.getState();
    assert.equal(state.version, 1);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].file, 'session.jsonl');
    assert.equal(state.sessions[0].timeline.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan() only reads the bytes appended since the last scan', () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, 'session.jsonl');
    writeFileSync(filePath, '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n');

    const tailer = new Tailer(dir);
    tailer.scan();
    assert.equal(tailer.getState().sessions[0].timeline.length, 1);

    appendFileSync(
      filePath,
      '{"type":"user","uuid":"u2","message":{"content":"again"}}\n'
    );
    assert.equal(tailer.scan(), 2, 'appended bytes bump the version again');

    const after = tailer.getState();
    assert.equal(after.sessions[0].timeline.length, 2);
    assert.equal(after.sessions[0].timeline[1].text, 'again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan() ignores non-jsonl files and is a no-op when nothing changed', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'notes.txt'), 'not a transcript');
    const tailer = new Tailer(dir);

    assert.equal(tailer.scan(), 0);
    assert.deepEqual(tailer.getState().sessions, []);
    assert.equal(tailer.scan(), 0, 'repeated scans with no new data stay at version 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scan() restarts a file from scratch if it shrinks (rotation)', () => {
  const dir = makeTempDir();
  try {
    const filePath = join(dir, 'session.jsonl');
    writeFileSync(
      filePath,
      '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n' +
        '{"type":"user","uuid":"u2","message":{"content":"again"}}\n'
    );

    const tailer = new Tailer(dir);
    tailer.scan();
    assert.equal(tailer.getState().sessions[0].timeline.length, 2);

    writeFileSync(filePath, '{"type":"user","uuid":"u3","message":{"content":"rotated"}}\n');
    tailer.scan();

    const state = tailer.getState();
    assert.equal(state.sessions[0].timeline.length, 1);
    assert.equal(state.sessions[0].timeline[0].text, 'rotated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getState() tracks multiple session files independently, sorted by name', () => {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'b.jsonl'), '{"type":"user","uuid":"u1","message":{"content":"b"}}\n');
    writeFileSync(join(dir, 'a.jsonl'), '{"type":"user","uuid":"u2","message":{"content":"a"}}\n');

    const tailer = new Tailer(dir);
    tailer.scan();

    const state = tailer.getState();
    assert.equal(state.sessions.length, 2);
    assert.deepEqual(
      state.sessions.map((s) => s.file),
      ['a.jsonl', 'b.jsonl']
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
