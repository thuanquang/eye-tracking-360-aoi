import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import { STUDY_VIDEOS, getDefaultStudyVideo } from '../src/app/studyVideos.js';

const execFileAsync = promisify(execFile);

async function assertBundledDefaultAois(packageDir) {
  const defaultVideo = getDefaultStudyVideo();
  const bundledAoiPath = `${packageDir}/app/${defaultVideo.aoiPath}`;
  const sourceStat = await stat(defaultVideo.aoiPath);
  const bundledStat = await stat(bundledAoiPath);

  assert.equal(
    bundledStat.size,
    sourceStat.size,
    'Bundled default AOI file should be the full enhanced-quality JSON, not a slim subset.',
  );
}

async function assertAllStudyAssetsBundled(packageDir) {
  for (const video of STUDY_VIDEOS) {
    const bundledAoiPath = `${packageDir}/app/${video.aoiPath}`;
    const bundledVideoPath = `${packageDir}/app/${video.path}`;
    const sourceAoiStat = await stat(video.aoiPath);
    const bundledAoiStat = await stat(bundledAoiPath);
    const sourceVideoStat = await stat(video.path);
    const bundledVideoStat = await stat(bundledVideoPath);

    assert.equal(
      bundledAoiStat.size,
      sourceAoiStat.size,
      `${video.aoiPath} should be bundled at full enhanced quality.`,
    );
    assert.equal(
      bundledVideoStat.size,
      sourceVideoStat.size,
      `${video.path} should be bundled locally.`,
    );
  }
}

test('builds a double-click Windows participant localhost package', async () => {
  const participantBatName = 'Mở Bài Nghiên Cứu.bat';

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['build:participant-local'],
    'node scripts/build_participant_local_package.mjs',
  );

  await execFileAsync('node', ['scripts/build_participant_local_package.mjs']);

  await access(`participant-local/${participantBatName}`);
  await access('participant-local/serve-participant-local.ps1');
  await access('participant-local/README.txt');
  await access('participant-local/app/index.html');
  await access('participant-local/app/deployment-config.js');
  await access('participant-local/app/vendor/seeso/seeso.min.js');
  await access('eye-tracking-360-aoi-participant-local.zip');

  const launcher = await readFile(`participant-local/${participantBatName}`, 'utf8');
  assert.match(launcher, /ExecutionPolicy Bypass/);
  assert.match(launcher, /serve-participant-local\.ps1/);

  const server = await readFile('participant-local/serve-participant-local.ps1', 'utf8');
  assert.match(server, /Cross-Origin-Opener-Policy/);
  assert.match(server, /Cross-Origin-Embedder-Policy/);
  assert.match(server, /Cross-Origin-Resource-Policy/);
  assert.match(server, /mode=participant/);
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /localhost:\$port/);
  assert.match(server, /\$studyUrl = "http:\/\/127\.0\.0\.1:\$port\/\?mode=participant"/);
  assert.match(server, /try\s*\{\s*\$context = \$listener\.GetContext\(\)/);
  assert.match(server, /Request handling failed; keeping local server alive/);
  assert.match(server, /try \{ \$context\.Response\.OutputStream\.Close\(\) \} catch \{\}/);
  assert.match(server, /continue\s*\n\s*\}/);
  assert.match(server, /'\.ico'\s*=\s*'image\/x-icon'/);
  assert.match(server, /\$contentType = \$MimeTypes\[\$extension\]/);
  assert.match(server, /\[switch\]\$NoBrowser/);
  assert.match(server, /if \(!\$NoBrowser\)/);

  const deploymentConfig = await readFile('participant-local/app/deployment-config.js', 'utf8');
  assert.doesNotMatch(deploymentConfig, /assetBaseUrl\s*:/);
  assert.doesNotMatch(deploymentConfig, /aoiAssetBaseUrl\s*:/);
  assert.match(deploymentConfig, /submissionEndpoint\s*:/);
  assert.match(deploymentConfig, /seeSoLicenseKey:\s*'dev_/);
  await assertAllStudyAssetsBundled('participant-local');
  await assertBundledDefaultAois('participant-local');

  const readme = await readFile('participant-local/README.txt', 'utf8');
  assert.match(readme, /Cách dùng:/);
  assert.match(readme, new RegExp(participantBatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /Giữ cửa sổ launcher mở/);
  assert.doesNotMatch(readme, /What to do:|Troubleshooting:/);
});

test('builds a double-click Windows validation localhost package', async () => {
  const validationBatName = 'Mở Kiểm Tra Xác Thực.bat';

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['build:validation-local'],
    'node scripts/build_validation_local_package.mjs',
  );

  await execFileAsync('node', ['scripts/build_validation_local_package.mjs']);

  await access(`validation-local/${validationBatName}`);
  await access('validation-local/serve-validation-local.ps1');
  await access('validation-local/README.txt');
  await access('validation-local/app/index.html');
  await access('validation-local/app/deployment-config.js');
  await access('validation-local/app/vendor/seeso/seeso.min.js');
  await access('eye-tracking-360-aoi-validation-local.zip');

  const launcher = await readFile(`validation-local/${validationBatName}`, 'utf8');
  assert.match(launcher, /ExecutionPolicy Bypass/);
  assert.match(launcher, /serve-validation-local\.ps1/);

  const server = await readFile('validation-local/serve-validation-local.ps1', 'utf8');
  assert.match(server, /Cross-Origin-Opener-Policy/);
  assert.match(server, /Cross-Origin-Embedder-Policy/);
  assert.match(server, /Cross-Origin-Resource-Policy/);
  assert.match(server, /mode=validation/);
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /localhost:\$port/);
  assert.match(server, /\$studyUrl = "http:\/\/127\.0\.0\.1:\$port\/\?mode=validation"/);
  assert.match(server, /try\s*\{\s*\$context = \$listener\.GetContext\(\)/);
  assert.match(server, /Request handling failed; keeping local server alive/);
  assert.match(server, /try \{ \$context\.Response\.OutputStream\.Close\(\) \} catch \{\}/);
  assert.match(server, /continue\s*\n\s*\}/);
  assert.match(server, /\[switch\]\$NoBrowser/);
  assert.match(server, /if \(!\$NoBrowser\)/);

  const readme = await readFile('validation-local/README.txt', 'utf8');
  assert.match(readme, /Cách dùng:/);
  assert.match(readme, new RegExp(validationBatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /kiểm tra độ chính xác/i);
  assert.doesNotMatch(readme, /What to do:|Troubleshooting:/);

  const deploymentConfig = await readFile('validation-local/app/deployment-config.js', 'utf8');
  assert.doesNotMatch(deploymentConfig, /assetBaseUrl\s*:/);
  assert.doesNotMatch(deploymentConfig, /aoiAssetBaseUrl\s*:/);
  assert.match(deploymentConfig, /submissionEndpoint\s*:/);
  await assertAllStudyAssetsBundled('validation-local');
  await assertBundledDefaultAois('validation-local');
});

test('builds one combined localhost package with participant and validation launchers', async () => {
  const adminBatName = 'Mở Quản Trị.bat';
  const participantBatName = 'Mở Bài Nghiên Cứu.bat';
  const validationBatName = 'Mở Kiểm Tra Xác Thực.bat';

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(
    packageJson.scripts['build:local'],
    'node scripts/build_local_package.mjs',
  );

  await execFileAsync('node', ['scripts/build_local_package.mjs']);

  await access(`eye-tracking-360-aoi-local/${participantBatName}`);
  await access(`eye-tracking-360-aoi-local/${adminBatName}`);
  await access(`eye-tracking-360-aoi-local/${validationBatName}`);
  await access('eye-tracking-360-aoi-local/serve-admin-local.ps1');
  await access('eye-tracking-360-aoi-local/serve-participant-local.ps1');
  await access('eye-tracking-360-aoi-local/serve-validation-local.ps1');
  await access('eye-tracking-360-aoi-local/README.txt');
  await access('eye-tracking-360-aoi-local/app/index.html');
  await access('eye-tracking-360-aoi-local/app/deployment-config.js');
  await access('eye-tracking-360-aoi-local/app/vendor/seeso/seeso.min.js');
  await access('eye-tracking-360-aoi-local.zip');
  await assertAllStudyAssetsBundled('eye-tracking-360-aoi-local');
  await assertBundledDefaultAois('eye-tracking-360-aoi-local');

  const participantLauncher = await readFile(`eye-tracking-360-aoi-local/${participantBatName}`, 'utf8');
  assert.match(participantLauncher, /serve-participant-local\.ps1/);

  const adminLauncher = await readFile(`eye-tracking-360-aoi-local/${adminBatName}`, 'utf8');
  assert.match(adminLauncher, /serve-admin-local\.ps1/);

  const validationLauncher = await readFile(`eye-tracking-360-aoi-local/${validationBatName}`, 'utf8');
  assert.match(validationLauncher, /serve-validation-local\.ps1/);

  const adminServer = await readFile('eye-tracking-360-aoi-local/serve-admin-local.ps1', 'utf8');
  assert.match(adminServer, /mode=admin/);
  assert.match(adminServer, /localhost:\$port/);
  assert.match(adminServer, /\$studyUrl = "http:\/\/127\.0\.0\.1:\$port\/\?mode=admin"/);
  assert.match(adminServer, /try\s*\{\s*\$context = \$listener\.GetContext\(\)/);
  assert.match(adminServer, /Request handling failed; keeping local server alive/);

  const participantServer = await readFile('eye-tracking-360-aoi-local/serve-participant-local.ps1', 'utf8');
  assert.match(participantServer, /mode=participant/);
  assert.match(participantServer, /localhost:\$port/);
  assert.match(participantServer, /\$studyUrl = "http:\/\/127\.0\.0\.1:\$port\/\?mode=participant"/);
  assert.match(participantServer, /try\s*\{\s*\$context = \$listener\.GetContext\(\)/);
  assert.match(participantServer, /Request handling failed; keeping local server alive/);

  const validationServer = await readFile('eye-tracking-360-aoi-local/serve-validation-local.ps1', 'utf8');
  assert.match(validationServer, /mode=validation/);
  assert.match(validationServer, /localhost:\$port/);
  assert.match(validationServer, /\$studyUrl = "http:\/\/127\.0\.0\.1:\$port\/\?mode=validation"/);
  assert.match(validationServer, /try\s*\{\s*\$context = \$listener\.GetContext\(\)/);
  assert.match(validationServer, /Request handling failed; keeping local server alive/);

  const readme = await readFile('eye-tracking-360-aoi-local/README.txt', 'utf8');
  assert.match(readme, /Cách dùng:/);
  assert.match(readme, new RegExp(adminBatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, new RegExp(participantBatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, new RegExp(validationBatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(readme, /What to do:|Troubleshooting:/);

  const deploymentConfig = await readFile('eye-tracking-360-aoi-local/app/deployment-config.js', 'utf8');
  assert.doesNotMatch(deploymentConfig, /assetBaseUrl\s*:/);
  assert.doesNotMatch(deploymentConfig, /aoiAssetBaseUrl\s*:/);
  assert.match(deploymentConfig, /submissionEndpoint\s*:/);
});
