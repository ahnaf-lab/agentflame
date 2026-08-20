#!/usr/bin/env node
// Watches a directory of Claude Code / agent JSONL transcripts and serves
// both the combined, canonical event timeline (as versioned JSON) and a
// live browser dashboard that polls it: a flame graph of tool calls plus
// running token spend and per-turn latency stats.
//
// Usage:
//   agentflame-serve <transcripts-dir> [port]
//   agentflame-serve --config path/to/agentflame.json
//
// A config file (JSON, `--config <path>`) may set `dir`, `port`, `pollMs`
// and `pattern`; positional CLI args, when given, take priority over it.

import { statSync } from 'node:fs';
import { Tailer } from '../src/tailer.js';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

let config;
try {
  config = loadConfig(process.argv.slice(2));
} catch (err) {
  console.error(`agentflame: ${err.message}`);
  console.error('Usage: agentflame-serve <transcripts-dir> [port] [--config <path>]');
  process.exit(1);
}

try {
  const stat = statSync(config.dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`'${config.dirPath}' is not a directory`);
  }
} catch (err) {
  console.error(`agentflame: cannot watch '${config.dirPath}': ${err.message}`);
  process.exit(1);
}

const tailer = new Tailer(config.dirPath, { pattern: config.pattern });
tailer.scan();

let server;
try {
  server = await startServer(tailer, { port: config.port });
} catch (err) {
  console.error(`agentflame: failed to start server: ${err.message}`);
  process.exit(1);
}

const address = server.address();
console.log(
  `agentflame watching ${config.dirPath} -> http://127.0.0.1:${address.port}/`
);

const interval = setInterval(() => {
  try {
    tailer.scan();
  } catch (err) {
    console.error(`agentflame: scan failed: ${err.message}`);
  }
}, config.pollMs);

// Track open sockets so shutdown can close idle keep-alive connections
// rather than waiting on a client that never disconnects.
const sockets = new Set();
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

const SHUTDOWN_TIMEOUT_MS = 5000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`agentflame: received ${signal}, shutting down`);

  clearInterval(interval);

  const forceExit = setTimeout(() => {
    console.error('agentflame: shutdown timed out, forcing exit');
    for (const socket of sockets) socket.destroy();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });

  // server.close() stops accepting new connections but waits for existing
  // keep-alive sockets to end on their own. Nudge them closed so a client
  // sitting idle doesn't hold the process open until the force-exit timer.
  for (const socket of sockets) socket.end();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
