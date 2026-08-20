# agentflame

A daemon that tails local Claude Code / agent JSONL transcripts as they're
written and serves a live browser dashboard: a flame graph of tool calls,
running token spend, and per-turn latency. Built for watching an agent run
happen in real time instead of reading a scrollback log after the fact.

This milestone adds a static SVG flame graph render of a timeline's tool
calls: one row for the main chain, one row for sidechain (sub-agent) calls,
bar position from wall-clock start time, bar width from duration, and color
from outcome (green ok, red failed, grey still pending). Rendering is pure
and deterministic - no timestamps or randomness of its own - which is what
lets the test suite assert on the exact SVG bytes rather than just "it
rendered something". The interactive browser dashboard (live-updating view,
spend and latency charts) is a later milestone and is not implemented yet.

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

### Watching a directory and serving it over HTTP

```
node bin/serve.js path/to/transcripts-dir [port]
```

This starts a daemon that polls the directory for `*.jsonl` files, reading
only the bytes appended since the last poll (never re-parsing a whole
transcript from scratch), and serves the combined result:

- `GET /api/v1/timeline` — every tracked session's canonical timeline and
  summed token usage, plus a `version` counter that increments each time
  new data is read. Poll this and compare `version` instead of diffing the
  body.
- `GET /api/v1/flame.svg` — a static SVG flame graph (`image/svg+xml`) of
  every tracked session's tool calls, merged into one time-ordered view.
- `GET /api/v1/health` — `{"status":"ok"}`, for liveness checks.

The `v1` in the path is the endpoint's own version: the response shape can
grow new fields freely, but a breaking change gets a `v2` path rather than
changing `v1` under existing clients.

### Rendering a flame graph directly

```
node bin/flame.js path/to/transcript.jsonl > flame.svg
```

Renders the same flame graph the server endpoint produces, without needing
a running daemon — useful for previewing a single transcript. Only
`tool_call` events with a resolvable timestamp are drawn; each bar's x
position is its start time relative to the first tool call, its width is
duration (or a small minimum for near-instant / still-pending calls), its
row is 0 for the main chain and 1 for sidechain (sub-agent) calls, and its
color reflects outcome: green succeeded, red failed, grey still pending.

## Status

Built autonomously with Claude Code, gated on passing tests — every change
is required to build cleanly and pass a real test suite before it ships.
