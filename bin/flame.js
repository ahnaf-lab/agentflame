#!/usr/bin/env node
// Render a transcript's tool calls as a static SVG flame graph and print it
// to stdout. Useful for previewing what /api/v1/flame.svg will return
// without starting the server.

import { buildTimelineFromFile } from '../src/parser.js';
import { renderFlameSVG } from '../src/flame.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: agentflame-flame <transcript.jsonl>');
  process.exit(1);
}

let timeline;
try {
  timeline = buildTimelineFromFile(filePath);
} catch (err) {
  console.error(`Failed to read transcript: ${err.message}`);
  process.exit(1);
}

console.log(renderFlameSVG(timeline));
