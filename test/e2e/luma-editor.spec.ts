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
test.beforeEach(async ({ page }) => { await mockTemplateRepository(page); await page.route('https://example.com/**', route => route.fulfill({ status: 404, body: '' })); });

test('keeps the Fusion welcome workflow and builds nested Luma pages inside its cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Luma Widget Manager', exact: true })).toBeVisible();
  await expect(page.getByTestId('welcome-import-textarea')).toBeVisible();
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const hub = await openMovies(page);
  await hub.getByText('Appearance & playback', { exact: true }).click();
  await expect(hub.getByRole('combobox', { name: 'View inside this folder', exact: true })).toHaveValue('');
  await hub.getByRole('combobox', { name: 'View inside this folder', exact: true }).selectOption('TABBED_GRID');

  await expect(hub.getByRole('button', { name: 'Add folder row', exact: true })).toBeVisible();
  await hub.getByRole('button', { name: 'Add folder row', exact: true }).click();
  await hub.getByLabel('New folder row title').fill('Curated worlds');
  await hub.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(hub.getByRole('button', { name: 'Delete folder row Curated worlds' })).toBeVisible();
  await hub.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(hub.getByRole('button', { name: 'Delete folder row Curated worlds' })).toHaveCount(0);
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders[0].sections[0].folders[0].subfolders[0].title).toBe('Science fiction');
  expect(native[0].folders[0].viewMode).toBe('TABBED_GRID');
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

test('creates catalog-free folders in collections, sections and subfolder grids without crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const widget = page.locator('[data-testid^="widget-card-"]').first();
  await widget.getByRole('button', { name: 'Expand widget', exact: true }).filter({ visible: true }).click();
  await widget.getByRole('button', { name: 'Add Folder', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Add New Folder', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create Folder', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add catalog', exact: true }).click();
  await expect(dialog.getByText('Sync manifest first', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete data source', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Add catalog', exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Folder title', exact: true }).fill('New collection folder');
  await dialog.getByRole('button', { name: 'Create Folder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(widget.getByText('New collection folder', { exact: true }).filter({ visible: true })).toBeVisible();

  await widget.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).first().click();
  await widget.getByRole('button', { name: 'Edit hub page', exact: true }).click();
  const hub = page.getByRole('dialog').filter({ hasText: 'Folder level 1 of 3' });
  for (const [location, name] of [['section', 'New section folder'], ['grid', 'New grid folder']] as const) {
    const addButtons = hub.getByRole('button', { name: /^Add folder$/i });
    await (location === 'section' ? addButtons.first() : addButtons.last()).click();
    dialog = page.getByRole('dialog', { name: 'Add New Folder', exact: true });
    await expect(dialog.getByRole('button', { name: 'Add catalog', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Folder title', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create Folder', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(hub.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders.at(-1).title).toBe('New collection folder');
  expect(native[0].folders.at(-1).sources).toEqual([]);
  expect(native[0].folders.at(-1).id).toBeTruthy();
  expect(native[0].folders[0].sections[0].folders.at(-1).title).toBe('New section folder');
  expect(native[0].folders[0].subfolders.at(-1).title).toBe('New grid folder');
  expect(errors).toEqual([]);
});

test('explains Home row types and exports catalog rows directly in a mixed layout', async ({ page }) => {
  const config = documentToEditor(starterDocument());
  config.widgets.push({ id: 'trending', title: 'Trending Movies', type: 'row.classic', cacheTTL: 1800, limit: 20, presentation: { aspectRatio: 'poster', cardStyle: 'medium', badges: { providers: false, ratings: true } }, dataSource: { kind: 'addonCatalog', sourceType: 'aiometadata', payload: { addonId: 'YOUR_AIOMETADATA', catalogType: 'movie', catalogId: 'popular' } } });
  await page.addInitScript(value => localStorage.setItem('fusion-widgets-config', JSON.stringify(value)), config);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('new-widget-button').click();
  const types = page.getByRole('group', { name: 'Row type', exact: true });
  await expect(types.getByRole('button', { name: /^Folder row/ })).toHaveAttribute('aria-pressed', 'true');
  await types.getByRole('button', { name: /^Catalog row/ }).click();
  await expect(types.getByRole('button', { name: /^Catalog row/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('new-widget-title-input').fill('New poster row');
  await page.getByTestId('new-widget-submit').click();
  await expect(page.getByRole('dialog', { name: 'AIOMetadata Setup', exact: true })).toHaveCount(0);
  const row = page.getByTestId('widget-card-trending');
  await row.getByRole('button', { name: 'Expand widget', exact: true }).filter({ visible: true }).click();
  await expect(row.getByText('Catalog for this Home row', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /delete data source/i })).toHaveCount(0);
  // An incomplete catalog row must not block downloading the valid folder rows.
  await page.getByTestId('export-button').click();
  const parts = page.getByRole('group', { name: 'Rows to export' });
  await parts.getByRole('button', { name: 'Catalog rows (2)' }).click();
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await parts.getByRole('button', { name: 'Folder rows (1)' }).click();
  const folders = JSON.parse(await page.getByTestId('export-preview-textarea').inputValue());
  expect(folders[0].folders[0].title).toBe('Movies');
  expect(errors).toEqual([]);
});

test('downloads a true Home catalog row without a folder wrapper', async ({ page }) => {
  const config = { exportType: 'fusionWidgets', exportVersion: 1, widgets: [{ id: 'trending', title: 'Trending Movies', type: 'row.classic', cacheTTL: 1800, limit: 20, presentation: { aspectRatio: 'poster', cardStyle: 'medium', badges: { providers: false, ratings: true } }, dataSource: { kind: 'addonCatalog', sourceType: 'aiometadata', payload: { addonId: 'YOUR_AIOMETADATA', catalogType: 'movie', catalogId: 'popular' } } }] };
  await page.addInitScript(value => localStorage.setItem('fusion-widgets-config', JSON.stringify(value)), config);
  await page.goto('/'); await page.getByTestId('export-button').click();
  const exported = JSON.parse(await page.getByTestId('export-preview-textarea').inputValue());
  expect(exported.widgets[0].type).toBe('row.classic');
  expect(exported.widgets[0].dataSource.payload.catalogId).toBe('movie::popular');
  expect(exported.requiredAddons).toEqual(['preset:aiometadata']);
  await expect(page.getByText(/Import this file using Luma’s Fusion import/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download(?: JSON)?$/ }).filter({ visible: true }).click();
  expect((await download).suggestedFilename()).toBe('luma-catalog-rows.json');
});
