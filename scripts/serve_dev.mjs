#!/usr/bin/env node
import httpServer from 'http-server';
import { pathToFileURL } from 'node:url';

export const CROSS_ORIGIN_ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
});

export function createIsolatedDevServer({
  root = '.',
  cache = -1,
  headers = {},
} = {}) {
  return httpServer.createServer({
    root,
    cache,
    headers: {
      ...CROSS_ORIGIN_ISOLATION_HEADERS,
      ...headers,
    },
  });
}

function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 5179;
}

function startServer() {
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST || '0.0.0.0';
  const server = createIsolatedDevServer();

  server.listen(port, host, () => {
    console.log(`Serving cross-origin isolated AOI prototype at http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
