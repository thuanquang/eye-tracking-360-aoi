import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

const entries = [
  '_headers',
  'deployment-config.js',
  'index.html',
  'styles.css',
  'src',
];
const seesoSdkSource = join(root, 'node_modules', 'seeso', 'dist', 'seeso.min.js');
const seesoSdkDest = join(dist, 'vendor', 'seeso', 'seeso.min.js');

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

for (const entry of entries) {
  await cp(join(root, entry), join(dist, entry), { recursive: true });
}

await mkdir(join(dist, 'vendor', 'seeso'), { recursive: true });
await cp(seesoSdkSource, seesoSdkDest);

console.log(`Built Cloudflare Pages static bundle at ${dist}`);
