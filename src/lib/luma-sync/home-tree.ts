import { atPath, folderDepth, MAX_DEPTH, newID, validateDocument, type CatalogGroup, type CatalogSource, type Folder, type Hub, type Path, type Section } from '../luma-document';
import { cloneFolder } from '../luma-editor-adapter';
import { MAX_SYNC_HOME_WIDGETS } from '../luma-home-limits';
import { collectionHomeID, collectionSource, type SyncHomeRow, type SyncProfileDraft } from './documents';

export type HomeNode = {
  key: string;
  kind: 'hub' | 'folder' | 'section' | 'group' | 'catalog' | 'widget';
  title: string;
  ref: Path;
  hidden: boolean;
  children?: HomeNode[];
  depth: number;
  hub?: Hub;
  folder?: Folder;
  section?: Section;
  group?: CatalogGroup;
  source?: CatalogSource;
  row?: SyncHomeRow;
  owner?: Path;
  block?: string;
};
type HomeData = Pick<SyncProfileDraft, 'home' | 'collections'>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const routeKey = (addon: string, type: string, catalog: string) => JSON.stringify([addon, type, catalog]);
const keyOf = (parent: string, kind: string, id: string) => parent + '/' + kind + ':' + encodeURIComponent(id);
const rowRoute = (row: SyncHomeRow) => routeKey(row.source.addonID, row.source.mediaType, row.source.catalogID);
export const nextHomePosition = (draft: HomeData) => draft.home.reduce((pos, row) => Math.max(pos, row.position + 1), 0);

export function homePlacements(draft: HomeData) {
  const hubs = new Map(draft.collections.map(hub => [hub.id, hub]));
  // The base route stays replaced even when all of its explicit widgets are hidden.
  const overrides = new Set(draft.home.filter(row => row.kind === 'widget').map(rowRoute));
  return draft.home.filter(row => row.kind !== 'catalog' || !overrides.has(rowRoute(row))).sort((a, b) =>
    Number(hubs.get(b.source.collectionID)?.pinToTop === true) - Number(hubs.get(a.source.collectionID)?.pinToTop === true)
      || a.position - b.position || compare(a.id, b.id));
}

export function orderedFolderBlocks(folder: Folder) {
  const defaults = [
    ...(folder.sources ?? []).map((source, i) => 'catalog:' + (source.id ?? `source-${i}`)),
    ...(folder.sections ?? []).map(section => 'section:' + section.id),
  ];
  const known = new Set(defaults);
  return [...new Set([...(folder.blockOrder ?? []).filter(block => known.has(block)), ...defaults])];
}

export function homeTree(draft: HomeData) {
  function folderNode(folder: Folder, ref: Path, parent: string, depth: number): HomeNode {
    const key = keyOf(parent, 'folder', folder.id);
    const catalogs = new Map((folder.sources ?? []).map((source, i) => {
      const id = source.id ?? `source-${i}`, block = 'catalog:' + id;
      return [block, { key: keyOf(key, 'catalog', id), kind: 'catalog', title: source.title ?? '',
        hidden: source.homeEnabled === false, ref: [...ref, 'sources', i], owner: ref, source, depth, block } satisfies HomeNode];
    }));
    const blocks = new Map<string, HomeNode>(catalogs);
    const membership = new Map<string, HomeNode>();
    const groups: HomeNode[] = [];
    for (const [i, group] of (folder.catalogGroups ?? []).entries()) {
      const groupKey = keyOf(key, 'group', group.id);
      const node: HomeNode = { key: groupKey, kind: 'group', title: group.title, ref: [...ref, 'catalogGroups', i], owner: ref,
        hidden: group.isEnabled === false, group, depth, children: [] };
      for (const id of new Set(group.catalogIDs)) {
        const block = 'catalog:' + id, child = catalogs.get(block);
        if (!child || membership.has(block)) continue;
        membership.set(block, node);
        node.children!.push({ ...child, key: keyOf(groupKey, 'catalog', id) });
      }
      groups.push(node);
    }
    (folder.sections ?? []).forEach((section, i) => {
      const sectionKey = keyOf(key, 'section', section.id), path = [...ref, 'sections', i], block = 'section:' + section.id;
      blocks.set(block, { key: sectionKey, kind: 'section', title: section.title, hidden: section.homeEnabled === false,
        ref: path, owner: ref, block, section, depth,
        children: (section.folders ?? []).map((child, j) => folderNode(child, [...path, 'folders', j], sectionKey, depth + 1)) });
    });
    const children: HomeNode[] = [];
    for (const block of orderedFolderBlocks(folder)) {
      const node = membership.get(block) ?? blocks.get(block);
      if (node && !children.includes(node)) children.push(node);
    }
    children.push(...groups.filter(group => !children.includes(group)),
      ...(folder.subfolders ?? []).map((child, i) => folderNode(child, [...ref, 'subfolders', i], key, depth + 1)));
    return { key, kind: 'folder', title: folder.title, ref, depth, folder, hidden: folder.homeEnabled === false, children };
  }
  const hubs = new Map(draft.collections.map((hub, i) => [hub.id, { hub, i }]));
  const rowIndex = new Map(draft.home.map((row, i) => [row.id, i]));
  function hubNode(id: string, row?: SyncHomeRow): HomeNode {
    const entry = hubs.get(id), key = keyOf('', 'hub', id), ref = ['collections', entry?.i ?? -1];
    return { key, kind: 'hub', title: entry?.hub.title || 'Unavailable folder row', ref, row, hub: entry?.hub, depth: 0,
      hidden: row?.enabled !== true, children: entry?.hub.folders.map((folder, i) => folderNode(folder, [...ref, 'folders', i], key, 1)) };
  }
  const result = homePlacements(draft).map((row): HomeNode => row.kind === 'collection' ? hubNode(row.source.collectionID, row)
    : { key: keyOf('', row.kind, row.id), kind: row.kind, title: row.title, ref: ['home', rowIndex.get(row.id)!], row, depth: 0, hidden: !row.enabled });
  const placed = new Set(result.filter(node => node.kind === 'hub').map(node => node.row!.source.collectionID));
  for (const id of hubs.keys()) if (!placed.has(id)) result.push(hubNode(id));
  return result;
}

export function walkHome(nodes: HomeNode[], visit: (node: HomeNode, parents: HomeNode[]) => void, parents: HomeNode[] = []) {
  for (const node of nodes) {
    visit(node, parents);
    if (node.children?.length) walkHome(node.children, visit, [...parents, node]);
  }
}
const rawAt = <T>(draft: HomeData, ref: Path) => atPath(draft, ref) as T;
const itemsAt = (draft: HomeData, ref: Path) => rawAt<Record<string, unknown>[]>(draft, ref.slice(0, -1));
export const homeNodeValue = (node: HomeNode) => node.hub ?? node.folder ?? node.section ?? node.group ?? node.source ?? node.row;
const samePath = (a: Path, b: Path) => a.length === b.length && a.every((part, i) => part === b[i]);
const startsAt = (a: Path, b: Path) => b.every((part, i) => part === a[i]);
function makeDraft(draft: SyncProfileDraft) {
  return { ...draft, home: structuredClone(draft.home), collections: structuredClone(draft.collections) };
}
function checked(draft: SyncProfileDraft) {
  validateDocument({ collections: draft.collections });
  if (draft.home.filter(row => row.kind === 'widget').length > MAX_SYNC_HOME_WIDGETS) throw Error('This profile has reached Luma’s widget limit.');
  return draft;
}
export function updateHomeNode(draft: SyncProfileDraft, node: HomeNode, updates: object) {
  const next = makeDraft(draft);
  Object.assign(rawAt<object>(next, node.ref), updates);
  return checked(next);
}
export function setHomeNodeHidden(draft: SyncProfileDraft, node: HomeNode, hidden: boolean) {
  if (node.kind !== 'hub') return updateHomeNode(draft, node, node.row ? { enabled: !hidden } : node.group ? { isEnabled: !hidden } : { homeEnabled: !hidden });
  const row = node.row;
  return { ...draft, home: row ? draft.home.map(old => old.id === row.id ? { ...old, enabled: !hidden } : old)
    : !hidden && node.hub ? [...draft.home, hubPlacement(draft, node.hub.id)] : draft.home };
}
const hubPlacement = (draft: HomeData, id: string): SyncHomeRow => ({
  id: collectionHomeID(id), source: collectionSource(id), kind: 'collection', title: '', position: nextHomePosition(draft), enabled: true,
});
function widgetPlacement(draft: HomeData, source: CatalogSource, id = newID()): SyncHomeRow {
  return { id: 'widget:' + id, kind: 'widget', title: source.title ?? '', enabled: source.homeEnabled !== false,
    source: { addonID: source.addonId ?? '', mediaType: source.type ?? '', catalogID: source.catalogId ?? '', collectionID: '' },
    position: nextHomePosition(draft), widget: { extras: {}, ...(source.genre ? { genre: source.genre } : {}) } };
}
type AddKind = 'hub' | 'folder' | 'section' | 'catalog' | 'group';
export function addHomeItem(draft: SyncProfileDraft, target: HomeNode | undefined, kind: AddKind, name: string, source?: CatalogSource) {
  const next = makeDraft(draft), id = newID();
  if (kind === 'hub' && !target) {
    next.collections.push({ id, title: name, folders: [], viewMode: 'ROWS' });
    next.home.push(hubPlacement(next, id));
  } else if (kind === 'folder' && target && ['hub', 'section', 'folder'].includes(target.kind) && target.depth < MAX_DEPTH) {
    const parent = rawAt<Hub & Folder & Section>(next, target.ref);
    const key = target.kind === 'folder' ? 'subfolders' : 'folders';
    (parent[key] ??= []).push({ id, title: name, sources: [] });
  } else if (kind === 'section' && target?.folder && target.depth < MAX_DEPTH) {
    const folder = rawAt<Folder>(next, target.ref);
    (folder.sections ??= []).push({ id, title: name, folders: [] });
  } else if (kind === 'group' && target?.folder) {
    const folder = rawAt<Folder>(next, target.ref);
    (folder.catalogGroups ??= []).push({ id, title: name, catalogIDs: [] });
  } else if (kind === 'catalog' && source && !target && source.provider === 'addon') next.home.push(widgetPlacement(next, source, id));
  else if (kind === 'catalog' && source && target && (target.folder || target.group)) {
    const folder = rawAt<Folder>(next, target.owner ?? target.ref);
    (folder.sources ??= []).push({ ...source, id });
    if (target.group) rawAt<CatalogGroup>(next, target.ref).catalogIDs.push(id);
  } else throw Error('This item cannot be added here.');
  return { draft: checked(next), id };
}

function removeNested(next: HomeData, node: HomeNode) {
  if (node.owner && node.block) {
    const folder = rawAt<Folder>(next, node.owner);
    if (folder.blockOrder) folder.blockOrder = folder.blockOrder.filter(block => block !== node.block);
    if (node.source?.id) for (const group of folder.catalogGroups ?? []) group.catalogIDs = group.catalogIDs.filter(id => id !== node.source!.id);
  }
  itemsAt(next, node.ref).splice(Number(node.ref.at(-1)), 1);
}
export function deleteHomeNode(draft: SyncProfileDraft, node: HomeNode) {
  if (node.kind === 'catalog' && node.row || node.kind === 'hub' && !node.hub) return setHomeNodeHidden(draft, node, true);
  const next = makeDraft(draft);
  if (node.hub) next.home = next.home.filter(row => row.id !== node.row?.id);
  removeNested(next, node);
  return checked(next);
}
export function duplicateHomeNode(draft: SyncProfileDraft, node: HomeNode) {
  const next = makeDraft(draft), id = newID(), title = (node.title || node.source?.catalogId || 'Widget').slice(0, 1016) + ' (copy)';
  if (node.hub) {
    next.collections.splice(Number(node.ref.at(-1)) + 1, 0, { ...node.hub, title, id, folders: node.hub.folders.map(cloneFolder) });
    if (!node.hidden) next.home.push(hubPlacement(next, id));
  } else if (node.row) {
    if (node.kind === 'hub') throw Error('This folder row is unavailable.');
    next.home.push({ ...node.row, title, id: 'widget:' + id, kind: 'widget', position: nextHomePosition(next), widget: node.row.widget ?? { extras: {} } });
  } else if (node.folder) itemsAt(next, node.ref).splice(Number(node.ref.at(-1)) + 1, 0, { ...cloneFolder(node.folder), id, title });
  else if (node.section) itemsAt(next, node.ref).splice(Number(node.ref.at(-1)) + 1, 0, { ...node.section, id, title, folders: node.section.folders.map(cloneFolder) });
  else if (node.source) {
    itemsAt(next, node.ref).splice(Number(node.ref.at(-1)) + 1, 0, { ...node.source, id, title });
    const folder = rawAt<Folder>(next, node.owner!);
    for (const group of folder.catalogGroups ?? []) if (node.source.id && group.catalogIDs.includes(node.source.id)) group.catalogIDs.splice(group.catalogIDs.indexOf(node.source.id) + 1, 0, id);
  } else throw Error('Duplicate the individual catalogs in this section.');
  return checked(next);
}

const relocate = <T>(values: T[], from: number, to: number) => {
  const next = [...values];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};
function blockFor(folder: Folder, node: HomeNode) {
  if (!node.group) return node.block;
  const members = new Set(node.group.catalogIDs.map(id => 'catalog:' + id));
  return orderedFolderBlocks(folder).find(block => members.has(block));
}
export function canReorderHome(a: HomeNode, b: HomeNode, parent?: HomeNode) {
  if (a.hidden || b.hidden) return false;
  if (!parent) return !!a.row && !!b.row && (a.hub?.pinToTop === true) === (b.hub?.pinToTop === true);
  if (parent.group) return !!a.source?.id && !!b.source?.id;
  if (samePath(a.ref.slice(0, -1), b.ref.slice(0, -1)) && !a.block && !a.group && !b.block && !b.group) return true;
  return !!parent.folder && !!blockFor(parent.folder, a) && !!blockFor(parent.folder, b);
}
export function reorderHome(draft: SyncProfileDraft, a: HomeNode, b: HomeNode, parent?: HomeNode) {
  if (a === b || !canReorderHome(a, b, parent)) return draft;
  const next = makeDraft(draft);
  if (!parent) {
    const order = [...next.home].sort((x, y) => x.position - y.position || compare(x.id, y.id));
    const ids = new Set(homePlacements(next).filter(row => row.enabled &&
      (next.collections.find(hub => hub.id === row.source.collectionID)?.pinToTop === true) === (a.hub?.pinToTop === true)).map(row => row.id));
    const slots = order.filter(row => ids.has(row.id));
    const ordered = relocate(slots, slots.findIndex(row => row.id === a.row!.id), slots.findIndex(row => row.id === b.row!.id));
    let index = 0;
    next.home = order.map((row, position) => ({ ...(ids.has(row.id) ? ordered[index++] : row), position }));
  } else if (parent.group) {
    const group = rawAt<CatalogGroup>(next, parent.ref);
    group.catalogIDs = relocate(group.catalogIDs, group.catalogIDs.indexOf(a.source!.id!), group.catalogIDs.indexOf(b.source!.id!));
  } else if (parent.folder && (a.block || a.group)) {
    const folder = rawAt<Folder>(next, parent.ref), order = orderedFolderBlocks(folder);
    const blockA = blockFor(folder, a)!, blockB = blockFor(folder, b)!;
    // Keep every member of a catalog section together when moving its visible anchor.
    const members = a.group ? new Set(a.group.catalogIDs.map(id => 'catalog:' + id)) : new Set([blockA]);
    const target = b.group ? new Set(b.group.catalogIDs.map(id => 'catalog:' + id)) : new Set([blockB]);
    const down = order.indexOf(blockA) < order.indexOf(blockB);
    const remain = order.filter(block => !members.has(block));
    const bound = down ? remain.findLastIndex(block => target.has(block)) + 1 : remain.findIndex(block => target.has(block));
    remain.splice(bound, 0, ...order.filter(block => members.has(block)));
    folder.blockOrder = remain;
  } else {
    const values = itemsAt(next, a.ref);
    values.splice(Number(b.ref.at(-1)), 0, ...values.splice(Number(a.ref.at(-1)), 1));
  }
  return checked(next);
}

const isDefault = (value: unknown) => value == null || value === '' ||
  typeof value === 'object' && !Object.keys(value).length;
function fits(value: Record<string, unknown>, supported: string[], neutral: string[] = []) {
  return Object.entries(value).every(([key, entry]) => supported.includes(key) || entry === undefined ||
    neutral.includes(key) && isDefault(entry));
}
function widgetFitsFolder(row: SyncHomeRow) {
  const value = row.widget ?? {};
  return fits(value, ['id', 'title', 'source', 'enabled', 'position', 'genre', 'presentation', 'showRanking'],
    ['extras', 'query', 'filters', 'mediaType']) &&
    (!value.presentation || value.presentation === 'row') && value.showRanking !== true;
}
function catalogFitsHome(source: CatalogSource) {
  return source.provider === 'addon' && !!source.addonId && !!source.type && !!source.catalogId &&
    fits(source, ['id', 'provider', 'addonId', 'type', 'catalogId', 'title', 'homeEnabled', 'genre']);
}
export function canMoveHome(node: HomeNode, target?: HomeNode) {
  if (target && startsAt(target.ref, node.ref)) return false;
  if (node.folder) {
    if (!target || !target.hub && !target.folder && !target.section || target.folder?.openTarget === 'tmdb_person') return false;
    const key = target.folder ? 'subfolders' : 'folders';
    return !samePath(node.ref.slice(0, -1), [...target.ref, key]) && target.depth + folderDepth(node.folder) <= MAX_DEPTH;
  }
  if (!node.source && node.kind !== 'widget') return false;
  if (!target) return !!node.source && catalogFitsHome(node.source);
  if (!target.folder && !target.group || target.folder?.openTarget === 'tmdb_person') return false;
  if (node.row) return widgetFitsFolder(node.row);
  // Moving between sections of the same folder changes membership, never the source ID.
  if (samePath(node.owner!, target.owner ?? target.ref)) {
    const destination = target.group && target.group.catalogIDs.includes(node.source!.id ?? '');
    const oldParent = node.key.slice(0, node.key.lastIndexOf('/'));
    return !destination && oldParent !== target.key;
  }
  return true;
}
export function moveHomeNode(draft: SyncProfileDraft, node: HomeNode, target?: HomeNode) {
  if (!canMoveHome(node, target)) throw Error('This item cannot be moved to that location without losing settings.');
  const next = makeDraft(draft);
  if (node.folder && target) {
    const parent = rawAt<Hub & Section & Folder>(next, target.ref);
    const key = target.folder ? 'subfolders' : 'folders';
    const dest = parent[key] ??= [];
    if (dest.some(folder => folder.id === node.folder!.id)) throw Error('The destination already has this folder ID.');
    removeNested(next, node);
    dest.push(node.folder);
  } else if (!target && node.source) {
    removeNested(next, node);
    next.home.push(widgetPlacement(next, node.source));
  } else if (target) {
    const folder = rawAt<Folder>(next, target.owner ?? target.ref);
    const group = target.group ? rawAt<CatalogGroup>(next, target.ref) : undefined;
    const previous = node.row;
    const source: CatalogSource = node.source ? { ...node.source } : {
      id: newID(), provider: 'addon', addonId: previous!.source.addonID, type: previous!.source.mediaType,
      catalogId: previous!.source.catalogID, title: previous!.title, homeEnabled: previous!.enabled,
      ...(typeof previous!.widget?.genre === 'string' ? { genre: previous!.widget.genre } : {}),
    };
    if (node.source && samePath(node.owner!, target.owner ?? target.ref)) {
      source.id ??= newID();
      const stored = rawAt<CatalogSource>(next, node.ref);
      if (!stored.id) {
        if (folder.blockOrder) folder.blockOrder = folder.blockOrder.map(block => block === node.block ? 'catalog:' + source.id : block);
        stored.id = source.id;
      }
      for (const current of folder.catalogGroups ?? []) current.catalogIDs = current.catalogIDs.filter(id => id !== source.id);
      group?.catalogIDs.push(source.id);
    } else {
      const id = source.id ?? newID();
      if (folder.sources?.some(other => other.id === id)) throw Error('The destination already has this catalog ID.');
      if (previous) {
        // Removing an override must not resurrect its base row.
        next.home = next.home.filter(row => row.id !== previous.id).map(row =>
          row.kind === 'catalog' && rowRoute(row) === rowRoute(previous) ? { ...row, enabled: false } : row);
      } else removeNested(next, node);
      (folder.sources ??= []).push({ ...source, id });
      group?.catalogIDs.push(id);
    }
  }
  return checked(next);
}
