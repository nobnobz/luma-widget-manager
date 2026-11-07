import { test, expect, type Page, type Locator } from '@playwright/test';
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
  await page.getByRole('button', { name: /^Folder rows \(/ }).click();
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
  await page.getByText('Packs and tools', { exact: true }).click();
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
  await expect(dialog.getByRole('button', { name: 'Add catalog', exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Folder title', exact: true }).fill('New collection folder');
  await dialog.getByRole('button', { name: 'Create Folder', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(widget.getByText('New collection folder', { exact: true }).filter({ visible: true })).toBeVisible();

  await widget.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).first().click();
  await widget.getByRole('button', { name: 'Edit hub page', exact: true }).click();
  const hub = page.getByRole('dialog').filter({ hasText: 'Folder level 1 of 3' });
  await hub.getByText(/Explore · 2 folders/).click();
  for (const [location, name] of [['section', 'New section folder'], ['grid', 'New grid folder']] as const) {
    const addButtons = hub.getByRole('button', { name: /^Add folder$/i });
    await (location === 'section' ? addButtons.first() : addButtons.last()).click();
    dialog = page.getByRole('dialog', { name: 'Add New Folder', exact: true });
    await expect(dialog.getByRole('button', { name: 'Add catalog', exact: true })).toHaveCount(0);
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
  await page.getByRole('button', { name: /^Catalog rows \(/ }).click();
  const exported = JSON.parse(await page.getByTestId('export-preview-textarea').inputValue());
  expect(exported.widgets[0].type).toBe('row.classic');
  expect(exported.widgets[0].dataSource.payload.catalogId).toBe('movie::popular');
  expect(exported.requiredAddons).toEqual(['preset:aiometadata']);
  await expect(page.getByText(/Import this file using Luma’s Fusion import/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download(?: JSON)?$/ }).filter({ visible: true }).click();
  expect((await download).suggestedFilename()).toBe('luma-catalog-rows.json');
});

test('builds catalog sections and filtered native catalogs through the hub editor and keeps them on reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  const hub = await openMovies(page);
  await hub.getByRole('button', { name: 'Add TMDB catalog', exact: true }).click();
  await hub.getByText('1. New catalog · tmdb', { exact: true }).click();
  await hub.getByLabel('Catalog title', { exact: true }).fill('Sci-fi discoveries');
  await hub.getByText('Filters and sorting', { exact: true }).click();
  await hub.getByLabel('Included genre IDs', { exact: true }).fill('878, 28');
  await hub.getByLabel('Year', { exact: true }).fill('2026');
  await hub.getByLabel('Minimum rating', { exact: true }).selectOption('7');
  await hub.getByLabel('Ranking numbers', { exact: true }).selectOption('true');
  await hub.getByRole('button', { name: 'Add catalog section', exact: true }).click();
  await hub.getByLabel('Catalog section title', { exact: true }).fill('Explore new worlds');
  await hub.getByRole('checkbox', { name: 'Sci-fi discoveries', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('catalog-sections.png') });
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page), folder = native[0].folders[0];
  expect(folder.sources[0].contentFilters).toMatchObject({ includedGenreIDs: [878, 28], year: 2026, minimumRating: 7 });
  expect(folder.sources[0].lumaPresentation.showRanking).toBe(true);
  expect(folder.catalogGroups[0]).toMatchObject({ title: 'Explore new worlds', catalogIDs: [folder.sources[0].id] });
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fusion-widgets-config') || '{}').widgets?.[0]?.dataSource?.payload?.items?.[0]?.lumaFolder?.catalogGroups?.[0]?.title)).toBe('Explore new worlds');
  await page.reload();
  const restored = await nativePreview(page);
  expect(restored[0].folders[0].catalogGroups).toEqual(folder.catalogGroups);
  expect(restored[0].folders[0].sources).toEqual(folder.sources);
});

test('imports a native Luma Home envelope and downloads all genre sections without flattening', async ({ page }) => {
  const doc = starterDocument();
  const hub = doc.collections[0]; hub.id = 'home-genres'; hub.title = 'Meine Genres';
  hub.folders[0].title = 'Meine Filme';
  hub.folders[0].catalogGroups = [{ id: 'science', title: 'Entdecken', catalogIDs: ['catalog'] }];
  hub.folders[0].sources = [{ id: 'catalog', provider: 'tmdb', tmdbSourceType: 'DISCOVER', title: 'Neue Welten', filters: { withGenres: '878' } }];
  const envelope = { exportType: 'fusionWidgets', exportVersion: 1, requiredAddons: [], widgets: [{ id: 'collection.home-genres', title: hub.title, type: 'collection.row', lumaCollection: JSON.stringify(hub), dataSource: { kind: 'collection', payload: { items: hub.folders.map(folder => ({ id: folder.id, title: folder.title, dataSources: [] })) } } }] };
  await page.goto('/');
  await page.getByTestId('welcome-import-textarea').fill(JSON.stringify(envelope));
  await page.getByTestId('welcome-load-configuration').click();
  await expect(page.getByTestId('widget-card-home-genres')).toContainText('Meine Genres');
  const editor = await openMovies(page);
  await expect(editor).toContainText('Neue Welten');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('export-button').click();
  const exported = JSON.parse(await page.getByTestId('export-preview-textarea').inputValue());
  const native = JSON.parse(exported.widgets[0].lumaCollection);
  expect(native.title).toBe('Meine Genres');
  expect(native.folders[0].title).toBe('Meine Filme');
  expect(native.folders[0].sections[0].folders[0].subfolders[0].title).toBe('Science fiction');
  expect(native.folders[0].catalogGroups[0].title).toBe('Entdecken');
  expect(native.folders[0].sources[0].title).toBe('Neue Welten');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download(?: JSON)?$/ }).filter({ visible: true }).click();
  expect((await downloading).suggestedFilename()).toBe('Luma-Home.json');
});

test('shows the nested page layout without horizontal overflow', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('welcome.png'), animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath('welcome-dark.png'), animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByTestId('new-widget-button')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('editor-header.png'), animations: 'disabled' });
  const hub = await openMovies(page);
  const layout = hub.getByRole('region', { name: 'Page layout' });
  await expect(layout).toContainText('Folder row');
  await expect(layout).toContainText('Genres');
  await layout.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('hub-layout.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await hub.getByText(/Explore · 2 folders/).click();
  await hub.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).first().click();
  await hub.getByRole('button', { name: 'Edit hub page', exact: true }).first().click();
  const nested = page.getByRole('dialog').filter({ hasText: 'Folder level 2 of 3' }).last();
  await expect(nested.getByText('Science fiction', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('nested-layout.png'), animations: 'disabled' });
});

test('manages synced add-on catalogs and filters together in the hub editor', async ({ page }) => {
  const config = documentToEditor(starterDocument());
  await page.addInitScript(value => {
    localStorage.setItem('fusion-widgets-config', JSON.stringify(value));
    localStorage.setItem('fusion-widget-manifest-catalogs', JSON.stringify([{ id: 'popular', type: 'movie', name: 'Popular films' }, { id: 'recent', type: 'movie', name: 'Recent films' }]));
  }, config);
  await page.goto('/');
  const hub = await openMovies(page);
  await hub.getByRole('button', { name: 'Choose synced catalog' }).click();
  await page.getByRole('button', { name: /Popular films/ }).click();
  await hub.getByText('1. Popular films · addon', { exact: true }).click();
  await hub.getByText('Filters and sorting', { exact: true }).click();
  await hub.getByLabel('Year', { exact: true }).fill('2024');
  await hub.getByLabel('Catalog title', { exact: true }).fill('Favorites');
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders[0].sources[0]).toMatchObject({ title: 'Favorites', catalogId: 'movie::popular', contentFilters: { year: 2024 } });
});

test('retains existing catalogs and nested folders when editing a catalog', async ({ page }, testInfo) => {
  const doc = starterDocument();
  const folder = doc.collections[0].folders[0];
  folder.sources = [
    { id: 'existing', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'movie::popular', title: 'Popular films', genre: 'Action', contentFilters: { year: 2020, includedGenreIDs: [28] }, customProviderSetting: { keep: true } },
    { id: 'second', provider: 'tmdb', title: 'Discover', tmdbSourceType: 'DISCOVER', filters: { withGenres: '878' } },
  ];
  folder.catalogGroups = [{ id: 'favorites', title: 'Favorites', catalogIDs: ['existing', 'second'], customGroupSetting: 'keep' }];
  folder.blockOrder = ['catalog:existing', `section:${folder.sections![0].id}`, 'catalog:second'];
  folder.sections![0].folders[0].subfolders![0].sources = [{ id: 'nested', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'movie::popular', title: 'Nested catalog' }];
  const config = documentToEditor(doc);
  await page.addInitScript(value => {
    if (sessionStorage.getItem('catalog-retention-seeded')) return;
    sessionStorage.setItem('catalog-retention-seeded', 'yes');
    localStorage.setItem('fusion-widgets-config', JSON.stringify(value));
    localStorage.setItem('fusion-widget-manifest-catalogs', JSON.stringify([{ id: 'popular', type: 'movie', name: 'Popular films' }]));
  }, config);
  await page.goto('/');
  const before = await nativePreview(page);
  expect(before[0].folders[0].sources).toMatchObject(folder.sources!);
  expect(before[0].folders[0].catalogGroups).toEqual(folder.catalogGroups);
  expect(before[0].folders[0].sections).toMatchObject(folder.sections!);
  expect(before[0].folders[0].subfolders).toMatchObject(folder.subfolders!);
  expect(before[0].folders[0].blockOrder).toEqual(folder.blockOrder);
  const close = page.getByRole('button', { name: 'Close drawer', exact: true });
  if (await close.isVisible()) await close.click(); else await page.keyboard.press('Escape');
  const hub = await openMovies(page);
  await hub.getByText('1. Popular films · addon', { exact: true }).click();
  await hub.getByText('Filters and sorting', { exact: true }).first().click();
  await hub.getByLabel('Year', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('catalog-editor.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await hub.getByLabel('Year', { exact: true }).first().fill('2024');
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const after = await nativePreview(page);
  const expected = structuredClone(before);
  expected[0].folders[0].sources[0].contentFilters.year = 2024;
  expect(after).toEqual(expected);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('fusion-widgets-config') || '{}').widgets?.[0]?.dataSource?.payload?.items?.[0]?.lumaFolder?.sources?.[0]?.contentFilters?.year)).toBe(2024);
  await page.reload();
  expect(await nativePreview(page)).toEqual(expected);
});

test('reorders page rows and nested folders without losing their contents', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chrome', 'Touch reordering is covered separately.');
  const doc = starterDocument();
  const folder = doc.collections[0].folders[0];
  folder.sources = [{ id: 'test-catalog', provider: 'tmdb', title: 'Discover', tmdbSourceType: 'DISCOVER', custom: 'keep' }];
  folder.blockOrder = [`section:${folder.sections![0].id}`, 'catalog:test-catalog'];
  const section = folder.sections![0];
  const config = documentToEditor(doc);
  await page.addInitScript(value => localStorage.setItem('fusion-widgets-config', JSON.stringify(value)), config);
  await page.goto('/');
  const hub = await openMovies(page);
  const layout = hub.getByRole('region', { name: 'Page layout' });
  const rowGrip = layout.getByRole('button', { name: 'Reorder Explore', exact: true });
  await rowGrip.focus();
  await page.keyboard.press('Space');
  await expect(rowGrip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[id^=DndLiveRegion]').filter({ hasText: /moved over droppable area catalog:test-catalog/ })).toBeAttached();
  await page.keyboard.press('Space');
  await expect(layout.locator('[data-testid^="page-block-"]').first()).toHaveAttribute('data-testid', 'page-block-catalog:test-catalog');
  await hub.getByText(/Explore · 2 folders/).click();
  const genreGrip = hub.getByRole('button', { name: 'Reorder Genres', exact: true }).filter({ visible: true });
  await genreGrip.focus();
  await page.keyboard.press('Space');
  await expect(genreGrip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[id^=DndLiveRegion]').filter({ hasText: `moved over droppable area ${section.folders[1].id}` })).toBeAttached();
  await page.keyboard.press('Space');
  await expect(hub.locator(`[data-testid="folder-card-${section.folders[1].id}"]`)).toBeVisible();
  const genres = hub.getByTestId(`folder-card-${section.folders[0].id}`);
  await genres.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).click();
  await genres.getByRole('button', { name: 'Edit hub page', exact: true }).click();
  const nested = page.getByRole('dialog').filter({ hasText: 'Folder level 2 of 3' }).last();
  const deeperGrip = nested.getByRole('button', { name: 'Reorder Science fiction', exact: true }).filter({ visible: true });
  await deeperGrip.focus();
  await page.keyboard.press('Space');
  await expect(deeperGrip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[id^=DndLiveRegion]').filter({ hasText: `moved over droppable area ${section.folders[0].subfolders![1].id}` })).toBeAttached();
  await page.keyboard.press('Space');
  await nested.getByRole('button', { name: 'Done', exact: true }).click();
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  const result = native[0].folders[0];
  expect(result.blockOrder).toEqual(['catalog:test-catalog', `section:${section.id}`]);
  expect(result.sections[0].folders.map((f: { title: string }) => f.title)).toEqual(['Decades', 'Genres']);
  expect(result.sections[0].folders[1].subfolders.map((f: { title: string }) => f.title)).toEqual(['Thriller', 'Science fiction']);
  expect(result.sources[0]).toMatchObject({ id: 'test-catalog', custom: 'keep' });
});

test('drags page rows and nested folder cards with the pointer or touch', async ({ page }, testInfo) => {
  const doc = starterDocument();
  const folder = doc.collections[0].folders[0];
  folder.sources = [{ id: 'test-catalog', provider: 'tmdb', title: 'Discover', tmdbSourceType: 'DISCOVER' }];
  const row = folder.sections![0];
  folder.blockOrder = [`section:${row.id}`, 'catalog:test-catalog'];
  const config = documentToEditor(doc);
  await page.addInitScript(value => localStorage.setItem('fusion-widgets-config', JSON.stringify(value)), config);
  await page.goto('/');
  const hub = await openMovies(page);
  async function drag(source: Locator, target: Locator) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    expect(from).not.toBeNull(); expect(to).not.toBeNull();
    const x = from!.x + from!.width / 2, y = from!.y + from!.height / 2;
    const endX = to!.x + to!.width / 2, endY = to!.y + to!.height / 2;
    if (testInfo.project.name === 'mobile-chrome') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (endX - x) * i / 12, y: y + (endY - y) * i / 12 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(endX, endY, { steps: 12 }); await page.mouse.up();
    }
    // Let dnd-kit's post-drag click suppression expire before the next action.
    await page.waitForTimeout(150);
  }
  const layout = hub.getByRole('region', { name: 'Page layout' });
  await drag(layout.getByRole('button', { name: 'Reorder Explore', exact: true }), layout.getByRole('button', { name: 'Reorder Discover', exact: true }));
  await expect(layout.locator('[data-testid^="page-block-"]').first()).toHaveAttribute('data-testid', 'page-block-catalog:test-catalog');
  await hub.getByText(/Explore · 2 folders/).click();
  await drag(hub.getByRole('button', { name: 'Reorder Genres', exact: true }).filter({ visible: true }), hub.getByRole('button', { name: 'Reorder Decades', exact: true }).filter({ visible: true }));
  await expect.poll(async () => hub.locator(`[data-testid="page-block-section:${row.id}"] [data-testid^="folder-card-"]`).first().getAttribute('data-testid')).toBe(`folder-card-${row.folders[1].id}`);
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  const native = await nativePreview(page);
  expect(native[0].folders[0].blockOrder).toEqual(['catalog:test-catalog', `section:${row.id}`]);
  expect(native[0].folders[0].sections[0].folders.map((entry: { title: string }) => entry.title)).toEqual(['Decades', 'Genres']);
  expect(native[0].folders[0].sections[0].folders[1].subfolders.map((entry: { title: string }) => entry.title)).toEqual(['Science fiction', 'Thriller']);
});
