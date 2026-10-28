import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnimatedCovers, buildLumaExportParts, assertLegacyExportCompatible, cloneFolder, documentToEditor, editorToDocument, exportEditorForLuma, folderToItem, itemToDraftFolder } from './luma-editor-adapter';
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
  const parts = buildLumaExportParts(config.widgets, 'https://example.com/manifest.json');
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
  const parts = buildLumaExportParts(widgets);
  assert.ok(parts[0].text); assert.equal(parts[0].error, undefined);
  assert.match(parts[1].error!, /incomplete/); assert.equal(parts[1].text, '');
});
test('catalog export rejects duplicate routes and native options rather than losing behavior', () => {
  assert.match(buildLumaExportParts([catalogRow('one'), catalogRow('two')])[0].error!, /repeats a catalog/);
  const row = { ...catalogRow(), dataSource: { ...catalogRow().dataSource, lumaSource: { provider: 'addon', genre: 'Comedy' } } };
  assert.match(buildLumaExportParts([row])[0].error!, /cannot preserve/);
  const invalid = catalogRow(); invalid.dataSource.payload.addonId = 'org.example';
  assert.match(buildLumaExportParts([invalid])[0].error!, /manifest URL/);
});
