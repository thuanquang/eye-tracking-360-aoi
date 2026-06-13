import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAoiStabilityState,
  updateAoiStability,
} from '../src/aois/aoiStability.js';

test('promotes an AOI after repeated likely evidence', () => {
  let state = createAoiStabilityState();

  for (let index = 0; index < 5; index += 1) {
    state = updateAoiStability(state, {
      classification: {
        likelyHits: [{ id: 'sign', label: 'Sign' }],
        possibleHits: [{ id: 'sign', label: 'Sign' }],
        ambiguousHits: [],
      },
      dtMs: 33,
      uncertaintyPx: 60,
      rawQuality: 'coarse',
    });
  }

  assert.deepEqual(state.stableHits.map((hit) => hit.id), ['sign']);
  assert.equal(state.trustedForAoiAnalysis, true);
});

test('keeps ambiguous one-frame hits as candidates without trusting them', () => {
  const state = updateAoiStability(createAoiStabilityState(), {
    classification: {
      likelyHits: [],
      possibleHits: [{ id: 'person', label: 'Person' }],
      ambiguousHits: [{ id: 'person', label: 'Person' }],
    },
    dtMs: 33,
    uncertaintyPx: 180,
    rawQuality: 'coarse',
  });

  assert.deepEqual(state.stableHits, []);
  assert.equal(state.candidateAois[0].id, 'person');
  assert.equal(state.trustedForAoiAnalysis, false);
});
