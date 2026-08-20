import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTimeline } from '../src/parser.js';
import { renderFlameSVG } from '../src/flame.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'session.jsonl');

function readFixture() {
  return readFileSync(fixturePath, 'utf8');
}

// The exact bytes agentflame-flame produced for the fixture transcript at
// the time this test was written. If the render logic changes on purpose,
// regenerate with `node bin/flame.js test/fixtures/session.jsonl` and
// paste the new output back in here - a diff in this string is the point
// of the test.
const EXPECTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="68" viewBox="0 0 960 68" font-family="monospace" font-size="11">
<rect x="0" y="0" width="960" height="68" fill="#1e1e1e"/>
<rect x="10.00" y="10" width="146.22" height="22" fill="#4caf7d" stroke="#1e1e1e" stroke-width="0.5"><title>bash 700ms</title></rect>
<text x="13.00" y="26.00" fill="#0b0b0b">bash</text>
<rect x="741.11" y="34" width="208.89" height="22" fill="#e05252" stroke="#1e1e1e" stroke-width="0.5"><title>grep 1000ms</title></rect>
<text x="744.11" y="50.00" fill="#0b0b0b">grep</text>
</svg>`;

test('renderFlameSVG matches the exact byte snapshot for the fixture transcript', () => {
  const timeline = buildTimeline(readFixture());
  const svg = renderFlameSVG(timeline);
  assert.equal(svg, EXPECTED_SVG);
});

test('renderFlameSVG is deterministic: same input always produces the same bytes', () => {
  const timeline = buildTimeline(readFixture());
  const first = renderFlameSVG(timeline);
  const second = renderFlameSVG(buildTimeline(readFixture()));
  assert.equal(first, second);
});

test('renderFlameSVG draws one rect per tool_call, colored by outcome', () => {
  const timeline = buildTimeline(readFixture());
  const svg = renderFlameSVG(timeline);

  // Two tool_call events in the fixture: tool_1 (bash, succeeded) and
  // tool_2 (grep, failed) - the pending, still-unresolved sidechain call
  // never gets a matching tool_result in the fixture and so is dropped for
  // lack of a resolvable end, which is exercised separately below.
  const rectCount = (svg.match(/<rect /g) || []).length;
  assert.equal(rectCount, 3, 'background rect + 2 tool_call bars');
  assert.match(svg, /fill="#4caf7d"/, 'successful call renders green');
  assert.match(svg, /fill="#e05252"/, 'failed call renders red');
});

test('renderFlameSVG places sidechain calls on a lower row than main-chain calls', () => {
  const timeline = buildTimeline(readFixture());
  const svg = renderFlameSVG(timeline);

  const bashY = /y="10" width="146\.22"/.test(svg);
  const grepY = /y="34" width="208\.89"/.test(svg);
  assert.ok(bashY, 'main-chain call sits in row 0');
  assert.ok(grepY, 'sidechain call sits one row below');
});

test('renderFlameSVG renders a placeholder for a timeline with no tool calls', () => {
  const svg = renderFlameSVG([{ type: 'message', role: 'user', text: 'hi', timestamp: null }]);
  assert.match(svg, /no tool calls/);
  assert.equal((svg.match(/<rect /g) || []).length, 1, 'only the background rect');
});

test('renderFlameSVG escapes tool names that contain XML-sensitive characters', () => {
  const svg = renderFlameSVG([
    {
      type: 'tool_call',
      name: '<script>&"\'',
      input: null,
      toolUseId: 't1',
      timestamp: '2026-08-20T00:00:00.000Z',
      endTimestamp: '2026-08-20T00:00:01.000Z',
      durationMs: 1000,
      output: null,
      ok: true,
      uuid: 'u1',
      sidechain: false,
    },
  ]);
  assert.ok(!svg.includes('<script>'), 'raw tag must not appear unescaped');
  assert.match(svg, /&lt;script&gt;&amp;&quot;&apos;/);
});
