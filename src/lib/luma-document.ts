/** Native Luma collections wire format. Unknown provider fields survive editing. */
export interface CatalogSource {
  id?: string; provider: string; addonId?: string; type?: string; catalogId?: string;
  title?: string; genre?: string; homeEnabled?: boolean; [key: string]: unknown;
}
export interface Section {
  id: string; title: string; folders: Folder[]; hideTitle?: boolean;
  tileShape?: string; homeEnabled?: boolean; dynamicSource?: string; [key: string]: unknown;
}
export interface Folder {
  id: string; title: string; sources?: CatalogSource[]; sections?: Section[];
  subfolders?: Folder[]; blockOrder?: string[]; tileShape?: string;
  coverImageUrl?: string; focusVideoUrl?: string; heroBackdropUrl?: string;
  hideTitle?: boolean; homeEnabled?: boolean; [key: string]: unknown;
}
export interface Hub {
  id: string; title: string; folders: Folder[]; viewMode?: string;
  hideTitle?: boolean; pinToTop?: boolean; [key: string]: unknown;
}
export interface LumaDocument { collections: Hub[]; [key: string]: unknown }
export type Path = (string | number)[];
export const MAX_DEPTH = 3;
export const newID = () => crypto.randomUUID();
export const newFolder = (title = 'New folder'): Folder => ({ id: newID(), title, tileShape: 'LANDSCAPE', sources: [] });
export const newHub = (): Hub => ({ id: newID(), title: 'New hub', viewMode: 'ROWS', showAllTab: true, folders: [] });
export function atPath(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root);
}
export function editDocument(doc: LumaDocument, edit: (draft: LumaDocument) => void): LumaDocument {
  const draft = structuredClone(doc); edit(draft); return draft;
}
export function folderDepth(folder: Folder): number {
  return 1 + Math.max(0, ...[...(folder.subfolders ?? []), ...(folder.sections ?? []).flatMap(s => s.folders)].map(folderDepth));
}
export function moveFolder(doc: LumaDocument, from: Path, to: Path, targetDepth: number): LumaDocument {
  if (from.every((key, i) => to[i] === key)) throw new Error('A folder cannot be moved into itself.');
  const folder = atPath(doc, from) as Folder;
  if (targetDepth + folderDepth(folder) - 1 > MAX_DEPTH) throw new Error('Luma supports at most three folder levels.');
  return editDocument(doc, draft => {
    // Resolve the destination before removal shifts sibling indices.
    const parent = atPath(draft, to.slice(0, -1)) as Record<string | number, unknown>;
    parent[to.at(-1)!] ??= [];
    const destination = parent[to.at(-1)!] as Folder[];
    const origin = atPath(draft, from.slice(0, -1)) as Folder[];
    const [item] = origin.splice(from.at(-1) as number, 1);
    destination.push(item);
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) throw new Error(`${label} must contain 1–1024 characters.`);
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`); return value;
}
export function validateDocument(value: unknown): asserts value is LumaDocument {
  const doc = object(value);
  let count = 0;
  function rows(value: unknown, depth: number, kind: 'hub' | 'folder' | 'section') {
    const ids = new Set();
    for (const raw of array(value, kind)) {
      if (++count > 10000) throw new Error('Too many document entries.');
      const row = object(raw); text(row.id, 'ID'); text(row.title, 'Title');
      if (ids.has(row.id)) throw new Error(`Duplicate ID: ${row.id}`); ids.add(row.id);
      if (kind === 'hub' || kind === 'section') rows(row.folders ?? [], depth, 'folder');
      else {
        if (depth > MAX_DEPTH) throw new Error('Luma supports at most three folder levels.');
        rows(row.subfolders ?? [], depth + 1, 'folder'); rows(row.sections ?? [], depth + 1, 'section');
        if (row.sources !== undefined) for (const source of array(row.sources, 'Sources')) {
          const s = object(source); text(s.provider, 'Provider');
          if (s.provider === 'addon') { text(s.addonId, 'Add-on ID'); text(s.type, 'Catalog type'); text(s.catalogId, 'Catalog ID'); }
        }
        if (row.blockOrder !== undefined && !array(row.blockOrder, 'Block order').every(x => typeof x === 'string')) throw new Error('Invalid block order.');
      }
    }
  }
  if (array(doc.collections, 'Collections').length > 500) throw new Error('Luma supports at most 500 collections per import.');
  rows(doc.collections, 1, 'hub');
}
function fusionSource(value: unknown): CatalogSource {
  const source = object(value), payload = object(source.payload);
  if (source.kind !== 'addonCatalog') throw new Error(`Fusion source ${source.kind} is not supported by Luma's Fusion importer. Export via AIOMetadata first.`);
  const allowed = ['addonId', 'catalogId', 'type'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) throw new Error('Fusion source options cannot be converted safely.');
  return { id: newID(), provider: 'addon', addonId: payload.addonId as string, catalogId: payload.catalogId as string, type: payload.type as string };
}
export function importDocument(value: unknown): { document: LumaDocument; notes: string[] } {
  const notes: string[] = [];
  let document: LumaDocument;
  if (Array.isArray(value)) document = { collections: value as Hub[] };
  else {
    const input = object(value);
    if (input.exportType === 'fusionWidgets') {
      if (input.exportVersion !== 1) throw new Error('Only Fusion export version 1 is supported.');
      const collections = array(input.widgets, 'Widgets').map(raw => {
        const widget = object(raw), source = object(widget.dataSource);
        text(widget.id, 'Widget ID'); text(widget.title, 'Widget title');
        let folders: Folder[];
        if (widget.type === 'collection.row' && source.kind === 'collection') {
          folders = array(object(source.payload).items, 'Collection items').map(raw => {
            const item = object(raw);
            return { id: newID(), title: item.title as string, hideTitle: item.hideTitle as boolean | undefined,
              tileShape: item.imageAspect === 'poster' ? 'POSTER' : item.imageAspect === 'square' ? 'SQUARE' : 'LANDSCAPE',
              coverImageUrl: item.imageURL as string | undefined, focusVideoUrl: item.animationURL as string | undefined,
              focusGifEnabled: !!item.animationURL, heroBackdropUrl: item.backgroundURL as string | undefined,
              sources: array(item.dataSources, 'Data sources').map(fusionSource) };
          });
        } else if (widget.type === 'row.classic') {
          folders = [{ ...newFolder(widget.title as string), sources: [fusionSource(source)] }];
          notes.push(`“${widget.title}”: Home catalog row converted to a folder in its own collection. Native collection files do not carry Home row placement.`);
        } else throw new Error(`Unsupported Fusion widget: ${widget.type}`);
        return { id: `fusion.${widget.id}`, title: widget.title as string, hideTitle: widget.hideTitle as boolean | undefined, viewMode: 'ROWS', folders };
      });
      document = { collections };
      notes.unshift('Fusion imported. For nested hubs, export as native Luma collections.');
    } else document = input as LumaDocument;
  }
  validateDocument(document);
  return { document, notes };
}
export function parseDocument(text: string) {
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('The file exceeds 4 MB.');
  return importDocument(JSON.parse(text));
}
export function exportDocument(document: LumaDocument): string {
  validateDocument(document);
  // iOS requires the bare array; macOS and tvOS accept it too.
  const text = JSON.stringify(document.collections, null, 2);
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) throw new Error('The file exceeds 4 MB.');
  return text;
}
export function starterDocument(): LumaDocument {
  const hub = newHub(); hub.title = 'UME v4.0';
  const movies = newFolder('Movies');
  const genres = newFolder('Genres'); genres.subfolders = [newFolder('Science fiction'), newFolder('Thriller')];
  movies.sections = [{ id: newID(), title: 'Explore', tileShape: 'LANDSCAPE', folders: [genres, newFolder('Decades')] }];
  movies.subfolders = [newFolder('Collections')];
  movies.blockOrder = [`section:${movies.sections[0].id}`];
  hub.folders = [movies, newFolder('Series'), newFolder('Anime')];
  return { collections: [hub] };
}
