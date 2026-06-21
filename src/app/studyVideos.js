export const STUDY_VIDEOS = [
  {
    id: 'nguyen-hue-360-0532',
    label: 'Nguyen Hue 5:32-6:02 (360)',
    name: 'nguyen-hue-360-0532-0602.mp4',
    path: 'assets/replacement-videos/nguyen-hue-360-0532-0602.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nguyen-hue-360-0532-0602.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'culture-thap-ba-360',
    label: 'Thap Ba 1:19-1:49 (360)',
    name: 'culture_thap_ba_01m19s-01m49s.mp4',
    path: 'assets/clips/culture_thap_ba_01m19s-01m49s.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/culture_thap_ba_01m19s-01m49s.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'culture-thap-ba-2d',
    label: 'Thap Ba 1:19-1:49 (2D)',
    name: 'culture_thap_ba_01m19s-01m49s_2d.mp4',
    path: 'assets/clips-2d/culture_thap_ba_01m19s-01m49s_2d.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/culture_thap_ba_01m19s-01m49s_2d.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  {
    id: 'nature-tam-coc-360',
    label: 'Tam Coc 4:31-5:01 (360)',
    name: 'nature_tam_coc_04m31s-05m01s.mp4',
    path: 'assets/clips/nature_tam_coc_04m31s-05m01s.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nature_tam_coc_04m31s-05m01s.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'equirectangular',
    stereoLayout: 'mono',
  },
  {
    id: 'nature-tam-coc-2d',
    label: 'Tam Coc 4:31-5:01 (2D)',
    name: 'nature_tam_coc_04m31s-05m01s_2d.mp4',
    path: 'assets/clips-2d/nature_tam_coc_04m31s-05m01s_2d.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/nature_tam_coc_04m31s-05m01s_2d.enhanced-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
  {
    id: 'youtube-tcgwknsclhq-2d-0045-yaw-29p9-pitch-17p6',
    label: 'YouTube tCgWkNSclHQ 0:45-1:15 (2D - yaw 29.9, pitch 17.6)',
    name: 'youtube_tCgWkNSclHQ_00m45s-01m15s_yaw-29p9-pitch-17p6_2d.mp4',
    path: 'assets/clips-2d/youtube_tCgWkNSclHQ_00m45s-01m15s_yaw-29p9-pitch-17p6_2d.mp4',
    aoiPath: 'runpod-aoi-results-absolute-quality-with-surfaces/outputs/youtube_tCgWkNSclHQ_00m45s-01m15s_yaw-29p9-pitch-17p6_2d.generated-aois.json',
    type: 'video/mp4',
    projection: 'flat',
    stereoLayout: 'mono',
  },
];

export function getDefaultStudyVideo() {
  return { ...STUDY_VIDEOS[0] };
}

export function getRandomStudyVideo(random = Math.random) {
  const index = Math.min(
    STUDY_VIDEOS.length - 1,
    Math.max(0, Math.floor(random() * STUDY_VIDEOS.length)),
  );
  return { ...STUDY_VIDEOS[index] };
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
    throw new Error('AOI JSON phải bao gồm metadata video cho video nghiên cứu đã chọn.');
  }

  if (metadataVideo.name !== selectedVideo.name) {
    throw new Error(`Video trong AOI JSON "${metadataVideo.name || 'không rõ'}" không khớp với video đã chọn "${selectedVideo.name}".`);
  }

  if (metadataVideo.projection && metadataVideo.projection !== selectedVideo.projection) {
    throw new Error(`Phép chiếu trong AOI JSON "${metadataVideo.projection}" không khớp với phép chiếu video đã chọn "${selectedVideo.projection}".`);
  }

  if (metadataVideo.stereoLayout && metadataVideo.stereoLayout !== selectedVideo.stereoLayout) {
    throw new Error(`Bố cục stereo trong AOI JSON "${metadataVideo.stereoLayout}" không khớp với bố cục stereo video đã chọn "${selectedVideo.stereoLayout}".`);
  }

  if (selectedVideo.stereoEye && metadataVideo.stereoEye !== selectedVideo.stereoEye) {
    throw new Error(`Mắt stereo trong AOI JSON "${metadataVideo.stereoEye || 'không rõ'}" không khớp với mắt stereo video đã chọn "${selectedVideo.stereoEye}".`);
  }
}
