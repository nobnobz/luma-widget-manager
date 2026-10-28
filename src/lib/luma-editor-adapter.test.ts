import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAnimatedCovers, assertLegacyExportCompatible, cloneFolder, documentToEditor, editorToDocument, exportEditorForLuma, folderToItem, itemToDraftFolder } from './luma-editor-adapter';
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
