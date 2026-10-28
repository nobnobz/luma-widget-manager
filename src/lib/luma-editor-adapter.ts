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
    return { ...widget.lumaHub, id: widget.id, title: widget.title, viewMode: 'ROWS',
      folders: [{ id: `${widget.id}.catalog`, title: widget.title, tileShape: 'POSTER', sources: [sourceToNative(widget.dataSource, 0)] }] };
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
