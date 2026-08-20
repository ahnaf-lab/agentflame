// A tiny HTTP server exposing a Tailer's state as versioned JSON. Kept to
// node:http with no framework: two routes, both read-only, neither takes
// any input from the request that reaches the filesystem or a shell.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderFlameSVG } from './flame.js';

// Static assets for the live dashboard page. Read once at startup - both
// are small, fixed, source-controlled files, never user input, so there is
// no path to traverse and no benefit to re-reading them per request.
const ASSET_DIR = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(ASSET_DIR, 'index.html'), 'utf8');
const DASHBOARD_JS = readFileSync(join(ASSET_DIR, 'dashboard.js'), 'utf8');

/** Merge every tracked session's timeline into one time-ordered list of
 * events, for endpoints (like the flame graph) that render across the
 * whole tailed directory rather than one file at a time. */
function mergedTimeline(state) {
  const events = state.sessions.flatMap((session) => session.timeline);
  events.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : NaN;
    const tb = b.timestamp ? Date.parse(b.timestamp) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return 0;
  });
  return events;
}

/** Build the request handler for a given Tailer. Exported separately from
 * startServer so it can be tested without binding a real socket. */
export function createApp(tailer) {
  return function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/dashboard.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(DASHBOARD_JS);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/timeline') {
      const body = JSON.stringify(tailer.getState());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/flame.svg') {
      const svg = renderFlameSVG(mergedTimeline(tailer.getState()));
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(svg);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  };
}

/** Start listening and resolve with the bound http.Server once ready. */
export function startServer(tailer, { port = 0, host = '127.0.0.1' } = {}) {
  const server = createServer(createApp(tailer));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
