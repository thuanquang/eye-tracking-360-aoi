const DEFAULT_ALLOWED_ORIGIN = '*';
const MAX_BODY_BYTES = 15 * 1024 * 1024;

function corsHeaders(env = {}) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-file-name, x-study-id, x-upload-token',
    'access-control-max-age': '86400',
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(env),
      'content-type': 'application/json',
    },
  });
}

function cleanFileName(value) {
  const clean = typeof value === 'string'
    ? value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
    : '';

  return clean.endsWith('.json') ? clean : '';
}

async function readBody(request) {
  const body = await request.text();
  const size = new TextEncoder().encode(body).byteLength;

  if (size > MAX_BODY_BYTES) {
    throw new Error('payload-too-large');
  }

  JSON.parse(body);
  return body;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method-not-allowed' }, 405, env);
    }

    if (env.UPLOAD_TOKEN && request.headers.get('x-upload-token') !== env.UPLOAD_TOKEN) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401, env);
    }

    const fileName = cleanFileName(request.headers.get('x-file-name'));
    if (!fileName) {
      return jsonResponse({ ok: false, error: 'missing-file-name' }, 400, env);
    }

    if (!env.RESULTS_BUCKET) {
      return jsonResponse({ ok: false, error: 'missing-results-bucket' }, 500, env);
    }

    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      const status = error?.message === 'payload-too-large' ? 413 : 400;
      return jsonResponse({ ok: false, error: error?.message || 'invalid-json' }, status, env);
    }

    const key = `submissions/${fileName}`;
    await env.RESULTS_BUCKET.put(key, body, {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        studyId: request.headers.get('x-study-id') || 'pilot',
        uploadedAt: new Date().toISOString(),
      },
    });

    return jsonResponse({ ok: true, key }, 200, env);
  },
};
