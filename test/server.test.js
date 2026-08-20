import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Tailer } from '../src/tailer.js';
import { startServer } from '../src/server.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'agentflame-server-'));
}

async function closeServer(server) {
  if (server) await new Promise((resolve) => server.close(resolve));
}

test('GET /api/v1/timeline returns the current tailer state as JSON', async () => {
  const dir = makeTempDir();
  let server;
  try {
    writeFileSync(join(dir, 'session.jsonl'), '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n');
    const tailer = new Tailer(dir);
    tailer.scan();

    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/timeline`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');

    const body = await res.json();
    assert.equal(body.version, 1);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].timeline.length, 1);
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/v1/timeline reflects a later scan without restarting the server', async () => {
  const dir = makeTempDir();
  let server;
  try {
    const filePath = join(dir, 'session.jsonl');
    writeFileSync(filePath, '{"type":"user","uuid":"u1","message":{"content":"hi"}}\n');
    const tailer = new Tailer(dir);
    tailer.scan();

    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const first = await (await fetch(`http://127.0.0.1:${port}/api/v1/timeline`)).json();
    assert.equal(first.version, 1);

    appendFileSync(filePath, '{"type":"user","uuid":"u2","message":{"content":"again"}}\n');
    tailer.scan();

    const second = await (await fetch(`http://127.0.0.1:${port}/api/v1/timeline`)).json();
    assert.equal(second.version, 2);
    assert.equal(second.sessions[0].timeline.length, 2);
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/v1/health reports ok', async () => {
  const dir = makeTempDir();
  let server;
  try {
    const tailer = new Tailer(dir);
    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET / serves the dashboard HTML page', async () => {
  const dir = makeTempDir();
  let server;
  try {
    const tailer = new Tailer(dir);
    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /<div id="stats">/);
    assert.match(body, /dashboard\.js/);
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /dashboard.js serves the client module as JavaScript', async () => {
  const dir = makeTempDir();
  let server;
  try {
    const tailer = new Tailer(dir);
    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/dashboard.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.match(body, /export function createDashboard/);
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown routes return 404 with a JSON body', async () => {
  const dir = makeTempDir();
  let server;
  try {
    const tailer = new Tailer(dir);
    server = await startServer(tailer, { port: 0 });
    const { port } = server.address();

    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not found');
  } finally {
    await closeServer(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
