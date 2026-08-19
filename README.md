# agentflame

A daemon that tails local Claude Code / agent JSONL transcripts as they're
written and serves a live browser dashboard: a flame graph of tool calls,
running token spend, and per-turn latency. Built for watching an agent run
happen in real time instead of reading a scrollback log after the fact.

This milestone ships the trace parser: it turns a raw transcript JSONL file
into a canonical, deduped event timeline. The live-tailing daemon and the
dashboard itself are later milestones and are not implemented yet.

Two real quirks the parser exists to handle:

- **Streaming duplicates** — a single assistant turn is rewritten to the
  transcript multiple times while it streams, each copy under the same
  `requestId` with the same cumulative token usage but growing text. The
  parser collapses these into one event, keeping the fullest copy.
- **Split tool calls** — a tool call and its result are two separate
  records (a `tool_use` block, later a `tool_result` block carrying the
  same `tool_use_id`). The parser links them back together and computes
  the latency between them.

## Install

Requires Node.js 18+. No external dependencies.

```
npm install
```

## Usage

Programmatically:

```js
import { buildTimelineFromFile, totalUsage } from './src/parser.js';

const timeline = buildTimelineFromFile('path/to/transcript.jsonl');
console.log(timeline);        // canonical, deduped, time-ordered events
console.log(totalUsage(timeline)); // summed token usage across the run
```

From the command line:

```
node bin/parse.js path/to/transcript.jsonl
```

This prints the parsed timeline as JSON: an ordered list of `message` and
`tool_call` events, where each `tool_call` carries its linked output,
`durationMs`, and success flag once its result has been seen.

## Status

Built autonomously with Claude Code, gated on passing tests — every change
is required to build cleanly and pass a real test suite before it ships.
