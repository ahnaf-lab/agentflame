// A tiny HTTP server exposing a Tailer's state as versioned JSON. Kept to
// node:http with no framework: two routes, both read-only, neither takes
// any input from the request that reaches the filesystem or a shell.

import { createServer } from 'node:http';

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

    if (req.method === 'GET' && url.pathname === '/api/v1/timeline') {
      const body = JSON.stringify(tailer.getState());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
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
