import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogSource, Hub } from '../luma-document';
import { collectionHomeID, collectionSource, type SyncHomeRow, type SyncProfileDraft } from './documents';
import { addHomeItem, canMoveHome, deleteHomeNode, homeTree, moveHomeNode, reorderHome, setHomeNodeHidden } from './home-tree';
import { readHomeFile, writeVisibleHome } from './home-files';

const classic = { addonID: 'org.catalog', mediaType: 'movie', catalogID: 'top', collectionID: '' };
const baseRow: SyncHomeRow = { id: 'catalog:base', kind: 'catalog', title: '', position: 0, enabled: true, source: classic };
const widget = (id: string, enabled = true, source = classic, data = {}): SyncHomeRow => ({
  id: 'widget:' + id, kind: 'widget', title: id, source, position: 1, enabled, widget: { extras: {}, ...data },
});
const cat = (id: string): CatalogSource => ({ id, provider: 'addon', addonId: 'org.catalog', type: 'movie', catalogId: id, title: id });
const hub: Hub = { id: 'discover', title: 'Discover', pinToTop: true, folders: [
  { id: 'lists', title: 'Lists', sources: [cat('first'), cat('second'), cat('third')], catalogGroups: [
    { id: 'top', title: 'Top', catalogIDs: ['second', 'first'] },
  ], sections: [{ id: 'alphabet', title: 'A–Z', folders: [{ id: 'person', title: 'Actor', coverImageUrl: 'https://i.postimg.cc/a/person.jpg',
    openTarget: 'tmdb_person', tmdbPersonId: 32, unknownNative: 'retained' }] }],
  subfolders: [{ id: 'another', title: 'Another', subfolders: [{ id: 'deepest', title: 'Deepest' }] }],
  blockOrder: ['section:alphabet', 'catalog:first', 'catalog:third'] },
  { id: 'other', title: 'Other', sources: [] },
] };
const placement: SyncHomeRow = { id: collectionHomeID(hub.id), kind: 'collection', title: '', position: 15, enabled: true, source: collectionSource(hub.id) };
const draft = (home: SyncHomeRow[] = [baseRow, placement], collections: Hub[] = [hub]): SyncProfileDraft => ({
  home, collections, addons: [], addonStatus: 'missing', formatter: [], preferences: {}, unavailablePreferences: [],
});

test('Home suppresses legacy routes even for hidden overrides while retaining deliberate repeats and other media types', () => {
  const rows = [baseRow, widget('hidden', false), widget('repeated-1'), widget('repeated-2'), widget('series', true, { ...classic, mediaType: 'series' }), placement];
  const setup = draft(rows);
  const nodes = homeTree(setup);
  assert.deepEqual(nodes.map(node => node.title), ['Discover', 'hidden', 'repeated-1', 'repeated-2', 'series']);
  assert.deepEqual(homeTree(draft([baseRow, widget('hidden', false), placement])).filter(node => !node.hidden).map(node => node.title), ['Discover']);
  assert.equal(setup.home.length, 6);
  const output = readHomeFile(JSON.parse(writeVisibleHome(setup)));
  assert.equal(output?.home.length, 4);
  assert.equal(output?.collections[0].folders[0].sections?.[0].folders[0].unknownNative, 'retained');
});

test('folder order and catalog groups are projected at their own level; moving a member preserves its settings', () => {
  const setup = draft();
  const [lists, other] = homeTree(setup)[0].children!;
  const [alphabet, top, third, another] = lists.children!;
  assert.deepEqual(lists.children!.map(node => node.title), ['A–Z', 'Top', 'third', 'Another']);
  assert.deepEqual(top.children!.map(node => node.title), ['second', 'first']);
  const reordered = reorderHome(setup, third, alphabet, lists);
  assert.deepEqual(homeTree(reordered)[0].children![0].children!.map(node => node.title), ['third', 'A–Z', 'Top', 'Another']);
  const moved = moveHomeNode(setup, top.children![0], other);
  assert.deepEqual(moved.collections[0].folders[1].sources, [cat('second')]);
  assert.deepEqual(moved.collections[0].folders[0].catalogGroups?.[0].catalogIDs, ['first']);
  assert.equal(moved.collections[0].folders[0].sections?.[0].folders[0].unknownNative, 'retained');
  assert(!canMoveHome(lists, another));
  assert(!canMoveHome(alphabet.children![0], another.children![0]));
  assert.deepEqual(deleteHomeNode(setup, top).collections[0].folders[0].sources, hub.folders[0].sources);
});

test('cross-level moves reject settings that have no equivalent and do not resurrect a legacy row', () => {
  const setup = draft([baseRow, widget('normal'), widget('hero', true, classic, { presentation: 'hero' }), placement]);
  const [root, hero, normal] = homeTree(setup);
  const target = root.children![1];
  assert(!canMoveHome(hero, target));
  const moved = moveHomeNode(setup, normal, target);
  assert.equal(moved.home.find(row => row.id === baseRow.id)?.enabled, false);
  const catalog = homeTree(moved)[0].children![1].children![0];
  assert.equal(catalog.title, 'normal');
  const back = moveHomeNode(moved, catalog);
  assert.equal(back.home.find(row => row.title === 'normal')?.source.catalogID, 'top');
  assert.equal(back.collections[0].folders[1].sources?.length, 0);
});

test('unplaced folder rows are recoverable without rewriting them and depth limits are enforced', () => {
  const setup = draft([baseRow]);
  const node = homeTree(setup).find(node => node.hub)!;
  assert.equal(node.hidden, true);
  const shown = setHomeNodeHidden(setup, node, false);
  assert.equal(shown.home.at(-1)?.source.collectionID, hub.id);
  assert.equal(shown.collections, setup.collections);
  const deepest = node.children![0].children!.at(-1)!.children![0];
  assert.throws(() => addHomeItem(shown, deepest, 'folder', 'Invalid'), /cannot be added/);
});
