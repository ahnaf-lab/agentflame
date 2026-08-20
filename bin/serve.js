#!/usr/bin/env node
// Watches a directory of Claude Code / agent JSONL transcripts and serves
// the combined, canonical event timeline over HTTP as versioned JSON. The
// browser dashboard that renders this (flame graph, spend, latency) is a
// later milestone; this one is the daemon + endpoint it will read from.

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
  `agentflame watching ${dirPath} -> http://127.0.0.1:${address.port}/api/v1/timeline`
);

const interval = setInterval(() => tailer.scan(), POLL_MS);

function shutdown() {
  clearInterval(interval);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
