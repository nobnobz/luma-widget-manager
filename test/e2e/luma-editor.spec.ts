import { test, expect } from '@playwright/test';

test('build nested hubs, move folders, export, reload and undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load UME starter', exact: true }).click();
  await expect(page.getByLabel('Hub title', { exact: true })).toHaveValue('UME v4.0');
  await page.getByLabel('Hub title', { exact: true }).fill('My UME');
  const movies = page.locator('details.luma-folder').first();
  await expect(movies).toBeVisible();
  await page.getByRole('button', { name: 'Cut folder', exact: true }).first().click();
  await page.getByRole('button', { name: 'Paste folder here', exact: true }).last().click();
  // Third level exists inside the section folder and survives a native export.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Luma JSON', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('ume-v4-luma-collections.json');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const native = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(Array.isArray(native)).toBe(true);
  expect(native[0].folders.map((f: { title: string }) => f.title)).toEqual(['Series', 'Anime', 'Movies']);
  expect(native[0].folders[2].sections[0].folders[0].subfolders[0].title).toBe('Science fiction');
  await expect(page.getByRole('status')).toContainText('Export validated');
  await page.reload();
  await expect(page.getByLabel('Hub title', { exact: true })).toHaveValue('My UME');
  await page.getByRole('button', { name: 'Delete hub', exact: true }).click();
  await expect(page.getByLabel('Hub title', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Hub title', { exact: true })).toHaveValue('My UME');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('rejects malformed import and incomplete catalog exports without losing work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load UME starter', exact: true }).click();
  await page.getByLabel('Paste JSON', { exact: true }).fill('{"collections":"bad"}');
  await page.getByRole('button', { name: 'Import pasted JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('must be an array');
  await expect(page.getByLabel('Hub title', { exact: true })).toHaveValue('UME v4.0');
  await page.getByRole('button', { name: 'Add catalog', exact: true }).first().click();
  await page.getByRole('button', { name: 'Download Luma JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Catalog ID');
  await page.getByLabel('catalogId', { exact: true }).fill('popular');
  await page.getByRole('button', { name: 'Download Luma JSON', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Export validated');
});
