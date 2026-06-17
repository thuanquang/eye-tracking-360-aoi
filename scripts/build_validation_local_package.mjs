import { buildLocalModePackage } from './local_mode_package_builder.mjs';

await buildLocalModePackage({
  mode: 'validation',
  packageDirName: 'validation-local',
  zipFileName: 'eye-tracking-360-aoi-validation-local.zip',
  startBatName: 'Mở Kiểm Tra Xác Thực.bat',
  serverScriptName: 'serve-validation-local.ps1',
  preferredPort: 5279,
  fallbackPortStart: 5280,
  fallbackPortEnd: 5299,
  title: 'Eye Tracking 360 AOI - trình chạy kiểm tra xác thực',
  modeDescription: 'kiểm tra độ chính xác',
  completionStep: 'Sau khi kiểm tra độ chính xác xong, đóng cửa sổ launcher.',
  runningMessage: 'Kiem tra xac thuc Eye Tracking 360 AOI dang chay.',
  leaveOpenMessage: 'Giu cua so nay mo cho den khi kiem tra xac thuc hoan tat.',
});
