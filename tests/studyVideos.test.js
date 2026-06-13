import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STUDY_VIDEOS,
  findStudyVideoByName,
  getGeneratedAoiPathForStudyVideo,
  getDefaultStudyVideo,
  validateAoiVideoCompatibility,
} from '../src/app/studyVideos.js';

test('exposes only the six fixed study videos', () => {
  assert.equal(STUDY_VIDEOS.length, 6);
  assert.deepEqual(
    STUDY_VIDEOS.map((video) => video.name).sort(),
    [
      'culture_thap_ba_01m19s-01m49s.mp4',
      'culture_thap_ba_01m19s-01m49s_2d.mp4',
      'modern_01m00s-01m30s.mp4',
      'modern_01m00s-01m30s_2d.mp4',
      'nature_tam_coc_04m31s-05m01s.mp4',
      'nature_tam_coc_04m31s-05m01s_2d.mp4',
    ],
  );
  assert.equal(getDefaultStudyVideo().name, 'culture_thap_ba_01m19s-01m49s.mp4');
  assert.equal(findStudyVideoByName('modern_01m00s-01m30s_2d.mp4')?.projection, 'flat');
  assert.equal(findStudyVideoByName('culture_thap_ba_01m19s-01m49s.mp4')?.stereoLayout, 'mono');
  assert.equal(findStudyVideoByName('modern_01m00s-01m30s.mp4')?.projection, 'flat');
  assert.equal(findStudyVideoByName('modern_01m00s-01m30s.mp4')?.stereoLayout, 'top-bottom');
  assert.equal(findStudyVideoByName('modern_01m00s-01m30s.mp4')?.stereoEye, 'top-left');
  assert.equal(findStudyVideoByName('modern_01m00s-01m30s.mp4')?.initialTimeSec, 1);
  assert.equal(findStudyVideoByName('nature_tam_coc_04m31s-05m01s.mp4')?.stereoLayout, 'mono');
});

test('maps each fixed study video to its aligned generated AOI JSON', () => {
  assert.deepEqual(
    STUDY_VIDEOS.map((video) => [video.name, getGeneratedAoiPathForStudyVideo(video)]),
    [
      [
        'culture_thap_ba_01m19s-01m49s.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/culture_thap_ba_01m19s-01m49s.enhanced-aois.json',
      ],
      [
        'culture_thap_ba_01m19s-01m49s_2d.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/culture_thap_ba_01m19s-01m49s_2d.enhanced-aois.json',
      ],
      [
        'modern_01m00s-01m30s.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/modern_01m00s-01m30s.enhanced-aois.json',
      ],
      [
        'modern_01m00s-01m30s_2d.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/modern_01m00s-01m30s_2d.enhanced-aois.json',
      ],
      [
        'nature_tam_coc_04m31s-05m01s.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/nature_tam_coc_04m31s-05m01s.enhanced-aois.json',
      ],
      [
        'nature_tam_coc_04m31s-05m01s_2d.mp4',
        'runpod-aoi-results-absolute-quality-aligned/outputs/nature_tam_coc_04m31s-05m01s_2d.enhanced-aois.json',
      ],
    ],
  );
});

test('accepts AOI JSON whose video metadata matches the selected study video', () => {
  const video = findStudyVideoByName('modern_01m00s-01m30s.mp4');
  assert.doesNotThrow(() => validateAoiVideoCompatibility({
    selectedVideo: video,
    metadataVideo: {
      name: 'modern_01m00s-01m30s.mp4',
      projection: 'flat',
      stereoLayout: 'top-bottom',
      stereoEye: 'top-left',
    },
  }));
});

test('rejects AOI JSON for a different study video or projection', () => {
  const selectedVideo = findStudyVideoByName('modern_01m00s-01m30s.mp4');

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'culture_thap_ba_01m19s-01m49s.mp4',
        projection: 'equirectangular',
        stereoLayout: 'mono',
      },
    }),
    /does not match selected video/,
  );

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'modern_01m00s-01m30s.mp4',
        projection: 'equirectangular',
        stereoLayout: 'top-bottom',
        stereoEye: 'top-left',
      },
    }),
    /projection/,
  );

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'modern_01m00s-01m30s.mp4',
        projection: 'flat',
        stereoLayout: 'top-bottom',
      },
    }),
    /stereo eye/,
  );
});

test('requires AOI JSON to include video metadata for study checks', () => {
  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo: findStudyVideoByName('nature_tam_coc_04m31s-05m01s_2d.mp4'),
      metadataVideo: null,
    }),
    /must include video metadata/,
  );
});
