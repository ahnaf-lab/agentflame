// Spawns bin/serve.js as a real child process against a temp directory and
// drives it purely over HTTP + signals, the way an actual user/launchd
// would - no importing the daemon's internals. Covers the things a unit
// test of the modules can't: the CLI/config wiring actually starts a
// server, and the process actually exits on SIGTERM instead of hanging.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVE_BIN = join(__dirname, '..', 'bin', 'serve.js');

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentflame-integration-'));
}

/** Wait for the daemon to print its "watching ... -> http://..." line and
 * pull the port back out of it, rather than guessing a fixed port and
 * racing the child's startup. */
function waitForListening(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`daemon did not report listening within ${timeoutMs}ms; output so far: ${output}`));
    }, timeoutMs);

    function onData(chunk) {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(Number(match[1]));
      }
    }
    child.stdout.on('data', onData);
  });
}

function waitForExit(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`daemon did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('spawned daemon serves the API and shuts down cleanly on SIGTERM', async () => {
  const dir = makeTempDir();
  let child;
  try {
    writeFileSync(
      join(dir, 'session.jsonl'),
      '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n'
    );

    child = spawn(process.execPath, [SERVE_BIN, dir, '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const port = await waitForListening(child);

    const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const timelineRes = await fetch(`http://127.0.0.1:${port}/api/v1/timeline`);
    assert.equal(timelineRes.status, 200);
    const timeline = await timelineRes.json();
    assert.equal(timeline.sessions.length, 1);
    assert.equal(timeline.sessions[0].timeline.length, 1);

    const flameRes = await fetch(`http://127.0.0.1:${port}/api/v1/flame.svg`);
    assert.equal(flameRes.status, 200);
    assert.match(flameRes.headers.get('content-type'), /image\/svg\+xml/);

    child.kill('SIGTERM');
    const { code, signal } = await waitForExit(child);
    child = null;

    assert.equal(code, 0, `expected clean exit, got code=${code} signal=${signal} stderr=${stderr}`);
  } finally {
    if (child) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spawned daemon refuses a nonexistent directory with a clear error and nonzero exit', async () => {
  const missingDir = join(tmpdir(), 'agentflame-does-not-exist-xyz');
  const child = spawn(process.execPath, [SERVE_BIN, missingDir, '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const { code } = await waitForExit(child);
  assert.notEqual(code, 0);
  assert.match(stderr, /cannot watch/);
});
