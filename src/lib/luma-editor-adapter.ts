import type { CollectionItem, FusionWidgetsConfig, Widget, WidgetDataSource } from './types/widget';
import { exportDocument, importDocument, newID, type CatalogSource, type Folder, type Hub, type LumaDocument } from './luma-document';

/** Preserve native fields while the established Fusion components edit their familiar projection. */
export function folderToItem(folder: Folder): CollectionItem {
  return {
    id: folder.id, name: folder.title, hideTitle: folder.hideTitle ?? false,
    layout: folder.tileShape === 'POSTER' ? 'Poster' : folder.tileShape === 'SQUARE' ? 'Square' : 'Wide',
    backgroundImageURL: folder.coverImageUrl ?? '', lumaFolder: structuredClone(folder),
    dataSources: (folder.sources ?? folder.catalogSources as CatalogSource[] ?? []).filter(s => !s.provider || s.provider === 'addon').map(s => ({
      kind: 'addonCatalog', sourceType: 'aiometadata', lumaSource: structuredClone(s),
      payload: { addonId: s.addonId ?? '', catalogType: s.type ?? 'movie', catalogId: s.catalogId ?? '' },
    })),
  };
}
function sourceToNative(source: WidgetDataSource, index: number): CatalogSource {
  if (source.kind !== 'addonCatalog') throw new Error('For Luma, connect native Trakt or AniList lists through AIOMetadata first. No source was removed.');
  const { addonId, catalogId, catalogType } = source.payload;
  if (!catalogId.trim()) throw new Error('A catalog is incomplete. Select its catalog or remove the empty catalog entry before exporting.');
  const addon = addonId === 'YOUR_AIOMETADATA' || addonId === 'MANIFEST_URL' || addonId === '{{manifestUrl}}' ? 'preset:aiometadata' : addonId;
  return { ...source.lumaSource, id: source.lumaSource?.id ?? `source-${index}`, provider: 'addon', addonId: addon,
    type: catalogType, catalogId };
}
export function itemToFolder(item: CollectionItem): Folder {
  const raw = item.lumaFolder ?? { id: item.id, title: item.name };
  return { ...raw, id: item.id, title: item.name, hideTitle: item.hideTitle,
    tileShape: item.layout === 'Poster' ? 'POSTER' : item.layout === 'Square' ? 'SQUARE' : 'LANDSCAPE',
    coverImageUrl: item.backgroundImageURL,
    sources: [...item.dataSources.map(sourceToNative),
      ...(raw.sources ?? []).filter(s => s.provider && s.provider !== 'addon')],
  };
}
/** Drafts may contain incomplete source rows; export validates them separately. */
export function itemToDraftFolder(item: CollectionItem): Folder {
  return { ...(item.lumaFolder ?? {}), id: item.id, title: item.name, hideTitle: item.hideTitle,
    tileShape: item.layout === 'Poster' ? 'POSTER' : item.layout === 'Square' ? 'SQUARE' : 'LANDSCAPE',
    coverImageUrl: item.backgroundImageURL,
    sources: [...item.dataSources.map((s, i): CatalogSource => s.kind === 'addonCatalog'
      ? { ...s.lumaSource, id: s.lumaSource?.id ?? `source-${i}`, provider: 'addon', addonId: s.payload.addonId, type: s.payload.catalogType, catalogId: s.payload.catalogId }
      : { provider: 'unsupported-editor-source', editorSource: s }), ...(item.lumaFolder?.sources ?? []).filter(s => s.provider && s.provider !== 'addon')],
  };
}
export function documentToEditor(document: LumaDocument): FusionWidgetsConfig {
  return { exportType: 'fusionWidgets', exportVersion: 1, widgets: document.collections.map(hub => ({
    id: hub.id, title: hub.title, hideTitle: hub.hideTitle, type: 'collection.row', lumaHub: structuredClone(hub),
    dataSource: { kind: 'collection', payload: { items: hub.folders.map(folderToItem) } },
  })) };
}
export function isNativeDocument(value: unknown): boolean {
  return Array.isArray(value) || (!!value && typeof value === 'object' && 'collections' in value);
}
export function normalizeLumaImport(value: unknown): unknown {
  return isNativeDocument(value) ? documentToEditor(importDocument(value).document) : value;
}
function validateNestedSources(folder: Folder): Folder {
  for (const source of folder.sources ?? []) {
    if (source.provider === 'unsupported-editor-source') throw new Error('Connect this list through AIOMetadata before exporting for Luma.');
  }
  return { ...folder, sections: folder.sections?.map(s => ({ ...s, folders: s.folders.map(validateNestedSources) })), subfolders: folder.subfolders?.map(validateNestedSources) };
}
export function editorToDocument(widgets: Widget[]): LumaDocument {
  return { collections: widgets.map((widget): Hub => {
    if (widget.type === 'collection.row') return { ...widget.lumaHub, id: widget.id, title: widget.title,
      hideTitle: widget.hideTitle, viewMode: widget.lumaHub?.viewMode ?? 'ROWS',
      folders: widget.dataSource.payload.items.map(item => validateNestedSources(itemToFolder(item))) };
    throw new Error('Catalog rows need the catalog-row export. They cannot be represented as folder rows without changing their behavior.');
  }) };
}
export function exportEditorForLuma(widgets: Widget[], manifestUrl = ''): string {
  const document = editorToDocument(widgets);
  function portable(folder: Folder) {
    for (const source of folder.sources ?? []) if (manifestUrl && source.provider === 'addon' && source.addonId === manifestUrl) source.addonId = 'preset:aiometadata';
    folder.sections?.forEach(s => s.folders.forEach(portable)); folder.subfolders?.forEach(portable);
  }
  document.collections.forEach(hub => hub.folders.forEach(portable));
  return exportDocument(document);
}

export interface LumaExportPart {
  id: 'folders' | 'catalogs';
  label: string;
  filename: string;
  count: number;
  text: string;
  error?: string;
}

/** Use the app's two existing import contracts without turning a shelf into a folder. */
export function buildLumaExportParts(widgets: Widget[], manifestUrl = ''): LumaExportPart[] {
  const folders = widgets.filter(w => w.type === 'collection.row');
  const catalogs = widgets.filter(w => w.type === 'row.classic');
  const parts: LumaExportPart[] = [];
  function part(id: LumaExportPart['id'], label: string, filename: string, count: number, make: () => string) {
    try { parts.push({ id, label, filename, count, text: make() }); }
    catch (error) { parts.push({ id, label, filename, count, text: '', error: error instanceof Error ? error.message : 'Export failed.' }); }
  }
  if (folders.length) part('folders', 'Folder rows', 'luma-collections.json', folders.length, () => exportEditorForLuma(folders, manifestUrl));
  if (catalogs.length) part('catalogs', 'Catalog rows', 'luma-catalog-rows.json', catalogs.length, () => {
    if (catalogs.length > 128) throw new Error('Luma accepts at most 128 catalog rows per Fusion import.');
    const ids = new Set<string>();
    const requiredAddons = new Set<string>();
    const catalogRoutes = new Set<string>();
    const rows = catalogs.map((widget, index) => {
      if (widget.type !== 'row.classic') throw new Error('Expected a catalog row.');
      for (const value of [widget.id, widget.title]) {
        if (!value.trim() || value.length > 1024 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Every catalog row needs a valid title and ID.');
      }
      if (ids.has(widget.id)) throw new Error('Catalog rows have duplicate IDs.');
      ids.add(widget.id);
      const source = sourceToNative(widget.dataSource, index);
      const addonId = source.addonId === manifestUrl && manifestUrl ? 'preset:aiometadata' : source.addonId!;
      if (addonId !== 'preset:aiometadata') {
        let valid = false;
        try { const url = new URL(addonId); valid = ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && addonId.length <= 8192; } catch { /* Report below. */ }
        if (!valid) throw new Error(`“${widget.title}” needs an add-on manifest URL. Select its catalog from your connected manifest.`);
      }
      for (const value of [source.type!, source.catalogId!]) {
        if (!value.trim() || value.length > 1024 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error(`“${widget.title}” has an invalid catalog route.`);
      }
      const extraKeys = Object.keys(widget.dataSource.kind === 'addonCatalog' ? widget.dataSource.lumaSource ?? {} : {}).filter(key => !['id', 'provider', 'addonId', 'type', 'catalogId'].includes(key));
      if (extraKeys.length) throw new Error(`“${widget.title}” contains native catalog options that the Fusion row importer cannot preserve. Keep it inside a hub instead.`);
      const route = JSON.stringify([addonId, source.type, source.catalogId]);
      if (catalogRoutes.has(route)) throw new Error(`“${widget.title}” repeats a catalog already used by another Home row. Luma requires distinct catalogs in one import.`);
      catalogRoutes.add(route);
      requiredAddons.add(addonId);
      return { id: widget.id, title: widget.title, type: 'row.classic', dataSource: { kind: 'addonCatalog', payload: { addonId, type: source.type, catalogId: source.catalogId } } };
    });
    if (requiredAddons.size > 32) throw new Error('Luma accepts at most 32 add-on dependencies per import.');
    const text = JSON.stringify({ exportType: 'fusionWidgets', exportVersion: 1, requiredAddons: [...requiredAddons], widgets: rows }, null, 2);
    if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('The file exceeds 4 MB.');
    return text;
  });
  return parts;
}
export function cloneFolder(folder: Folder): Folder {
  const copy = structuredClone(folder); copy.id = newID();
  const keys = new Map<string, string>();
  copy.sources = copy.sources?.map(s => { const id = newID(); if (s.id) keys.set(`catalog:${s.id}`, `catalog:${id}`); return { ...s, id }; });
  copy.sections = copy.sections?.map(s => { const id = newID(); keys.set(`section:${s.id}`, `section:${id}`); return { ...s, id, folders: s.folders.map(cloneFolder) }; });
  copy.subfolders = copy.subfolders?.map(cloneFolder);
  copy.blockOrder = copy.blockOrder?.map(k => keys.get(k) ?? k);
  return copy;
}

export function applyAnimatedCovers(widgets: Widget[], covers: { title: string; videoURL: string; backgroundURL: string }[]): { widgets: Widget[]; matched: number; updated: number } {
  const key = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const byTitle = new Map(covers.map(c => [key(c.title), c]));
  let matched = 0, updated = 0;
  function visit(folder: Folder): Folder {
    const cover = byTitle.get(key(folder.title));
    const next = structuredClone(folder);
    if (cover) {
      matched++;
      if (!next.focusVideoUrl) { next.focusVideoUrl = cover.videoURL; next.focusGifEnabled = true; updated++; }
      if (!next.coverImageUrl) next.coverImageUrl = cover.backgroundURL;
      if (!next.heroBackdropUrl) next.heroBackdropUrl = cover.backgroundURL;
    }
    next.sections = next.sections?.map(s => ({ ...s, folders: s.folders.map(visit) }));
    next.subfolders = next.subfolders?.map(visit);
    return next;
  }
  return { widgets: widgets.map(w => w.type !== 'collection.row' ? w : { ...w, dataSource: { kind: 'collection', payload: { items: w.dataSource.payload.items.map(item => folderToItem(visit(itemToDraftFolder(item)))) } } }), get matched() { return matched; }, get updated() { return updated; } };
}

export function assertLegacyExportCompatible(widgets: Widget[]): void {
  for (const widget of widgets) if (widget.type === 'collection.row') for (const item of widget.dataSource.payload.items) {
    const folder = item.lumaFolder;
    if (folder && ((folder.sections?.length ?? 0) > 0 || (folder.subfolders?.length ?? 0) > 0 || (folder.sources ?? []).some(s => s.provider && s.provider !== 'addon'))) {
      throw new Error('This setup contains Luma hub pages or native sources. Choose Luma export to preserve them.');
    }
  }
}
