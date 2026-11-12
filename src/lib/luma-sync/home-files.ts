import { cloneFolder, documentToEditor, editorToDocument, exportLumaHome, normalizeLumaImport } from '../luma-editor-adapter';
import { newID, validateDocument, type Hub } from '../luma-document';
import type { Widget } from '../types/widget';
import { normalizeFusionConfigDetailed } from '../widget-domain';
import { MAX_HOME_FILE_ROWS, MAX_SYNC_HOME_WIDGETS } from '../luma-home-limits';
import { homePlacements } from './home-tree';
import { publicManifestURL } from './addons';
import { collectionHomeID, collectionSource, type SyncHomeRow, type SyncProfileDraft } from './documents';
import { isJellyfinCatalogReference } from './jellyfin';

export type HomeFile = { collections: Hub[]; home: SyncHomeRow[] };

function portable(addon: string) {
  if (['YOUR_AIOMETADATA', 'MANIFEST_URL', '{{manifestUrl}}'].includes(addon)) return 'preset:aiometadata';
  if (/^[\w.-]{1,160}$/.test(addon) || addon === 'preset:aiometadata' || publicManifestURL(addon) || isJellyfinCatalogReference(addon)) return addon;
  throw new Error('This layout contains a private or configured add-on link. Import it in Luma.');
}
function checkCollections(collections: Hub[]) {
  function check(folder: Hub['folders'][number]) {
    for (const source of folder.sources ?? []) if (['addon', 'jellyfin'].includes(source.provider)) portable(source.addonId ?? '');
    folder.sections?.forEach(section => section.folders.forEach(check));
    folder.subfolders?.forEach(check);
  }
  validateDocument({ collections });
  collections.forEach(hub => hub.folders.forEach(check));
}
export function readHomeFile(raw: unknown): HomeFile | null {
  const file = raw as { exportType?: unknown; widgets?: unknown[] } | null;
  if (file?.exportType !== 'fusionWidgets') return null;
  if (!Array.isArray(file.widgets) || !file.widgets.length || file.widgets.length > MAX_HOME_FILE_ROWS) throw new Error(`Choose a Home layout with 1–${MAX_HOME_FILE_ROWS} rows.`);
  const projected = normalizeLumaImport(file) as { widgets: { dataSource?: {
    kind?: string; payload?: { addonId?: string; catalogId?: string; catalogType?: string; type?: string }
  } }[] };
  const { config } = normalizeFusionConfigDetailed(projected);
  if (config.widgets.length !== file.widgets.length) throw new Error('Some rows in this file are not supported.');
  const collections: Hub[] = [], home: SyncHomeRow[] = [];
  for (const [position, row] of config.widgets.entries()) {
    if (row.type === 'collection.row') {
      const [original] = editorToDocument([row]).collections;
      const hub = { ...original, id: newID(), folders: original.folders.map(cloneFolder) };
      collections.push(hub);
      home.push({ id: collectionHomeID(hub.id), source: collectionSource(hub.id), kind: 'collection', position, title: '', enabled: true });
    } else if (row.dataSource.kind === 'addonCatalog') {
      // The Fusion editor qualifies IDs (movie::id). Home Sync stores the
      // actual manifest route; use it before the editor's normalization.
      const source = projected.widgets[position].dataSource;
      const raw = source?.kind === 'addonCatalog' ? source.payload : undefined;
      const { addonId } = row.dataSource.payload;
      const catalogType = raw?.catalogType ?? raw?.type ?? row.dataSource.payload.catalogType;
      const catalogId = raw?.catalogId ?? row.dataSource.payload.catalogId;
      if (!catalogType || !catalogId || catalogId.length > 1024) throw new Error('This layout contains an incomplete catalog.');
      const id = newID();
      home.push({ id: `widget:${id}`, kind: 'widget', title: row.title, enabled: row.lumaWidget?.enabled !== false, position,
        source: { addonID: portable(addonId), mediaType: catalogType, catalogID: catalogId, collectionID: '' },
        widget: { ...row.lumaWidget, extras: row.lumaWidget?.extras ?? {} } });
    } else throw new Error('This layout needs a provider that cannot be imported here.');
  }
  checkCollections(collections);
  return { collections, home };
}

export function appendHomeFile(draft: SyncProfileDraft, layout: HomeFile): SyncProfileDraft {
  const position = draft.home.reduce((max, row) => Math.max(max, row.position + 1), 0);
  const home = [...draft.home, ...layout.home.map((row, index) => ({ ...row, position: position + index }))];
  const collections = [...draft.collections, ...layout.collections];
  checkCollections(layout.collections);
  validateDocument({ collections });
  if (home.filter(row => row.kind === 'widget').length > MAX_SYNC_HOME_WIDGETS) throw new Error(`A profile can contain up to ${MAX_SYNC_HOME_WIDGETS} Home widgets.`);
  return { ...draft, home, collections };
}

export function writeVisibleHome(draft: SyncProfileDraft) {
  const hubs = new Map(draft.collections.map(hub => [hub.id, hub]));
  const rows: Widget[] = [];
  for (const row of homePlacements(draft).filter(item => item.enabled)) {
    if (row.kind === 'collection') {
      const hub = hubs.get(row.source.collectionID);
      if (!hub?.folders.length) continue;
      checkCollections([hub]);
      rows.push(documentToEditor({ collections: [hub] }).widgets[0]);
    } else {
      const { addonID, mediaType, catalogID } = row.source;
      rows.push({ id: row.kind === 'widget' ? row.id.slice(7) : newID(), title: row.title || catalogID, type: 'row.classic', cacheTTL: 0, limit: 20,
        presentation: { aspectRatio: 'poster', cardStyle: 'medium', badges: { providers: false, ratings: false } },
        lumaWidget: row.widget, dataSource: { kind: 'addonCatalog', sourceType: 'aiometadata', payload: {
          addonId: portable(addonID), catalogId: catalogID, catalogType: mediaType,
        } } });
    }
  }
  return exportLumaHome(rows);
}
