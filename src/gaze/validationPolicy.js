const POLICIES = {
  prototype: {
    id: 'prototype',
    maxMeanPx: 180,
    maxP90Px: 260,
    maxSinglePointPx: 360,
    maxP90DispersionPx: 80,
    maxSingleTargetDispersionPx: 100,
    minEffectiveHz: 0,
    minDataIntegrityPercent: 0,
  },
  research: {
    id: 'research',
    maxMeanPx: 110,
    maxP90Px: 175,
    maxSinglePointPx: 220,
    maxP90DispersionPx: 60,
    maxSingleTargetDispersionPx: 80,
    minEffectiveHz: 20,
    minDataIntegrityPercent: 85,
  },
};

function clonePolicy(policy) {
  return { ...policy };
}

function getPolicyId(id) {
  return typeof id === 'string' ? id : id?.id;
}

function addMaxFailure(failures, summary, metric, limit) {
  const actual = summary?.[metric];

  if (!Number.isFinite(actual) || actual > limit) {
    failures.push({
      metric,
      actual: Number.isFinite(actual) ? actual : null,
      limit,
      comparator: '<=',
    });
  }
}

function addOptionalMaxFailure(failures, summary, metric, limit) {
  const actual = summary?.[metric];

  if (actual === null || actual === undefined) {
    return;
  }

  addMaxFailure(failures, summary, metric, limit);
}

function addMinFailure(failures, source, metric, limit) {
  if (!(Number.isFinite(limit) && limit > 0)) {
    return;
  }

  const actual = source?.[metric];

  if (!Number.isFinite(actual) || actual < limit) {
    failures.push({
      metric,
      actual: Number.isFinite(actual) ? actual : null,
      limit,
      comparator: '>=',
    });
  }
}

export function getValidationPolicy(id = 'prototype') {
  return clonePolicy(POLICIES[getPolicyId(id)] || POLICIES.prototype);
}

export function getValidationPolicyFailures({
  summary,
  streamQuality = null,
  policy = getValidationPolicy(),
} = {}) {
  const resolvedPolicy = getValidationPolicy(policy);
  const failures = [];

  addMaxFailure(failures, summary, 'meanPx', resolvedPolicy.maxMeanPx);
  addMaxFailure(failures, summary, 'p90Px', resolvedPolicy.maxP90Px);
  addMaxFailure(failures, summary, 'maxPx', resolvedPolicy.maxSinglePointPx);

  addOptionalMaxFailure(failures, summary, 'p90DispersionPx', resolvedPolicy.maxP90DispersionPx);
  addOptionalMaxFailure(failures, summary, 'maxDispersionPx', resolvedPolicy.maxSingleTargetDispersionPx);

  addMinFailure(failures, streamQuality, 'effectiveHz', resolvedPolicy.minEffectiveHz);
  addMinFailure(failures, streamQuality, 'dataIntegrityPercent', resolvedPolicy.minDataIntegrityPercent);

  return failures;
}

export function passesValidationPolicy({
  summary,
  streamQuality = null,
  policy = getValidationPolicy(),
} = {}) {
  return getValidationPolicyFailures({ summary, streamQuality, policy }).length === 0;
}
