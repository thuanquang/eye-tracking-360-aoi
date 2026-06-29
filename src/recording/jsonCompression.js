const GZIP_MIME_TYPES = new Set([
  'application/gzip',
  'application/x-gzip',
]);

export function supportsGzipStreams(globalRef = globalThis) {
  return (
    typeof globalRef?.CompressionStream === 'function' &&
    typeof globalRef?.DecompressionStream === 'function' &&
    typeof globalRef?.Blob === 'function' &&
    typeof globalRef?.Response === 'function'
  );
}

export function isGzipFile(file) {
  const name = typeof file?.name === 'string' ? file.name : '';
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';

  return /\.gz$/i.test(name) || GZIP_MIME_TYPES.has(type);
}

export async function gzipTextToBlob(text, globalRef = globalThis) {
  if (!supportsGzipStreams(globalRef)) {
    throw new Error('Trình duyệt không hỗ trợ nén gzip.');
  }

  const inputBlob = new globalRef.Blob([text], { type: 'application/json' });
  const compressedStream = inputBlob
    .stream()
    .pipeThrough(new globalRef.CompressionStream('gzip'));

  return new globalRef.Response(compressedStream).blob();
}

export async function gunzipBlobToText(blob, globalRef = globalThis) {
  if (!supportsGzipStreams(globalRef)) {
    throw new Error('Trình duyệt không hỗ trợ giải nén gzip.');
  }

  const decompressedStream = blob
    .stream()
    .pipeThrough(new globalRef.DecompressionStream('gzip'));

  return new globalRef.Response(decompressedStream).text();
}
