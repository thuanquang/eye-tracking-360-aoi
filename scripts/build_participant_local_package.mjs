import { buildLocalModePackage } from './local_mode_package_builder.mjs';

await buildLocalModePackage({
  mode: 'participant',
  packageDirName: 'participant-local',
  zipFileName: 'eye-tracking-360-aoi-participant-local.zip',
  startBatName: 'Mở Bài Nghiên Cứu.bat',
  serverScriptName: 'serve-participant-local.ps1',
  preferredPort: 5179,
  fallbackPortStart: 5180,
  fallbackPortEnd: 5199,
  title: 'Eye Tracking 360 AOI - trình chạy người tham gia',
  modeDescription: 'phiên nghiên cứu',
  completionStep: 'Sau khi gửi kết quả xong, đóng cửa sổ launcher.',
  runningMessage: 'Phien nguoi tham gia Eye Tracking 360 AOI dang chay.',
  leaveOpenMessage: 'Giu cua so nay mo cho den khi nguoi tham gia hoan tat.',
});
