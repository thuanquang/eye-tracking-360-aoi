const DEFAULTS = {
  likelyGainPerSec: 7,
  possibleGainPerSec: 2.5,
  decayPerSec: 5,
  enterThreshold: 0.75,
  exitThreshold: 0.25,
  maxTrustedUncertaintyPx: 160,
};

function uniqueById(items = []) {
  const byId = new Map();
  items.forEach((item) => {
    if (typeof item?.id === 'string' && item.id) {
      byId.set(item.id, item);
    }
  });
  return [...byId.values()];
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}

export function createAoiStabilityState() {
  return {
    scores: {},
    stableIds: [],
    stableHits: [],
    candidateAois: [],
    trustedForAoiAnalysis: false,
  };
}

export function updateAoiStability(previous = createAoiStabilityState(), {
  classification = {},
  dtMs = 33,
  uncertaintyPx = 0,
  rawQuality = 'good',
  options = {},
} = {}) {
  const config = { ...DEFAULTS, ...options };
  const dtSec = Math.max(0, dtMs) / 1000;
  const likely = uniqueById(classification.likelyHits || []);
  const possible = uniqueById(classification.possibleHits || []);
  const all = uniqueById([...likely, ...possible, ...(classification.ambiguousHits || [])]);
  const likelyIds = new Set(likely.map((hit) => hit.id));
  const possibleIds = new Set(possible.map((hit) => hit.id));
  const allIds = new Set(all.map((hit) => hit.id));
  const scores = {};

  Object.entries(previous.scores || {}).forEach(([id, score]) => {
    const gain = likelyIds.has(id)
      ? config.likelyGainPerSec * dtSec
      : possibleIds.has(id)
        ? config.possibleGainPerSec * dtSec
        : -config.decayPerSec * dtSec;
    scores[id] = clampScore(score + gain);
  });

  all.forEach((hit) => {
    if (!(hit.id in scores)) {
      scores[hit.id] = 0;
    }
    const gain = likelyIds.has(hit.id)
      ? config.likelyGainPerSec * dtSec
      : config.possibleGainPerSec * dtSec;
    scores[hit.id] = clampScore(scores[hit.id] + gain);
  });

  const stableIds = Object.entries(scores)
    .filter(([id, score]) => {
      const wasStable = previous.stableIds?.includes(id);
      return wasStable ? score >= config.exitThreshold : score >= config.enterThreshold;
    })
    .map(([id]) => id);
  const hitById = new Map(all.map((hit) => [hit.id, hit]));
  const stableHits = stableIds
    .map((id) => hitById.get(id) || { id, label: id })
    .filter((hit) => allIds.has(hit.id) || previous.stableIds?.includes(hit.id));
  const candidateAois = all
    .map((hit) => ({ ...hit, score: scores[hit.id] || 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const trustedForAoiAnalysis = (
    stableHits.length > 0 &&
    rawQuality !== 'unusable' &&
    uncertaintyPx <= config.maxTrustedUncertaintyPx
  );

  return {
    scores,
    stableIds,
    stableHits,
    candidateAois,
    trustedForAoiAnalysis,
  };
}
