import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STUDY_VIDEOS,
  findStudyVideoByName,
  getGeneratedAoiPathForStudyVideo,
  getDefaultStudyVideo,
  getRandomStudyVideo,
  validateAoiVideoCompatibility,
} from '../src/app/studyVideos.js';

test('exposes the culture, nature, and Nguyen Hue study videos', () => {
  assert.equal(STUDY_VIDEOS.length, 8);
  assert.deepEqual(
    STUDY_VIDEOS.map((video) => video.name).sort(),
    [
      'culture_thap_ba_01m19s-01m49s.mp4',
      'culture_thap_ba_01m19s-01m49s_2d.mp4',
      'nature_tam_coc_04m31s-05m01s.mp4',
      'nature_tam_coc_04m31s-05m01s_2d.mp4',
      'nguyen-hue-2d-view-0500-0530-yaw0.mp4',
      'nguyen-hue-2d-view-0532-0602-yaw-45.mp4',
      'nguyen-hue-360-0500-0530.mp4',
      'nguyen-hue-360-0532-0602.mp4',
    ],
  );
  assert.equal(getDefaultStudyVideo().name, 'nguyen-hue-360-0500-0530.mp4');
  assert.equal(findStudyVideoByName('nguyen-hue-360-0500-0530.mp4')?.projection, 'equirectangular');
  assert.equal(findStudyVideoByName('nguyen-hue-360-0500-0530.mp4')?.stereoLayout, 'mono');
  assert.equal(findStudyVideoByName('nguyen-hue-360-0532-0602.mp4')?.projection, 'equirectangular');
  assert.equal(findStudyVideoByName('nguyen-hue-360-0532-0602.mp4')?.stereoLayout, 'mono');
  assert.equal(findStudyVideoByName('nguyen-hue-2d-view-0500-0530-yaw0.mp4')?.projection, 'flat');
  assert.equal(findStudyVideoByName('nguyen-hue-2d-view-0532-0602-yaw-45.mp4')?.projection, 'flat');
  assert.equal(findStudyVideoByName('culture_thap_ba_01m19s-01m49s.mp4')?.projection, 'equirectangular');
  assert.equal(findStudyVideoByName('culture_thap_ba_01m19s-01m49s.mp4')?.stereoLayout, 'mono');
  assert.equal(findStudyVideoByName('nature_tam_coc_04m31s-05m01s.mp4')?.projection, 'equirectangular');
  assert.equal(findStudyVideoByName('nature_tam_coc_04m31s-05m01s.mp4')?.stereoLayout, 'mono');
  assert.equal(findStudyVideoByName('culture_thap_ba_01m19s-01m49s_2d.mp4')?.projection, 'flat');
  assert.equal(findStudyVideoByName('nature_tam_coc_04m31s-05m01s_2d.mp4')?.projection, 'flat');
});

test('maps study videos to surface-merged cleaned AOIs', () => {
  assert.deepEqual(
    STUDY_VIDEOS.map((video) => [video.name, getGeneratedAoiPathForStudyVideo(video)]),
    [
      [
        'nguyen-hue-360-0500-0530.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-360-0500-0530.enhanced-aois.json',
      ],
      [
        'nguyen-hue-360-0532-0602.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-360-0532-0602.enhanced-aois.json',
      ],
      [
        'nguyen-hue-2d-view-0500-0530-yaw0.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-2d-view-0500-0530-yaw0.enhanced-aois.json',
      ],
      [
        'nguyen-hue-2d-view-0532-0602-yaw-45.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-2d-view-0532-0602-yaw-45.enhanced-aois.json',
      ],
      [
        'culture_thap_ba_01m19s-01m49s.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/culture_thap_ba_01m19s-01m49s.enhanced-aois.json',
      ],
      [
        'culture_thap_ba_01m19s-01m49s_2d.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/culture_thap_ba_01m19s-01m49s_2d.enhanced-aois.json',
      ],
      [
        'nature_tam_coc_04m31s-05m01s.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nature_tam_coc_04m31s-05m01s.enhanced-aois.json',
      ],
      [
        'nature_tam_coc_04m31s-05m01s_2d.mp4',
        'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nature_tam_coc_04m31s-05m01s_2d.enhanced-aois.json',
      ],
    ],
  );
});

test('keeps study video and AOI paths local for bundled zip runtime', () => {
  const video = getDefaultStudyVideo();

  assert.equal(video.path, 'assets/replacement-videos/nguyen-hue-360-0500-0530.mp4');
  assert.equal(
    video.aoiPath,
    'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-360-0500-0530.enhanced-aois.json',
  );
  assert.doesNotMatch(JSON.stringify(STUDY_VIDEOS), /https?:\/\//);
});

test('selects a random study video from the configured choices', () => {
  const video = getRandomStudyVideo(() => 0.51);

  assert.equal(video.id, STUDY_VIDEOS[Math.floor(0.51 * STUDY_VIDEOS.length)].id);
  assert.notEqual(video, STUDY_VIDEOS[Math.floor(0.51 * STUDY_VIDEOS.length)]);
});

test('accepts AOI JSON whose video metadata matches the selected study video', () => {
  const video = findStudyVideoByName('nguyen-hue-360-0500-0530.mp4');
  assert.doesNotThrow(() => validateAoiVideoCompatibility({
    selectedVideo: video,
    metadataVideo: {
      name: 'nguyen-hue-360-0500-0530.mp4',
      projection: 'equirectangular',
      stereoLayout: 'mono',
    },
  }));
});

test('accepts repaired legacy AOI JSON metadata for re-added study videos', () => {
  assert.doesNotThrow(() => validateAoiVideoCompatibility({
    selectedVideo: findStudyVideoByName('culture_thap_ba_01m19s-01m49s.mp4'),
    metadataVideo: {
      name: 'culture_thap_ba_01m19s-01m49s.mp4',
      projection: 'equirectangular',
      stereoLayout: 'mono',
    },
  }));

  assert.doesNotThrow(() => validateAoiVideoCompatibility({
    selectedVideo: findStudyVideoByName('nature_tam_coc_04m31s-05m01s_2d.mp4'),
    metadataVideo: {
      name: 'nature_tam_coc_04m31s-05m01s_2d.mp4',
      projection: 'flat',
      stereoLayout: 'mono',
    },
  }));
});

test('rejects AOI JSON for a different study video or projection', () => {
  const selectedVideo = findStudyVideoByName('nguyen-hue-360-0500-0530.mp4');

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'culture_thap_ba_01m19s-01m49s.mp4',
        projection: 'equirectangular',
        stereoLayout: 'mono',
      },
    }),
    /không khớp với video đã chọn/,
  );

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'nguyen-hue-360-0500-0530.mp4',
        projection: 'flat',
        stereoLayout: 'mono',
      },
    }),
    /Phép chiếu/,
  );

  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo,
      metadataVideo: {
        name: 'nguyen-hue-360-0500-0530.mp4',
        projection: 'equirectangular',
        stereoLayout: 'top-bottom',
      },
    }),
    /Bố cục stereo/,
  );
});

test('requires AOI JSON to include video metadata for study checks', () => {
  assert.throws(
    () => validateAoiVideoCompatibility({
      selectedVideo: findStudyVideoByName('nguyen-hue-2d-view-0532-0602-yaw-45.mp4'),
      metadataVideo: null,
    }),
    /phải bao gồm metadata video/,
  );
});
