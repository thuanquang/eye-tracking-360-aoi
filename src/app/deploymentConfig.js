const DEFAULT_STUDY_ID = 'pilot';

function compactSegment(value, fallback) {
  const compacted = typeof value === 'string'
    ? value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
    : '';

  return compacted || fallback;
}

export function getDeploymentConfig(globalRef = globalThis) {
  const config = globalRef?.AOI_DEPLOYMENT;
  return config && typeof config === 'object' ? config : {};
}

export function getDeploymentSeeSoLicenseKey(config = getDeploymentConfig()) {
  return typeof config?.seeSoLicenseKey === 'string' ? config.seeSoLicenseKey.trim() : '';
}

export function buildStudyAssetFetchPath(path) {
  if (typeof path !== 'string' || !path) {
    return path;
  }

  try {
    const url = new URL(path);
    return `./${url.pathname.replace(/^\/+/g, '')}`;
  } catch {
    return `./${path.replace(/^\/+/g, '')}`;
  }
}

function resolveSubmissionSubjectId(payload, kind) {
  if (kind === 'validation') {
    return compactSegment(
      payload?.validation?.id ?? payload?.validation?.validationId,
      'validation',
    );
  }

  return compactSegment(payload?.participant?.id, 'participant');
}

export function buildStudySubmissionFileName(payload, {
  studyId = DEFAULT_STUDY_ID,
  kind = 'participant',
} = {}) {
  const exportedAt = compactSegment(
    payload?.exportedAt?.replace(/[:.]/g, '-'),
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  const videoId = compactSegment(payload?.project?.video?.id ?? payload?.video?.id, 'video');
  const subjectId = resolveSubmissionSubjectId(payload, kind);
  const kindSegment = kind === 'participant' ? '' : `${compactSegment(kind, 'submission')}-`;

  return `${compactSegment(studyId, DEFAULT_STUDY_ID)}-${kindSegment}${videoId}-${subjectId}-${exportedAt}.json`;
}

export function buildParticipantSubmissionFileName(payload, { studyId = DEFAULT_STUDY_ID } = {}) {
  return buildStudySubmissionFileName(payload, { studyId, kind: 'participant' });
}

export function buildStudySubmissionRequest(payload, config = getDeploymentConfig(), {
  kind = 'participant',
} = {}) {
  const studyId = config.studyId || DEFAULT_STUDY_ID;
  const fileName = buildStudySubmissionFileName(payload, { studyId, kind });
  const headers = {
    'content-type': 'application/json',
    'x-file-name': fileName,
    'x-study-id': studyId,
  };

  if (config.uploadToken) {
    headers['x-upload-token'] = config.uploadToken;
  }

  return {
    fileName,
    body: JSON.stringify(payload),
    headers,
  };
}

export function buildParticipantSubmissionRequest(payload, config = getDeploymentConfig()) {
  return buildStudySubmissionRequest(payload, config, { kind: 'participant' });
}

export async function submitStudySubmission(payload, {
  config = getDeploymentConfig(),
  fetchFn = globalThis.fetch,
  kind = 'participant',
} = {}) {
  if (!config?.submissionEndpoint) {
    return { ok: false, skipped: true, reason: 'missing-endpoint' };
  }

  const request = buildStudySubmissionRequest(payload, config, { kind });
  const response = await fetchFn(config.submissionEndpoint, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: 'upload-failed',
    };
  }

  return {
    ok: true,
    fileName: request.fileName,
  };
}

export async function submitParticipantExport(payload, options = {}) {
  return submitStudySubmission(payload, { ...options, kind: 'participant' });
}

export async function submitValidationResult(payload, options = {}) {
  return submitStudySubmission(payload, { ...options, kind: 'validation' });
}
