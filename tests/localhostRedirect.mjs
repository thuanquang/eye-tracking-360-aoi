import assert from 'node:assert/strict';

import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const dialogs = [];

page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message());
  await dialog.accept();
});

try {
  await page.goto('http://127.0.0.1:5179', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('http://localhost:5179/**', { timeout: 5000 });

  assert.equal(new URL(page.url()).hostname, 'localhost');
  assert.deepEqual(dialogs, []);
} finally {
  await browser.close();
}
