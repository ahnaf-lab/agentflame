import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../src/config.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentflame-config-'));
}

test('loadConfig applies defaults when only a directory is given', () => {
  const dir = makeTempDir();
  try {
    const config = loadConfig([dir]);
    assert.equal(config.dirPath, dir);
    assert.equal(config.port, 4317);
    assert.equal(config.pollMs, 500);
    assert.ok(config.pattern instanceof RegExp);
    assert.equal(config.pattern.test('session.jsonl'), true);
    assert.equal(config.pattern.test('session.txt'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig takes a positional port over the default', () => {
  const dir = makeTempDir();
  try {
    const config = loadConfig([dir, '9999']);
    assert.equal(config.port, 9999);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig reads dir/port/pollMs/pattern from a --config file', () => {
  const dir = makeTempDir();
  const configPath = join(dir, 'agentflame.json');
  const watchDir = makeTempDir();
  try {
    writeFileSync(
      configPath,
      JSON.stringify({ dir: watchDir, port: 5555, pollMs: 250, pattern: '\\.log$' })
    );

    const config = loadConfig(['--config', configPath]);
    assert.equal(config.dirPath, watchDir);
    assert.equal(config.port, 5555);
    assert.equal(config.pollMs, 250);
    assert.equal(config.pattern.test('a.log'), true);
    assert.equal(config.pattern.test('a.jsonl'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(watchDir, { recursive: true, force: true });
  }
});

test('loadConfig lets a positional arg override the config file', () => {
  const dir = makeTempDir();
  const configPath = join(dir, 'agentflame.json');
  const fileDir = makeTempDir();
  const cliDir = makeTempDir();
  try {
    writeFileSync(configPath, JSON.stringify({ dir: fileDir, port: 5555 }));

    const config = loadConfig(['--config', configPath, cliDir, '6000']);
    assert.equal(config.dirPath, cliDir);
    assert.equal(config.port, 6000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fileDir, { recursive: true, force: true });
    rmSync(cliDir, { recursive: true, force: true });
  }
});

test('loadConfig rejects an out-of-range port', () => {
  const dir = makeTempDir();
  try {
    assert.throws(() => loadConfig([dir, '99999']), /Invalid port/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig rejects malformed JSON in a config file', () => {
  const dir = makeTempDir();
  const configPath = join(dir, 'bad.json');
  try {
    writeFileSync(configPath, '{ not valid json');
    assert.throws(() => loadConfig(['--config', configPath]), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig requires a directory from either source', () => {
  assert.throws(() => loadConfig([]), /No transcripts directory/);
});
