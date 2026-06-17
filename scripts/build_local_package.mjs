import { buildCombinedLocalPackage } from './local_mode_package_builder.mjs';

await buildCombinedLocalPackage({
  packageDirName: 'eye-tracking-360-aoi-local',
  zipFileName: 'eye-tracking-360-aoi-local.zip',
  title: 'Eye Tracking 360 AOI - bộ khởi chạy cục bộ',
  launchers: [
    {
      mode: 'admin',
      startBatName: 'Mở Quản Trị.bat',
      serverScriptName: 'serve-admin-local.ps1',
      preferredPort: 5079,
      fallbackPortStart: 5080,
      fallbackPortEnd: 5099,
      runningMessage: 'Ung dung quan tri Eye Tracking 360 AOI dang chay.',
      leaveOpenMessage: 'Giu cua so nay mo trong khi thiet lap hoac xem lai.',
    },
    {
      mode: 'participant',
      startBatName: 'Mở Bài Nghiên Cứu.bat',
      serverScriptName: 'serve-participant-local.ps1',
      preferredPort: 5179,
      fallbackPortStart: 5180,
      fallbackPortEnd: 5199,
      runningMessage: 'Phien nguoi tham gia Eye Tracking 360 AOI dang chay.',
      leaveOpenMessage: 'Giu cua so nay mo cho den khi nguoi tham gia hoan tat.',
    },
    {
      mode: 'validation',
      startBatName: 'Mở Kiểm Tra Xác Thực.bat',
      serverScriptName: 'serve-validation-local.ps1',
      preferredPort: 5279,
      fallbackPortStart: 5280,
      fallbackPortEnd: 5299,
      runningMessage: 'Kiem tra xac thuc Eye Tracking 360 AOI dang chay.',
      leaveOpenMessage: 'Giu cua so nay mo cho den khi kiem tra xac thuc hoan tat.',
    },
  ],
});
