#!/usr/bin/env node
// Watches a directory of Claude Code / agent JSONL transcripts and serves
// both the combined, canonical event timeline (as versioned JSON) and a
// live browser dashboard that polls it: a flame graph of tool calls plus
// running token spend and per-turn latency stats.

import { Tailer } from '../src/tailer.js';
import { startServer } from '../src/server.js';

const dirPath = process.argv[2];
const port = Number(process.argv[3]) || 4317;
const POLL_MS = 500;

if (!dirPath) {
  console.error('Usage: agentflame-serve <transcripts-dir> [port]');
  process.exit(1);
}

const tailer = new Tailer(dirPath);
tailer.scan();

const server = await startServer(tailer, { port });
const address = server.address();
console.log(
  `agentflame watching ${dirPath} -> http://127.0.0.1:${address.port}/`
);

const interval = setInterval(() => tailer.scan(), POLL_MS);

function shutdown() {
  clearInterval(interval);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
