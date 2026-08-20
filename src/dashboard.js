// Pure, isomorphic rendering logic for the live dashboard: turning a
// /api/v1/timeline response into stats and deciding when to redraw.
//
// This file imports nothing Node-specific (no node:fs, no node:http), so
// it is served byte-for-byte to the browser (see GET /dashboard.js in
// src/server.js) and imported directly in test/dashboard.test.js. There is
// exactly one implementation of "what a poll does to the screen" - not a
// server copy and a client copy that can drift apart.

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return ch;
    }
  });
}

/**
 * Reduce a /api/v1/timeline response body into the flat set of numbers the
 * dashboard displays. Pure: the same input always produces the same
 * output, with no clock or randomness of its own.
 */
export function computeStats(state) {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  let callCount = 0;
  let okCount = 0;
  let errorCount = 0;
  let pendingCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let maxLatencyMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const session of sessions) {
    inputTokens += session?.usage?.inputTokens ?? 0;
    outputTokens += session?.usage?.outputTokens ?? 0;
    for (const event of session?.timeline ?? []) {
      if (!event || event.type !== 'tool_call') continue;
      callCount += 1;
      if (event.ok === true) okCount += 1;
      else if (event.ok === false) errorCount += 1;
      else pendingCount += 1;
      if (typeof event.durationMs === 'number') {
        latencySum += event.durationMs;
        latencyCount += 1;
        if (event.durationMs > maxLatencyMs) maxLatencyMs = event.durationMs;
      }
    }
  }

  return {
    version: state?.version ?? 0,
    generatedAt: state?.generatedAt ?? null,
    sessionCount: sessions.length,
    callCount,
    okCount,
    errorCount,
    pendingCount,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
    maxLatencyMs,
  };
}

/**
 * Render the stats bar as an HTML string. Pure and deterministic: only
 * reads `stats`, never the wall clock, so the same stats always produce
 * byte-identical markup.
 */
export function renderStatsHTML(stats) {
  return [
    '<dl class="stats">',
    `<dt>version</dt><dd>${stats.version}</dd>`,
    `<dt>sessions</dt><dd>${stats.sessionCount}</dd>`,
    `<dt>tool calls</dt><dd>${stats.callCount} (${stats.okCount} ok, ${stats.errorCount} failed, ${stats.pendingCount} pending)</dd>`,
    `<dt>tokens</dt><dd>${stats.totalTokens} (${stats.inputTokens} in / ${stats.outputTokens} out)</dd>`,
    `<dt>latency</dt><dd>avg ${stats.avgLatencyMs}ms, max ${stats.maxLatencyMs}ms</dd>`,
    `<dt>generated</dt><dd>${escapeHtml(stats.generatedAt ?? '')}</dd>`,
    '</dl>',
  ].join('');
}

/**
 * Drive the poll -> compare version -> redraw loop.
 *
 * Everything that touches the network or the DOM is passed in as a
 * dependency, so the exact same function runs against a real browser
 * (index.html, using window.fetch and document elements) and against a
 * scripted fixture feed in tests (using canned responses and a plain
 * object standing in for a DOM node) - see test/dashboard.test.js.
 *
 * @param {object} opts
 * @param {() => Promise<any>} opts.fetchTimeline - resolves to the parsed
 *   /api/v1/timeline body.
 * @param {() => Promise<string>} opts.fetchFlame - resolves to the
 *   /api/v1/flame.svg body text.
 * @param {{ innerHTML: string }} opts.statsMount
 * @param {{ innerHTML: string }} opts.flameMount
 */
export function createDashboard({ fetchTimeline, fetchFlame, statsMount, flameMount }) {
  let lastVersion = null;

  /**
   * Run one poll. Returns true if the screen was redrawn, false if the
   * version was unchanged and the poll was a no-op - a poll that finds
   * nothing new must never touch the DOM, or a live view would flicker
   * even while an agent run is idle.
   */
  async function poll() {
    const state = await fetchTimeline();
    const stats = computeStats(state);
    if (stats.version === lastVersion) return false;
    lastVersion = stats.version;

    statsMount.innerHTML = renderStatsHTML(stats);
    flameMount.innerHTML = await fetchFlame();
    return true;
  }

  return { poll };
}
