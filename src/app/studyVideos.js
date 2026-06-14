export const STUDY_VIDEOS = [
  {
    id: 'nguyen-hue-360-0500',
    label: 'Nguyen Hue 5:00-5:30 (360)',
    name: 'nguyen-hue-360-0500-0530.mp4',
    path: 'assets/replacement-videos/nguyen-hue-360-0500-0530.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/nguyen-hue-360-0500-0530.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'nguyen-hue-360-0532',
    label: 'Nguyen Hue 5:32-6:02 (360)',
    name: 'nguyen-hue-360-0532-0602.mp4',
    path: 'assets/replacement-videos/nguyen-hue-360-0532-0602.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/nguyen-hue-360-0532-0602.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'nguyen-hue-2d-0500',
    label: 'Nguyen Hue 5:00-5:30 (2D)',
    name: 'nguyen-hue-2d-view-0500-0530-yaw0.mp4',
    path: 'assets/replacement-videos/nguyen-hue-2d-view-0500-0530-yaw0.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/nguyen-hue-2d-view-0500-0530-yaw0.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  {
    id: 'nguyen-hue-2d-0532',
    label: 'Nguyen Hue 5:32-6:02 (2D)',
    name: 'nguyen-hue-2d-view-0532-0602-yaw-45.mp4',
    path: 'assets/replacement-videos/nguyen-hue-2d-view-0532-0602-yaw-45.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/nguyen-hue-2d-view-0532-0602-yaw-45.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  {
    id: 'culture-thap-ba-360',
    label: 'Thap Ba 1:19-1:49 (360)',
    name: 'culture_thap_ba_01m19s-01m49s.mp4',
    path: 'assets/clips/culture_thap_ba_01m19s-01m49s.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-aligned/outputs/culture_thap_ba_01m19s-01m49s.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'culture-thap-ba-2d',
    label: 'Thap Ba 1:19-1:49 (2D)',
    name: 'culture_thap_ba_01m19s-01m49s_2d.mp4',
    path: 'assets/clips-2d/culture_thap_ba_01m19s-01m49s_2d.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/culture_thap_ba_01m19s-01m49s_2d.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  {
    id: 'nature-tam-coc-360',
    label: 'Tam Coc 4:31-5:01 (360)',
    name: 'nature_tam_coc_04m31s-05m01s.mp4',
    path: 'assets/clips/nature_tam_coc_04m31s-05m01s.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-aligned/outputs/nature_tam_coc_04m31s-05m01s.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'nature-tam-coc-2d',
    label: 'Tam Coc 4:31-5:01 (2D)',
    name: 'nature_tam_coc_04m31s-05m01s_2d.mp4',
    path: 'assets/clips-2d/nature_tam_coc_04m31s-05m01s_2d.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-enhanced/outputs/nature_tam_coc_04m31s-05m01s_2d.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
];

export function getDefaultStudyVideo() {
  return { ...STUDY_VIDEOS[0] };
}

export function findStudyVideoById(id) {
  const video = STUDY_VIDEOS.find((candidate) => candidate.id === id);
  return video ? { ...video } : null;
}

export function findStudyVideoByName(name) {
  const video = STUDY_VIDEOS.find((candidate) => candidate.name === name);
  return video ? { ...video } : null;
}

export function getGeneratedAoiPathForStudyVideo(video) {
  return typeof video?.aoiPath === 'string' && video.aoiPath
    ? video.aoiPath
    : null;
}

export function videoInfoFromStudyVideo(video) {
  return {
    kind: 'study-video',
    id: video.id,
    name: video.name,
    path: video.path,
    type: video.type,
    size: null,
    lastModified: null,
    projection: video.projection,
    stereoLayout: video.stereoLayout,
    ...(video.stereoEye ? { stereoEye: video.stereoEye } : {}),
    ...(Number.isFinite(video.initialTimeSec) ? { initialTimeSec: video.initialTimeSec } : {}),
  };
}

export function validateAoiVideoCompatibility({ selectedVideo, metadataVideo }) {
  if (!metadataVideo || typeof metadataVideo !== 'object') {
    throw new Error('AOI JSON must include video metadata for the selected study video.');
  }

  if (metadataVideo.name !== selectedVideo.name) {
    throw new Error(`AOI JSON video "${metadataVideo.name || 'unknown'}" does not match selected video "${selectedVideo.name}".`);
  }

  if (metadataVideo.projection && metadataVideo.projection !== selectedVideo.projection) {
    throw new Error(`AOI JSON projection "${metadataVideo.projection}" does not match selected video projection "${selectedVideo.projection}".`);
  }

  if (metadataVideo.stereoLayout && metadataVideo.stereoLayout !== selectedVideo.stereoLayout) {
    throw new Error(`AOI JSON stereo layout "${metadataVideo.stereoLayout}" does not match selected video stereo layout "${selectedVideo.stereoLayout}".`);
  }

  if (selectedVideo.stereoEye && metadataVideo.stereoEye !== selectedVideo.stereoEye) {
    throw new Error(`AOI JSON stereo eye "${metadataVideo.stereoEye || 'unknown'}" does not match selected video stereo eye "${selectedVideo.stereoEye}".`);
  }
}
