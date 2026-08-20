// Renders a static SVG flame graph from a canonical event timeline (see
// buildTimeline in src/parser.js). Only `tool_call` events produce bars:
// row 0 is the main chain, row 1 is sidechain (sub-agent) calls, the x-axis
// is wall-clock time from the first tool call, and bar width is call
// duration.
//
// Rendering takes no input of its own beyond the timeline - no Date.now(),
// no random ids, no locale-dependent formatting - so the same timeline
// always produces byte-identical SVG. That determinism is what the
// snapshot test in test/flame.test.js relies on.

const MARGIN = 10;
const ROW_HEIGHT = 24;
const ROW_GAP = 2;
// Minimum time width (ms) given to a call so near-instant or still-pending
// calls stay wide enough on screen to see and click.
const MIN_BAR_MS = 40;
// Approx monospace glyph width in px at the label font size, used only to
// decide how many characters of a tool name fit inside a bar.
const CHAR_PX = 7;

const COLORS = {
  ok: '#4caf7d',
  error: '#e05252',
  pending: '#9e9e9e',
};

function escapeXml(value) {
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

function barColor(call) {
  if (call.ok === false) return COLORS.error;
  if (call.ok === null) return COLORS.pending;
  return COLORS.ok;
}

function truncateLabel(name, widthPx) {
  const maxChars = Math.max(0, Math.floor(widthPx / CHAR_PX) - 1);
  if (name.length <= maxChars) return name;
  if (maxChars <= 1) return '';
  return `${name.slice(0, maxChars - 1)}\u2026`;
}

function emptySvg(width) {
  const height = MARGIN * 2 + ROW_HEIGHT;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="monospace" font-size="11">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#1e1e1e"/>`,
    `<text x="${MARGIN}" y="${MARGIN + ROW_HEIGHT / 2 + 4}" fill="#9e9e9e">no tool calls</text>`,
    `</svg>`,
  ].join('\n');
}

/**
 * Render a timeline (as produced by buildTimeline) into a flame-graph SVG
 * string. Only `tool_call` events with a parseable timestamp are drawn;
 * everything else (messages, calls with no timestamp) is skipped rather
 * than guessed at.
 */
export function renderFlameSVG(timeline, { width = 960 } = {}) {
  const calls = (Array.isArray(timeline) ? timeline : [])
    .filter((event) => event && event.type === 'tool_call')
    .map((call) => ({ ...call, startMs: call.timestamp ? Date.parse(call.timestamp) : NaN }))
    .filter((call) => Number.isFinite(call.startMs))
    .sort((a, b) => a.startMs - b.startMs);

  if (calls.length === 0) return emptySvg(width);

  const innerWidth = width - MARGIN * 2;
  const minStart = Math.min(...calls.map((c) => c.startMs));
  const maxEnd = Math.max(...calls.map((c) => c.startMs + Math.max(c.durationMs ?? 0, MIN_BAR_MS)));
  const totalMs = Math.max(maxEnd - minStart, MIN_BAR_MS);
  const scale = innerWidth / totalMs;
  const maxDepth = calls.reduce((max, c) => Math.max(max, c.sidechain ? 1 : 0), 0);
  const height = MARGIN * 2 + (maxDepth + 1) * ROW_HEIGHT;

  const bars = calls.map((call) => {
    const durationMs = Math.max(call.durationMs ?? 0, MIN_BAR_MS);
    const x = MARGIN + (call.startMs - minStart) * scale;
    const w = Math.max(durationMs * scale, 2);
    const depth = call.sidechain ? 1 : 0;
    const y = MARGIN + depth * ROW_HEIGHT;
    const label = truncateLabel(call.name || '', w);
    const status = call.durationMs != null ? `${call.durationMs}ms` : 'pending';
    const title = escapeXml(`${call.name || ''} ${status}`);

    const rect =
      `<rect x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${ROW_HEIGHT - ROW_GAP}" ` +
      `fill="${barColor(call)}" stroke="#1e1e1e" stroke-width="0.5"><title>${title}</title></rect>`;
    if (!label) return rect;
    const text = `<text x="${(x + 3).toFixed(2)}" y="${(y + ROW_HEIGHT / 2 + 4).toFixed(2)}" fill="#0b0b0b">${escapeXml(label)}</text>`;
    return `${rect}\n${text}`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="monospace" font-size="11">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#1e1e1e"/>`,
    ...bars,
    `</svg>`,
  ].join('\n');
}
