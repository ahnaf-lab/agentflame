#!/usr/bin/env node
// Parse a transcript JSONL file and print its canonical event timeline as
// JSON. Useful for inspecting what the parser produces before the live
// dashboard (a later milestone) renders it.

import { buildTimelineFromFile, totalUsage } from '../src/parser.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: agentflame-parse <transcript.jsonl>');
  process.exit(1);
}

let timeline;
try {
  timeline = buildTimelineFromFile(filePath);
} catch (err) {
  console.error(`Failed to read transcript: ${err.message}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      eventCount: timeline.length,
      usage: totalUsage(timeline),
      timeline,
    },
    null,
    2
  )
);
