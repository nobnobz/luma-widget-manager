import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportDocument, folderDepth, importDocument, moveFolder, newFolder, parseDocument, starterDocument, validateDocument } from './luma-document';

test('native UME hub round trips nested sections, catalogs, ordering and unknown provider fields', () => {
  const doc = starterDocument();
  const folder = doc.collections[0].folders[0];
  folder.sources = [{ id: 'catalog1', provider: 'addon', addonId: 'preset:aiometadata', type: 'movie', catalogId: 'popular', genre: 'Sci-Fi', custom: { retain: true } }];
  folder.blockOrder!.unshift('catalog:catalog1');
  folder.sections![0].dynamicSource = 'server.collection';
  assert.equal(folderDepth(folder), 3);
  assert.deepEqual(parseDocument(exportDocument(doc)).document, doc);
});
test('enforces maximum nesting and duplicate IDs without discarding valid empty layouts', () => {
  const doc = starterDocument();
  const root = doc.collections[0].folders[0];
  root.subfolders = [newFolder()]; root.subfolders[0].subfolders = [newFolder()];
  root.subfolders[0].subfolders[0].subfolders = [newFolder()];
  assert.throws(() => validateDocument(doc), /three/);
  root.subfolders = [newFolder()]; root.subfolders.push(structuredClone(root.subfolders[0]));
  assert.throws(() => validateDocument(doc), /Duplicate/);
  validateDocument({ collections: [] });
});
test('folder move uses original destination even when removal shifts indices', () => {
  const doc = { collections: [{ id: 'h', title: 'Hub', folders: [newFolder('A'), newFolder('B')] }] }, original = structuredClone(doc);
  const moved = moveFolder(doc, ['collections', 0, 'folders', 0], ['collections', 0, 'folders', 1, 'subfolders'], 2);
  assert.equal(moved.collections[0].folders[0].subfolders![0].title, 'A'); assert.deepEqual(doc, original);
});
test('move rejects self nesting and over-depth subtrees', () => {
  const doc = starterDocument();
  assert.throws(() => moveFolder(doc, ['collections', 0, 'folders', 0], ['collections', 0, 'folders', 0, 'subfolders'], 2), /itself/);
  assert.throws(() => moveFolder(doc, ['collections', 0, 'folders', 0], ['collections', 0, 'folders'], 2), /three/);
});
test('converts Fusion artwork and catalog routes; rejects unsupported sources atomically', () => {
  const input = { exportType: 'fusionWidgets', exportVersion: 1, widgets: [{ id: 'group', title: 'Movies', type: 'collection.row', dataSource: { kind: 'collection', payload: { items: [{ id: 'folder', title: 'Popular', imageAspect: 'poster', imageURL: 'https://example.com/a.jpg', animationURL: 'https://example.com/a.mp4', dataSources: [{ kind: 'addonCatalog', payload: { addonId: 'preset:aiometadata', type: 'movie', catalogId: 'movie::popular' } }] }] } } }] };
  const result = importDocument(input).document.collections[0].folders[0];
  assert.equal(result.tileShape, 'POSTER'); assert.equal(result.focusVideoUrl, 'https://example.com/a.mp4');
  assert.equal(result.sources![0].catalogId, 'movie::popular');
  input.widgets[0].dataSource.payload.items[0].dataSources[0].kind = 'unsupported';
  assert.throws(() => importDocument(input), /not supported/);
});
test('rejects malformed arrays, unsupported Fusion versions and oversized files', () => {
  assert.throws(() => importDocument({ collections: [{ id: 'hub', title: 'Hub', folders: 'oops' }] }), /array/);
  assert.throws(() => importDocument({ exportType: 'fusionWidgets', exportVersion: 2 }), /version/);
  assert.throws(() => parseDocument(' '.repeat(4 * 1024 * 1024 + 1)), /4 MB/);
});

test('checks native catalog sections and incomplete provider routes without dropping unavailable references', () => {
  const doc = starterDocument(), folder = doc.collections[0].folders[0];
  folder.catalogGroups = [{ id: 'g', title: 'Group', catalogIDs: ['uninstalled'], isEnabled: false }];
  validateDocument(doc);
  folder.sources = [{ id: 'same', provider: 'tmdb', tmdbSourceType: 'PERSON', tmdbId: 123 }, { id: 'same', provider: 'trakt', traktListId: 456 }];
  assert.throws(() => validateDocument(doc), /Duplicate catalog ID/);
  folder.sources = [{ provider: 'tmdb', tmdbSourceType: 'LIST' }];
  assert.throws(() => validateDocument(doc), /positive TMDB ID/);
  folder.sources = [{ provider: 'trakt', traktListId: '' }];
  assert.throws(() => validateDocument(doc), /positive list ID/);
  folder.sources = [];
  folder.catalogGroups[0].catalogIDs = [42 as unknown as string];
  assert.throws(() => validateDocument(doc), /Invalid group catalog IDs/);
});
