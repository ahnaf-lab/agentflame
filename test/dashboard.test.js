import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStats, renderStatsHTML, createDashboard } from '../src/dashboard.js';

function fixtureState(overrides = {}) {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sessions: [
      {
        file: 'a.jsonl',
        usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 },
        timeline: [
          { type: 'message', role: 'user', text: 'hi' },
          { type: 'tool_call', name: 'Read', ok: true, durationMs: 120 },
          { type: 'tool_call', name: 'Bash', ok: false, durationMs: 40 },
          { type: 'tool_call', name: 'Grep', ok: null, durationMs: null },
        ],
      },
    ],
    ...overrides,
  };
}

test('computeStats reduces sessions into flat, deterministic totals', () => {
  const stats = computeStats(fixtureState());
  assert.equal(stats.version, 1);
  assert.equal(stats.sessionCount, 1);
  assert.equal(stats.callCount, 3);
  assert.equal(stats.okCount, 1);
  assert.equal(stats.errorCount, 1);
  assert.equal(stats.pendingCount, 1);
  assert.equal(stats.totalTokens, 140);
  assert.equal(stats.avgLatencyMs, 80); // (120 + 40) / 2, pending call excluded
  assert.equal(stats.maxLatencyMs, 120);
});

test('computeStats tolerates missing/empty state rather than throwing', () => {
  assert.equal(computeStats(undefined).sessionCount, 0);
  assert.equal(computeStats({}).callCount, 0);
  assert.equal(computeStats({ sessions: [] }).totalTokens, 0);
});

test('renderStatsHTML is pure: identical stats produce byte-identical markup', () => {
  const stats = computeStats(fixtureState());
  const first = renderStatsHTML(stats);
  const second = renderStatsHTML(computeStats(fixtureState()));
  assert.equal(first, second);
  assert.match(first, /tool calls<\/dt><dd>3 \(1 ok, 1 failed, 1 pending\)<\/dd>/);
});

test('renderStatsHTML escapes untrusted-looking text fields', () => {
  const stats = computeStats(fixtureState({ generatedAt: '<script>alert(1)</script>' }));
  const html = renderStatsHTML(stats);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('createDashboard redraws on a scripted fixture feed exactly when the version changes', async () => {
  // Three canned /api/v1/timeline responses simulating successive polls:
  // same version twice in a row (agent idle), then a new version.
  const feed = [fixtureState({ version: 1 }), fixtureState({ version: 1 }), fixtureState({ version: 2 })];
  const flameFeed = ['<svg id="a"/>', '<svg id="a"/>', '<svg id="b"/>'];
  let call = 0;

  const statsMount = { innerHTML: '' };
  const flameMount = { innerHTML: '' };

  const dashboard = createDashboard({
    fetchTimeline: async () => feed[call],
    fetchFlame: async () => flameFeed[call],
    statsMount,
    flameMount,
  });

  call = 0;
  const redrew1 = await dashboard.poll();
  assert.equal(redrew1, true);
  const afterFirst = statsMount.innerHTML;
  assert.match(afterFirst, /<dt>version<\/dt><dd>1<\/dd>/);
  assert.equal(flameMount.innerHTML, '<svg id="a"/>');

  call = 1;
  const redrew2 = await dashboard.poll();
  assert.equal(redrew2, false, 'unchanged version must not trigger a redraw');
  assert.equal(statsMount.innerHTML, afterFirst, 'DOM must stay byte-identical when nothing changed');

  call = 2;
  const redrew3 = await dashboard.poll();
  assert.equal(redrew3, true);
  assert.match(statsMount.innerHTML, /<dt>version<\/dt><dd>2<\/dd>/);
  assert.equal(flameMount.innerHTML, '<svg id="b"/>');
});
