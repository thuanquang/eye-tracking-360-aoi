import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const faceMeshDir = resolve(rootDir, 'node_modules', '@mediapipe', 'face_mesh');
const port = Number(process.env.PORT || 5179);

const mimeTypes = new Map([
  ['.binarypb', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.data', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end(message);
}

function isWithinDirectory(filePath, directory) {
  const relative = normalize(filePath).slice(directory.length);
  return filePath === directory || (relative.startsWith(sep) && !relative.includes(`..${sep}`));
}

function resolveStaticPath(requestUrl) {
  const url = new URL(requestUrl, `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/mediapipe/face_mesh/')) {
    const assetName = pathname.slice('/mediapipe/face_mesh/'.length);
    return {
      baseDir: faceMeshDir,
      filePath: resolve(faceMeshDir, assetName),
    };
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  return {
    baseDir: rootDir,
    filePath: resolve(rootDir, relativePath),
  };
}

async function serveFile(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let resolvedPath;
  try {
    resolvedPath = resolveStaticPath(request.url || '/');
  } catch {
    sendText(response, 400, 'Bad request');
    return;
  }

  if (!isWithinDirectory(resolvedPath.filePath, resolvedPath.baseDir)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(resolvedPath.filePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': fileStat.size,
      'Content-Type': mimeTypes.get(extname(resolvedPath.filePath)) || 'application/octet-stream',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(resolvedPath.filePath).pipe(response);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

const server = createServer((request, response) => {
  void serveFile(request, response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving ${rootDir}`);
  console.log(`Available on http://127.0.0.1:${port}`);
});
