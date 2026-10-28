import { test, expect, type Page } from '@playwright/test';
import { starterDocument } from '../../src/lib/luma-document';
import { documentToEditor } from '../../src/lib/luma-editor-adapter';
import { mockTemplateRepository } from '../support/app-harness';

async function openMovies(page: Page) {
  const widget = page.locator('[data-testid^="widget-card-"]').first();
  await widget.getByRole('button', { name: 'Expand widget', exact: true }).filter({ visible: true }).click();
  await widget.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).first().click();
  await widget.getByRole('button', { name: 'Edit hub page', exact: true }).click();
  return page.getByRole('dialog').filter({ hasText: 'Folder level 1 of 3' });
}
async function nativePreview(page: Page) {
  await page.getByTestId('export-button').click();
  const text = await page.getByTestId('export-preview-textarea').inputValue();
  const native = JSON.parse(text);
  expect(Array.isArray(native)).toBe(true);
  return native;
}
test.beforeEach(async ({ page }) => { await mockTemplateRepository(page); });

test('keeps the Fusion welcome workflow and builds nested Luma pages inside its cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Luma Widget Manager', exact: true })).toBeVisible();
  await expect(page.getByTestId('welcome-import-textarea')).toBeVisible();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const hub = await openMovies(page);
  await expect(hub.getByRole('button', { name: 'Add section', exact: true })).toBeVisible();
  await hub.getByRole('button', { name: 'Add section', exact: true }).click();
  await hub.getByLabel('New section title').fill('Curated worlds');
  await hub.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(hub.getByRole('button', { name: 'Delete section Curated worlds' })).toBeVisible();
  await hub.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(hub.getByRole('button', { name: 'Delete section Curated worlds' })).toHaveCount(0);
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders[0].sections[0].folders[0].subfolders[0].title).toBe('Science fiction');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('migrates existing native drafts and retains animations through reload and native download', async ({ page }) => {
  const draft = starterDocument(); draft.collections[0].folders[0].focusVideoUrl = 'https://example.com/movies.mp4';
  await page.addInitScript(doc => { if (!localStorage.getItem('migration-seeded')) { localStorage.setItem('luma-widget-manager.document.v1', JSON.stringify(doc)); localStorage.setItem('migration-seeded', 'yes'); } }, draft);
  await page.goto('/');
  let native = await nativePreview(page);
  expect(native[0].folders[0].focusVideoUrl).toBe('https://example.com/movies.mp4');
  // Wait for the existing debounced persistence before checking a reload.
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fusion-widgets-config') || '{}').widgets?.length ?? 0)).toBe(1);
  await page.reload();
  native = await nativePreview(page);
  expect(native[0].folders[0].focusVideoUrl).toBe('https://example.com/movies.mp4');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download(?: JSON)?$/ }).filter({ visible: true }).click();
  expect((await download).suggestedFilename()).toBe('luma-collections.json');
});

test('blocks incomplete catalogs and explains the separate badge import in the existing guide', async ({ page }) => {
  const config = documentToEditor(starterDocument());
  const w = config.widgets[0]; if (w.type === 'collection.row') w.dataSource.payload.items[0].dataSources.push({ kind: 'addonCatalog', sourceType: 'aiometadata', payload: { addonId: 'YOUR_AIOMETADATA', catalogId: '', catalogType: 'movie' } });
  await page.addInitScript(value => localStorage.setItem('fusion-widgets-config', JSON.stringify(value)), config);
  await page.goto('/'); await page.getByTestId('export-button').click();
  await expect(page.getByRole('alert')).toContainText('catalog is incomplete');
  await expect(page.getByRole('button', { name: /^Download(?: JSON)?$/ }).filter({ visible: true })).toBeDisabled();
  const drawerClose = page.getByRole('button', { name: 'Close drawer', exact: true });
  if (await drawerClose.isVisible()) await drawerClose.click(); else await page.keyboard.press('Escape');
  await page.locator('[data-testid^="open-setup-guide"]:visible').first().click();
  const guide = page.getByTestId('fusion-setup-guide');
  await expect(guide).toContainText('Luma Setup Guide');
  await expect(guide).toContainText('Tags have a separate importer');
});

test('applies an animated cover pack through the single pack browser and includes it in Luma export', async ({ page }) => {
  await page.route('https://example.com/**', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/Other/fusion-animated-covers*.json', route => route.fulfill({ json: [{ id: 'movies', title: 'Movies', videoURL: 'https://example.com/movie.mp4', backgroundURL: 'https://example.com/movie.jpg' }] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await page.getByRole('button', { name: 'Install Preview Pack', exact: true }).first().click();
  await page.getByRole('button', { name: 'Apply to my folders', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'animations applied' })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders[0].focusVideoUrl).toBe('https://example.com/movie.mp4');
  expect(native[0].folders[0].focusGifEnabled).toBe(true);
});
