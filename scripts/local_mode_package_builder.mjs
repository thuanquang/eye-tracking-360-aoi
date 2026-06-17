import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { STUDY_VIDEOS } from '../src/app/studyVideos.js';

const execFileAsync = promisify(execFile);

const appEntries = [
  '_headers',
  'deployment-config.js',
  'index.html',
  'styles.css',
  'src',
];
const windowsRmOptions = { force: true, maxRetries: 5, recursive: true, retryDelay: 200 };
const busyFilesystemErrors = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function psString(value) {
  return psQuote(value);
}

async function removePath(path, options = {}) {
  const retries = 12;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await rm(path, options);
      return;
    } catch (error) {
      if (!busyFilesystemErrors.has(error?.code) || attempt === retries) {
        throw error;
      }

      await delay(250 * (attempt + 1));
    }
  }
}

async function resetPackageDirectory(packageDir) {
  try {
    await removePath(packageDir, windowsRmOptions);
    return;
  } catch (error) {
    if (!busyFilesystemErrors.has(error?.code)) {
      throw error;
    }
  }

  await mkdir(packageDir, { recursive: true });
  const entries = await readdir(packageDir, { withFileTypes: true });
  await Promise.all(entries.map((entry) => (
    removePath(join(packageDir, entry.name), {
      force: true,
      recursive: entry.isDirectory(),
      maxRetries: 5,
      retryDelay: 200,
    })
  )));
}

function createStartBat({ serverScriptName }) {
  return `@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${serverScriptName}"
if errorlevel 1 (
  echo.
  echo Trinh khoi dong dung lai vi co loi.
  pause
)
`;
}

function createServerPs1({
  mode,
  preferredPort,
  fallbackPortStart,
  fallbackPortEnd,
  runningMessage,
  leaveOpenMessage,
}) {
  return String.raw`param(
  [int]$PreferredPort = ${preferredPort},
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$AppRoot = Join-Path $PSScriptRoot 'app'

if (!(Test-Path -LiteralPath (Join-Path $AppRoot 'index.html') -PathType Leaf)) {
  Write-Host 'Cannot find app/index.html next to this launcher.'
  exit 1
}

$ResponseHeaders = @{
  'Cross-Origin-Opener-Policy' = 'same-origin'
  'Cross-Origin-Embedder-Policy' = 'credentialless'
  'Cross-Origin-Resource-Policy' = 'cross-origin'
  'Cache-Control' = 'no-store'
}

$MimeTypes = @{
  '.css' = 'text/css; charset=utf-8'
  '.html' = 'text/html; charset=utf-8'
  '.ico' = 'image/x-icon'
  '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.map' = 'application/json; charset=utf-8'
  '.mp4' = 'video/mp4'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.txt' = 'text/plain; charset=utf-8'
  '.wasm' = 'application/wasm'
}

function Get-SafeFilePath {
  param([string]$UrlPath)

  $path = [Uri]::UnescapeDataString($UrlPath)
  if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') {
    $path = '/index.html'
  }

  $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
  $candidate = [IO.Path]::GetFullPath((Join-Path $AppRoot $relative))
  $rootPath = [IO.Path]::GetFullPath($AppRoot)

  if (!$candidate.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if (Test-Path -LiteralPath $candidate -PathType Container) {
    return Join-Path $candidate 'index.html'
  }

  return $candidate
}

function Start-LocalListener {
  $ports = @($PreferredPort) + (${fallbackPortStart}..${fallbackPortEnd})

  foreach ($port in $ports) {
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Prefixes.Add("http://localhost:$port/")

    try {
      $listener.Start()
      return @{ Listener = $listener; Port = $port }
    } catch {
      $listener.Close()
    }
  }

  throw 'Could not start local study server on the configured localhost ports.'
}

$server = Start-LocalListener
$listener = $server.Listener
$port = $server.Port
$studyUrl = "http://127.0.0.1:$port/?mode=${mode}"

Write-Host ''
Write-Host ${psString(runningMessage)}
Write-Host "Opening $studyUrl"
Write-Host ${psString(leaveOpenMessage)}
Write-Host 'Press Ctrl+C or close this window when finished.'
Write-Host ''

if (!$NoBrowser) {
  Start-Process $studyUrl
}

try {
  while ($listener.IsListening) {
    try {
      $context = $listener.GetContext()
    } catch {
      if ($listener.IsListening) {
        Write-Host "Request accept failed; keeping local server alive: $($_.Exception.Message)"
        Start-Sleep -Milliseconds 250
        continue
      }

      throw
    }

    foreach ($name in $ResponseHeaders.Keys) {
      $context.Response.Headers[$name] = $ResponseHeaders[$name]
    }

    try {
      if ($context.Request.HttpMethod -eq 'OPTIONS') {
        $context.Response.StatusCode = 204
        continue
      }

      $filePath = Get-SafeFilePath $context.Request.Url.AbsolutePath
      if (!$filePath -or !(Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $context.Response.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $contentType = $MimeTypes[$extension]
        if (!$contentType) {
          $contentType = 'application/octet-stream'
        }
        $context.Response.ContentType = $contentType
        $bytes = [IO.File]::ReadAllBytes($filePath)
      }

      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      Write-Host "Request handling failed; keeping local server alive: $($_.Exception.Message)"
    } finally {
      try { $context.Response.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
`;
}

function createReadme({
  title,
  startBatName,
  modeDescription,
  completionStep,
}) {
  return `${title}

Cách dùng:
1. Giải nén thư mục này.
2. Nhấp đúp ${startBatName}.
3. Trình duyệt sẽ tự mở.
4. Giữ cửa sổ launcher mở trong khi làm ${modeDescription}.
5. ${completionStep}

Vì sao cần launcher này:
Ứng dụng chạy trên 127.0.0.1 để camera và bộ theo dõi có thể khởi động bằng khóa phát triển.
Video và AOI chất lượng cao đã được đóng gói cục bộ trong thư mục app.

Xử lý nhanh:
- Nếu trình duyệt không tự mở, copy địa chỉ http://127.0.0.1 hiện trong cửa sổ rồi dán vào Chrome hoặc Edge.
- Nếu Windows hỏi có chạy script không, chọn cho phép chạy.
- Nếu trình duyệt hỏi quyền camera, chọn Allow hoặc Cho phép.
- Không đóng cửa sổ launcher cho đến khi hoàn tất.
`;
}

function createCombinedReadme({
  title,
  adminStartBatName,
  participantStartBatName,
  validationStartBatName,
}) {
  return `${title}

Cách dùng:
1. Giải nén thư mục này.
2. Để thiết lập hoặc xem lại dữ liệu, nhấp đúp ${adminStartBatName}.
3. Để chạy phiên người tham gia, nhấp đúp ${participantStartBatName}.
4. Để chạy kiểm tra độ chính xác, nhấp đúp ${validationStartBatName}.
5. Trình duyệt sẽ tự mở.
6. Giữ cửa sổ launcher mở cho đến khi hoàn tất.

Vì sao cần launcher này:
Ứng dụng chạy trên 127.0.0.1 để camera và bộ theo dõi có thể khởi động bằng khóa phát triển.
Video và AOI chất lượng cao đã được đóng gói cục bộ trong thư mục app.

Xử lý nhanh:
- Nếu trình duyệt không tự mở, copy địa chỉ http://127.0.0.1 hiện trong cửa sổ rồi dán vào Chrome hoặc Edge.
- Nếu Windows hỏi có chạy script không, chọn cho phép chạy.
- Nếu trình duyệt hỏi quyền camera, chọn Allow hoặc Cho phép.
- Dùng ${adminStartBatName} để thiết lập/xem lại, ${participantStartBatName} cho phiên người tham gia thật, và ${validationStartBatName} chỉ để kiểm tra độ chính xác.
`;
}

async function copyAppEntries(root, appDir) {
  for (const entry of appEntries) {
    await cp(join(root, entry), join(appDir, entry), { recursive: true });
  }

  await writeLocalDeploymentConfig(appDir);
  await copyFullQualityStudyAssets(root, appDir);

  const seesoSdkSource = join(root, 'node_modules', 'seeso', 'dist', 'seeso.min.js');
  const seesoSdkDest = join(appDir, 'vendor', 'seeso', 'seeso.min.js');
  await mkdir(join(appDir, 'vendor', 'seeso'), { recursive: true });
  await cp(seesoSdkSource, seesoSdkDest);
}

async function writeLocalDeploymentConfig(appDir) {
  const deploymentConfigPath = join(appDir, 'deployment-config.js');
  const deploymentConfig = await readFile(deploymentConfigPath, 'utf8');
  const localConfig = deploymentConfig
    .replace(/^\s*assetBaseUrl\s*:\s*['"`][^'"`]*['"`]\s*,?\s*$/gm, '')
    .replace(/^\s*aoiAssetBaseUrl\s*:\s*['"`][^'"`]*['"`]\s*,?\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  await writeFile(deploymentConfigPath, `${localConfig}\n`, 'utf8');
}

async function copyPathIntoApp(root, appDir, relativePath) {
  const sourcePath = join(root, relativePath);
  const targetPath = join(appDir, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

async function copyFullQualityStudyAssets(root, appDir) {
  await copyPathIntoApp(root, appDir, 'runpod-aoi-results-absolute-quality-with-surfaces');
  await copyPathIntoApp(root, appDir, 'assets/replacement-videos');

  for (const video of STUDY_VIDEOS) {
    await copyPathIntoApp(root, appDir, video.path);
  }
}

async function compressPackage(packageDir, zipPath) {
  const compressScript = `
$ErrorActionPreference = 'Stop'
$PackageDir = ${psQuote(resolve(packageDir))}
$ZipPath = ${psQuote(resolve(zipPath))}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $PackageDir '*') -DestinationPath $ZipPath -Force
`;

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    compressScript,
  ]);
}

export async function buildLocalModePackage({
  mode,
  packageDirName,
  zipFileName,
  startBatName,
  serverScriptName,
  preferredPort,
  fallbackPortStart,
  fallbackPortEnd,
  title,
  modeDescription,
  completionStep,
  runningMessage,
  leaveOpenMessage,
}) {
  const root = process.cwd();
  const packageDir = join(root, packageDirName);
  const appDir = join(packageDir, 'app');
  const zipPath = join(root, zipFileName);

  await resetPackageDirectory(packageDir);
  await removePath(zipPath, { force: true, maxRetries: 5, retryDelay: 200 });
  await mkdir(appDir, { recursive: true });
  await copyAppEntries(root, appDir);

  await writeFile(join(packageDir, startBatName), createStartBat({ serverScriptName }), 'utf8');
  await writeFile(
    join(packageDir, serverScriptName),
    createServerPs1({
      mode,
      preferredPort,
      fallbackPortStart,
      fallbackPortEnd,
      runningMessage,
      leaveOpenMessage,
    }),
    'utf8',
  );
  await writeFile(
    join(packageDir, 'README.txt'),
    createReadme({
      title,
      startBatName,
      modeDescription,
      completionStep,
    }),
    'utf8',
  );

  await compressPackage(packageDir, zipPath);

  console.log(`Built ${mode} localhost package at ${packageDir}`);
  console.log(`Built ${mode} localhost zip at ${zipPath}`);
}

export async function buildCombinedLocalPackage({
  packageDirName,
  zipFileName,
  title,
  launchers,
}) {
  const root = process.cwd();
  const packageDir = join(root, packageDirName);
  const appDir = join(packageDir, 'app');
  const zipPath = join(root, zipFileName);

  await resetPackageDirectory(packageDir);
  await removePath(zipPath, { force: true, maxRetries: 5, retryDelay: 200 });
  await mkdir(appDir, { recursive: true });
  await copyAppEntries(root, appDir);

  for (const launcher of launchers) {
    await writeFile(
      join(packageDir, launcher.startBatName),
      createStartBat({ serverScriptName: launcher.serverScriptName }),
      'utf8',
    );
    await writeFile(
      join(packageDir, launcher.serverScriptName),
      createServerPs1(launcher),
      'utf8',
    );
  }

  const participantLauncher = launchers.find((launcher) => launcher.mode === 'participant');
  const validationLauncher = launchers.find((launcher) => launcher.mode === 'validation');
  const adminLauncher = launchers.find((launcher) => launcher.mode === 'admin');
  await writeFile(
    join(packageDir, 'README.txt'),
    createCombinedReadme({
      title,
      adminStartBatName: adminLauncher?.startBatName ?? 'Mở Quản Trị.bat',
      participantStartBatName: participantLauncher?.startBatName ?? 'Mở Bài Nghiên Cứu.bat',
      validationStartBatName: validationLauncher?.startBatName ?? 'Mở Kiểm Tra Xác Thực.bat',
    }),
    'utf8',
  );

  await compressPackage(packageDir, zipPath);

  console.log(`Built combined localhost package at ${packageDir}`);
  console.log(`Built combined localhost zip at ${zipPath}`);
}
