# agentflame

A daemon that tails local Claude Code / agent JSONL transcripts as they're
written and serves a live browser dashboard: a flame graph of tool calls,
running token spend, and per-turn latency. Built for watching an agent run
happen in real time instead of reading a scrollback log after the fact.

This milestone adds a live browser dashboard: a page served at `/` that
polls the timeline endpoint on an interval, redraws a stats bar (sessions,
tool call counts by outcome, token spend, latency) and re-fetches the flame
graph whenever the tailer's `version` counter changes, and otherwise leaves
the screen untouched. The poll/redraw logic (`src/dashboard.js`) is a pure
function of the JSON it's given - no DOM APIs, no timers, no `fetch` of its
own - so the exact same module runs in the browser (served byte-for-byte at
`/dashboard.js`) and in the test suite, which drives it with a scripted
sequence of fixture responses and asserts the output is byte-identical
whenever nothing changed and updates correctly when it did.

A separate, earlier milestone renders the flame graph itself: a static SVG
of a timeline's tool calls, one row for the main chain, one row for
sidechain (sub-agent) calls, bar position from wall-clock start time, bar
width from duration, and color from outcome (green ok, red failed, grey
still pending). Rendering is pure and deterministic - no timestamps or
randomness of its own - which is what lets the test suite assert on the
exact SVG bytes rather than just "it rendered something".

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
node bin/serve.js --config path/to/agentflame.json
```

This starts a daemon that polls the directory for `*.jsonl` files, reading
only the bytes appended since the last poll (never re-parsing a whole
transcript from scratch), and serves the combined result:

- `GET /` — the live dashboard: a stats bar plus the flame graph, redrawn
  in the browser once per second by polling the endpoints below.
- `GET /dashboard.js` — the dashboard's client-side module, served as-is
  from `src/dashboard.js` (see below).
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

Open `http://127.0.0.1:<port>/` in a browser to watch an agent run live.

### Config file

Settings can also come from a JSON file instead of CLI args, resolved in
`src/config.js`:

```json
{
  "dir": "/path/to/transcripts-dir",
  "port": 4317,
  "pollMs": 500,
  "pattern": "\\.jsonl$"
}
```

```
node bin/serve.js --config path/to/agentflame.json
```

Precedence is defaults, then the config file, then positional CLI args - so
`node bin/serve.js --config agentflame.json /other/dir` watches `/other/dir`
even if the file says otherwise. `pattern` is a string compiled into a
`RegExp` used to select which files in the directory are tailed.

### Shutdown

`bin/serve.js` treats `SIGINT`/`SIGTERM` as a request to drain, not a signal
to ignore: it stops polling, stops accepting new connections, closes idle
keep-alive sockets, and exits `0` once the server has fully closed. If a
client holds a connection open past 5 seconds, remaining sockets are
force-closed and the process exits `1` rather than hanging indefinitely.
Startup fails fast (nonzero exit, message on stderr) if the watched
directory doesn't exist or the port can't be bound, rather than starting a
daemon that silently does nothing.

### The dashboard's poll/redraw loop

`src/dashboard.js` has no dependency on Node or a real DOM: `computeStats`
reduces a `/api/v1/timeline` body to plain numbers, `renderStatsHTML` turns
those numbers into markup, and `createDashboard` wires a `fetchTimeline` /
`fetchFlame` pair to a `statsMount` / `flameMount` pair (anything with an
`innerHTML` property) and exposes a single `poll()` that redraws only when
the tailer's `version` has moved. `src/index.html` imports this module
directly as a browser ES module - there is no build step and no bundler -
and `test/dashboard.test.js` imports the same file and drives it with a
scripted sequence of fixture responses to assert the redraw is
deterministic: identical input produces byte-identical markup, an
unchanged version is a no-op, and a changed version updates both the stats
bar and the flame graph.

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

Built autonomously, gated on passing tests — every change
is required to build cleanly and pass a real test suite before it ships.
