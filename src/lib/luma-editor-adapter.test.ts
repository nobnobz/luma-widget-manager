import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnimatedCovers, buildLumaExportParts, exportLumaHome, normalizeLumaImport, lumaDependency, assertLegacyExportCompatible, cloneFolder, documentToEditor, editorToDocument, exportEditorForLuma, folderToItem, itemToDraftFolder } from './luma-editor-adapter';
import { starterDocument } from './luma-document';
import { normalizeFusionConfigDetailed, normalizeLoadedState } from './widget-domain';
import { applyImportReview, buildImportReviewState, getImportItemSelectionKey } from './import-merge';

test('native hubs survive the existing editor normalizer, browser persistence and native export', () => {
  const native = starterDocument();
  const hub = native.collections[0]; hub.viewMode = 'TABBED_GRID'; hub.pinToTop = true; hub.custom = 'keep';
  const folder = hub.folders[0]; folder.focusVideoUrl = 'https://example.com/video.mp4'; folder.heroBackdropUrl = 'https://example.com/background.jpg';
  folder.sources = [{ id: 'catalog1', provider: 'addon', addonId: 'org.example', type: 'movie', catalogId: 'popular', genre: 'Science fiction', homeEnabled: false, customFilter: 'retain' }];
  const widgets = normalizeFusionConfigDetailed(documentToEditor(native), { allowPartialImport: true }).config.widgets;
  const restored = normalizeLoadedState(JSON.parse(JSON.stringify({ widgets, trash: [], itemTrash: [] }))).widgets;
  const exported = JSON.parse(exportEditorForLuma(restored));
  assert.equal(exported[0].custom, 'keep'); assert.equal(exported[0].pinToTop, true); assert.equal(exported[0].viewMode, 'TABBED_GRID');
  const out = exported[0].folders[0];
  assert.equal(out.focusVideoUrl, folder.focusVideoUrl); assert.equal(out.sources[0].genre, 'Science fiction'); assert.equal(out.sources[0].customFilter, 'retain'); assert.equal(out.sources[0].homeEnabled, false);
  assert.equal(out.sections[0].folders[0].subfolders[0].title, 'Science fiction');
});
test('native page updates appear in the usual import review and preserve other folders', () => {
  const native = starterDocument(); const existing = documentToEditor(native).widgets;
  native.collections[0].folders[0].sections![0].title = 'Updated section';
  const incoming = documentToEditor(native).widgets;
  const review = buildImportReviewState(existing, incoming);
  const id = incoming[0].id, folderId = native.collections[0].folders[0].id, itemKey = getImportItemSelectionKey(id, folderId);
  assert.equal(review.widgetDiffs[id].itemDiffs[folderId].status, 'updated');
  const result = applyImportReview(existing, incoming, review.widgetDiffs, { ...review, widgetSelected: { [id]: true }, itemSelected: { [itemKey]: true }, itemFieldUpdates: { [itemKey]: { name: false, image: false, catalogs: true } }, keepExistingCatalogs: false, applyMode: 'merge' });
  assert.equal(editorToDocument(result.widgets).collections[0].folders[0].sections![0].title, 'Updated section');
  assert.equal(editorToDocument(result.widgets).collections[0].folders.length, 3);
});
test('cover pack applies recursively, preserves custom videos and does not mutate the draft', () => {
  const native = starterDocument(); native.collections[0].folders[0].focusVideoUrl = 'https://example.com/custom.mp4';
  const widgets = documentToEditor(native).widgets, before = structuredClone(widgets);
  const result = applyAnimatedCovers(widgets, [{ title: 'Movies', videoURL: 'https://example.com/movie.mp4', backgroundURL: 'https://example.com/movie.jpg' }, { title: 'Science fiction', videoURL: 'https://example.com/scifi.mp4', backgroundURL: 'https://example.com/scifi.jpg' }]);
  assert.equal(result.matched, 2); assert.equal(result.updated, 1); assert.deepEqual(widgets, before);
  const out = editorToDocument(result.widgets).collections[0].folders[0];
  assert.equal(out.focusVideoUrl, 'https://example.com/custom.mp4'); assert.equal(out.sections![0].folders[0].subfolders![0].focusVideoUrl, 'https://example.com/scifi.mp4');
});
test('Fusion animated artwork survives import into the familiar editor', () => {
  const value = { exportType: 'fusionWidgets', exportVersion: 1, widgets: [{ id: 'w', title: 'Covers', type: 'collection.row', dataSource: { kind: 'collection', payload: { items: [{ id: 'f', title: 'Movies', animationURL: 'https://example.com/a.mp4', backgroundURL: 'https://example.com/a.jpg', dataSources: [] }] } } }] };
  const out = editorToDocument(normalizeFusionConfigDetailed(value).config.widgets).collections[0].folders[0];
  assert.equal(out.focusVideoUrl, 'https://example.com/a.mp4'); assert.equal(out.heroBackdropUrl, 'https://example.com/a.jpg');
});
test('native-only hub structure cannot be silently exported through a legacy format', () => {
  assert.throws(() => assertLegacyExportCompatible(documentToEditor(starterDocument()).widgets), /Choose Luma/);
});
test('draft source changes and whole-folder duplication retain nested configuration', () => {
  const native = starterDocument().collections[0].folders[0];
  const item = folderToItem(native); item.name = 'Renamed';
  const draft = itemToDraftFolder(item), cloned = cloneFolder(draft);
  assert.equal(draft.title, 'Renamed'); assert.notEqual(cloned.id, draft.id); assert.notEqual(cloned.sections![0].id, draft.sections![0].id); assert.equal(cloned.subfolders![0].title, 'Collections');
});
test('incomplete catalogs block native export instead of disappearing', () => {
  const config = documentToEditor(starterDocument()); const w = config.widgets[0];
  assert.equal(w.type, 'collection.row'); if (w.type !== 'collection.row') return;
  w.dataSource.payload.items[0].dataSources = [{ sourceType: 'aiometadata', kind: 'addonCatalog', payload: { addonId: 'YOUR_AIOMETADATA', catalogId: '', catalogType: 'movie' } }];
  assert.throws(() => exportEditorForLuma(config.widgets), /incomplete/);
  const source = w.dataSource.payload.items[0].dataSources[0];
  if (source.kind !== 'addonCatalog') throw new Error('Expected catalog');
  source.payload.catalogId = 'popular';
  assert.equal(JSON.parse(exportEditorForLuma(config.widgets))[0].folders[0].sources[0].addonId, 'preset:aiometadata');
});

function catalogRow(id = 'trending', catalogId = 'popular') {
  return { id, title: id, type: 'row.classic' as const, cacheTTL: 1800, limit: 20, presentation: { aspectRatio: 'poster' as const, cardStyle: 'medium' as const, badges: { providers: false, ratings: true } }, dataSource: { kind: 'addonCatalog' as const, sourceType: 'aiometadata' as const, payload: { addonId: 'https://example.com/manifest.json', catalogType: 'movie', catalogId } } };
}
test('mixed layouts export real poster rows separately from lossless nested folder rows', () => {
  const config = documentToEditor(starterDocument());
  config.widgets.push(catalogRow());
  const parts = buildLumaExportParts(config.widgets, 'https://example.com/manifest.json').filter(p => p.id !== 'home');
  assert.equal(parts.length, 2);
  const folders = JSON.parse(parts[0].text), catalogs = JSON.parse(parts[1].text);
  assert.equal(folders[0].folders[0].sections[0].folders[0].subfolders[0].title, 'Science fiction');
  assert.equal(catalogs.exportType, 'fusionWidgets');
  assert.equal(catalogs.widgets[0].type, 'row.classic');
  assert.equal(catalogs.widgets[0].dataSource.payload.catalogId, 'popular');
  assert.deepEqual(catalogs.requiredAddons, ['preset:aiometadata']);
  assert.equal(parts[1].filename, 'luma-catalog-rows.json');
  assert.throws(() => exportEditorForLuma(config.widgets), /catalog-row export/);
});
test('invalid catalog rows do not block the independent folder export', () => {
  const widgets = documentToEditor(starterDocument()).widgets;
  widgets.push(catalogRow('empty', ''));
  const parts = buildLumaExportParts(widgets).filter(p => p.id !== 'home');
  assert.ok(parts[0].text); assert.equal(parts[0].error, undefined);
  assert.match(parts[1].error!, /incomplete/); assert.equal(parts[1].text, '');
});
test('catalog export rejects duplicate routes and native options rather than losing behavior', () => {
  assert.match(buildLumaExportParts([catalogRow('one'), catalogRow('two')]).find(p => p.id === 'catalogs')!.error!, /repeats a catalog/);
  const row = { ...catalogRow(), dataSource: { ...catalogRow().dataSource, lumaSource: { provider: 'addon', genre: 'Comedy' } } };
  assert.match(buildLumaExportParts([row]).find(p => p.id === 'catalogs')!.error!, /cannot preserve/);
  const invalid = catalogRow(); invalid.dataSource.payload.addonId = 'org.example';
  assert.match(buildLumaExportParts([invalid]).find(p => p.id === 'catalogs')!.error!, /manifest URL/);
});

test('catalog sections and independent catalog copies survive persistence, cloning and export', () => {
  const doc = starterDocument(), folder = doc.collections[0].folders[0];
  folder.sources = [
    { id: 'popular', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', contentFilters: { includedGenreIDs: [28], excludedGenreIDs: [99], year: 2026, minimumRating: 7, release: 'released', order: 'topRated' }, lumaPresentation: { showRanking: true, future: 'keep' } },
    { id: 'discover', provider: 'tmdb', tmdbSourceType: 'DISCOVER', mediaType: 'movie', filters: { withGenres: '878', voteCountGte: '100' } },
    { id: 'popular-copy', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', genre: 'Comedy' },
  ];
  folder.catalogGroups = [{ id: 'group', title: 'Highlights', catalogIDs: ['popular', 'discover', 'popular-copy', 'unavailable'], custom: { keep: true } }];
  folder.blockOrder = ['catalog:popular', 'catalog:discover', 'catalog:popular-copy'];
  const normalized = normalizeLoadedState(JSON.parse(JSON.stringify({ widgets: documentToEditor(doc).widgets, trash: [], itemTrash: [] }))).widgets;
  const exported = JSON.parse(exportEditorForLuma(normalized))[0].folders[0];
  assert.deepEqual(exported.sources.map((s: { id: string }) => s.id), ['popular', 'discover', 'popular-copy']);
  assert.deepEqual(exported.catalogGroups, folder.catalogGroups);
  assert.deepEqual(exported.sources[0].contentFilters, folder.sources[0].contentFilters);
  assert.deepEqual(exported.sources[0].lumaPresentation, folder.sources[0].lumaPresentation);
  const copy = cloneFolder(exported);
  assert.notEqual(copy.catalogGroups![0].id, 'group');
  assert.deepEqual(copy.catalogGroups![0].catalogIDs.slice(0, 3), copy.sources!.map(s => s.id));
  assert.equal(copy.catalogGroups![0].catalogIDs[3], 'unavailable');
  assert.deepEqual(copy.blockOrder, copy.sources!.map(s => `catalog:${s.id}`));
});

test('legacy catalog identities materialize once and remain stable through draft edits', () => {
  const item = folderToItem({ id: 'f', title: 'Legacy', sources: [{ provider: 'addon', addonId: 'org.example', type: 'movie', catalogId: 'popular' }] });
  assert.ok(item.dataSources[0].kind === 'addonCatalog' && item.dataSources[0].lumaSource?.id);
  assert.deepEqual(itemToDraftFolder(item).sources, itemToDraftFolder(item).sources);
});

test('removing an add-on catalog keeps native sources in place and legacy export rejects native sections', () => {
  const item = folderToItem({ id: 'f', title: 'Mixed', sources: [
    { id: 'a', provider: 'addon', addonId: 'org.example', type: 'movie', catalogId: 'a' },
    { id: 'native', provider: 'tmdb', tmdbSourceType: 'DISCOVER' },
    { id: 'b', provider: 'addon', addonId: 'org.example', type: 'movie', catalogId: 'b' },
  ] });
  item.dataSources.shift();
  assert.deepEqual(itemToDraftFolder(item).sources!.map(s => s.id), ['native', 'b']);
  const doc = starterDocument();
  doc.collections[0].folders = [{ id: 'f', title: 'Grouped', sources: [], catalogGroups: [{ id: 'g', title: 'Group', catalogIDs: [] }] }];
  assert.throws(() => assertLegacyExportCompatible(documentToEditor(doc).widgets), /Choose Luma/);
});

test('previewing nested portable catalogs never mutates the saved editor draft', () => {
  const doc = starterDocument();
  doc.collections[0].folders[0].subfolders![0].sources = [{ provider: 'addon', addonId: 'https://example.com/manifest.json', type: 'movie', catalogId: 'popular' }];
  const widgets = documentToEditor(doc).widgets, before = structuredClone(widgets);
  const native = JSON.parse(exportEditorForLuma(widgets, 'https://example.com/manifest.json'));
  assert.equal(native[0].folders[0].subfolders[0].sources[0].addonId, 'preset:aiometadata');
  assert.deepEqual(widgets, before);
  const folder = widgets[0].type === 'collection.row' ? widgets[0].dataSource.payload.items[0].lumaFolder! : null;
  assert.ok(folder?.subfolders![0].sources![0].id);
});

test('legacy export checks current catalog edits even before a native folder is materialized', () => {
  const widget = documentToEditor({ collections: [{ id: 'h', title: 'Home', folders: [{ id: 'f', title: 'Movies', sources: [{ id: 'c', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular' }] }] }] }).widgets[0];
  if (widget.type !== 'collection.row') throw new Error('Expected folder row');
  const item = widget.dataSource.payload.items[0];
  delete item.lumaFolder;
  const source = item.dataSources[0];
  if (source.kind !== 'addonCatalog') throw new Error('Expected add-on');
  source.lumaSource = { ...source.lumaSource, provider: 'addon', contentFilters: { minimumRating: 8 } };
  assert.throws(() => assertLegacyExportCompatible([widget]), /Choose Luma/);
});

test('complete Home mirrors native Luma extensions and round trips genre collections and renamed catalogs', () => {
  const doc = starterDocument();
  const hub = doc.collections[0]; hub.title = 'Meine Startseite';
  const movies = hub.folders[0]; movies.title = 'Meine Filme';
  const genre = movies.sections![0].folders[0].subfolders![0];
  genre.title = 'Weltraum';
  genre.sources = [{ id: 'scifi', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', title: 'Neu im All', genre: 'Science Fiction', custom: { retain: true } }];
  genre.catalogGroups = [{ id: 'group', title: 'Meine Auswahl', catalogIDs: ['scifi'] }];
  const widgets = documentToEditor(doc).widgets;
  const row: import('./types/widget').RowClassicWidget = catalogRow('custom');
  row.lumaWidget = { id: 'custom', title: 'Old', extras: { language: 'de' }, enabled: false, genre: 'Drama', filters: { minimumRating: 7 }, future: { keep: true } };
  widgets.push(row, { ...structuredClone(row), id: 'copy', title: 'Andere Bezeichnung' });
  const before = structuredClone(widgets);
  const exported = JSON.parse(exportLumaHome(widgets, 'https://example.com/manifest.json'));
  assert.equal(exported.widgets.length, 3);
  assert.equal(typeof exported.widgets[0].lumaCollection, 'string');
  const native = JSON.parse(exported.widgets[0].lumaCollection);
  assert.equal(native.folders[0].sections[0].folders[0].subfolders[0].sources[0].title, 'Neu im All');
  assert.equal(exported.widgets[0].dataSource.payload.items[0].dataSources.length, 1);
  assert.equal(exported.widgets[0].dataSource.payload.items[0].dataSources[0].payload.addonId, lumaDependency('preset:aiometadata'));
  const imported = normalizeFusionConfigDetailed(normalizeLumaImport(exported)).config.widgets;
  assert.equal(imported[0].title, 'Meine Startseite');
  const folder = editorToDocument([imported[0]]).collections[0].folders[0].sections![0].folders[0].subfolders![0];
  assert.equal(folder.title, 'Weltraum'); assert.deepEqual(folder.catalogGroups, genre.catalogGroups);
  assert.deepEqual(folder.sources, genre.sources);
  assert.equal(imported[2].title, 'Andere Bezeichnung');
  assert.equal(imported[1].lumaWidget!.enabled, false);
  assert.deepEqual(imported[1].lumaWidget!.future, { keep: true });
  const again = JSON.parse(exportLumaHome(imported));
  assert.deepEqual(again.requiredAddons, exported.requiredAddons);
  assert.deepEqual(widgets, before);
});

test('native extension imports respect selected folders and reject corrupt payloads', () => {
  const exported = JSON.parse(exportLumaHome(documentToEditor(starterDocument()).widgets));
  const row = exported.widgets[0]; row.dataSource.payload.items = row.dataSource.payload.items.slice(0, 1);
  const widgets = normalizeFusionConfigDetailed(normalizeLumaImport(exported)).config.widgets;
  assert.equal(editorToDocument(widgets).collections[0].folders.length, 1);
  row.lumaCollection = '{broken';
  assert.throws(() => normalizeLumaImport(exported));
});

test('older saved drafts get catalog instance IDs recursively at export without losing renamed titles', () => {
  const widgets = documentToEditor(starterDocument()).widgets;
  if (widgets[0].type !== 'collection.row') throw new Error('Expected folders');
  const item = widgets[0].dataSource.payload.items[0];
  item.lumaFolder!.subfolders![0].sources = [{ provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', title: 'Renamed' }];
  const exported = JSON.parse(exportEditorForLuma(widgets));
  const source = exported[0].folders[0].subfolders[0].sources[0];
  assert.ok(source.id); assert.equal(source.title, 'Renamed');
  assert.equal(item.lumaFolder!.subfolders![0].sources![0].id, undefined);
});

test('keeping local catalogs does not suppress imported sections and independent genre copies', () => {
  const doc = starterDocument();
  const folder = doc.collections[0].folders[0];
  folder.sources = [{ id: 'a', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', title: 'Original' }];
  const existing = documentToEditor(doc).widgets;
  folder.sources[0].title = 'Renamed catalog';
  folder.sources.push({ ...folder.sources[0], id: 'b', genre: 'Comedy' });
  folder.catalogGroups = [{ id: 'new', title: 'Comedy section', catalogIDs: ['b'] }];
  folder.sections![0].title = 'Updated folder section';
  const incoming = documentToEditor(doc).widgets;
  const review = buildImportReviewState(existing, incoming);
  const item = folder.id, widget = doc.collections[0].id;
  const result = applyImportReview(existing, incoming, review.widgetDiffs, { ...review, widgetSelected: { [widget]: true }, itemSelected: { [getImportItemSelectionKey(widget, item)]: true }, itemFieldUpdates: { [getImportItemSelectionKey(widget, item)]: { name: true, image: true, catalogs: true } }, keepExistingCatalogs: true, applyMode: 'merge' });
  const out = editorToDocument(result.widgets).collections[0].folders[0];
  assert.equal(out.sections![0].title, 'Updated folder section');
  assert.equal(out.sources!.length, 2);
  assert.equal(out.sources![0].title, 'Renamed catalog');
  assert.deepEqual(out.catalogGroups, folder.catalogGroups);
});

test('complete Home retains all 23 genre tiles and 129 catalog references from the manager export shape', () => {
  const folders = Array.from({ length: 23 }, (_, index) => ({ id: `genre-${index}`, title: `Genre ${index}`, sources: Array.from({ length: index < 14 ? 6 : 5 }, (_, offset) => ({ id: `catalog-${index}-${offset}`, provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: `all::genre-${index}-${offset}`, title: `Renamed ${index}/${offset}` })) }));
  const widgets = documentToEditor({ collections: [{ id: 'genres', title: 'Genres', folders }] }).widgets;
  const exported = JSON.parse(exportLumaHome(widgets));
  assert.equal(exported.widgets[0].dataSource.payload.items.length, 23);
  assert.equal(exported.widgets[0].dataSource.payload.items.flatMap((f: { dataSources: unknown[] }) => f.dataSources).length, 129);
  const native = JSON.parse(exported.widgets[0].lumaCollection);
  assert.deepEqual(native.folders, folders.map(f => ({ ...f, hideTitle: false, tileShape: 'LANDSCAPE', coverImageUrl: '' })));
});

test('editing a hub preserves unsupported legacy sources until explicitly removed', () => {
  const item = folderToItem(starterDocument().collections[0].folders[0]);
  item.dataSources = [{ sourceType: 'anilist-native', kind: 'anilistCatalog', payload: { catalogType: 'trending', limit: 20 } }];
  const draft = itemToDraftFolder(item);
  const roundTrip = folderToItem(draft);
  assert.deepEqual(roundTrip.dataSources, item.dataSources);
  assert.deepEqual(itemToDraftFolder(roundTrip).sources, draft.sources);
  const removed = folderToItem({ ...draft, sources: [] });
  assert.deepEqual(removed.dataSources, []);
});
