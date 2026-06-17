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

  assert.equal(new URL(page.url()).hostname, '127.0.0.1');
  assert.deepEqual(dialogs, []);
} finally {
  await browser.close();
}
