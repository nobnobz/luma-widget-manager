'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CatalogCombobox } from '@/components/editor/CatalogCombobox';
import { Button } from '@/components/ui/button';
import { FilePicker } from './FilePicker';
import { type Folder } from '@/lib/luma-document';
import { syncRequest } from '@/lib/luma-sync/passkey';
import { publicManifestURL } from '@/lib/luma-sync/addons';
import { isJellyfinCatalogReference } from '@/lib/luma-sync/jellyfin';
import { readConfiguredManifest, type ManifestProjection } from '@/lib/luma-sync/manifest-reader';
import { type SyncProfileDraft } from '@/lib/luma-sync/documents';

export type Route = { addonID: string; mediaType: string; catalogID: string; title: string; provider?: string };
export type InstalledRoute = Route & { manifestURL: string; paginated?: boolean };
const installedIdentity = (route: InstalledRoute) => JSON.stringify([route.manifestURL, route.mediaType, route.catalogID]);
const noInstalledRoutes: InstalledRoute[] = [];
function catalogOption(route: Route, key: string) {
  return { type: route.mediaType, id: route.catalogID, name: route.title || route.catalogID, selectionKey: key,
    sourceName: route.provider || (route.addonID === 'preset:aiometadata' ? 'AIOMetadata' : route.addonID) };
}
const LIMIT = 2400, MAX_FILE = 2_000_000;
const identity = (route: Route) => JSON.stringify([route.addonID, route.mediaType, route.catalogID]);
const manifestID = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
function portableRoute(route: Route) {
  return (manifestID(route.addonID) || route.addonID === 'preset:aiometadata' || !!publicManifestURL(route.addonID)) &&
    /^[a-z0-9_-]{1,32}$/.test(route.mediaType) && route.catalogID.length > 0 && route.catalogID.length <= 1024;
}

function draftRoutes(home: SyncProfileDraft['home'], collections: SyncProfileDraft['collections']) {
  const routes = home.filter(row => row.kind !== 'collection' && !isJellyfinCatalogReference(row.source.addonID))
    .map(row => ({ ...row.source, title: row.title }));
  const result: Route[] = [...routes];
  function visit(folder: Folder) {
    for (const source of folder.sources ?? []) if (source.provider === 'addon' && !isJellyfinCatalogReference(source.addonId ?? '')) {
      result.push({ addonID: source.addonId ?? '', catalogID: source.catalogId ?? '', mediaType: source.type ?? '', title: source.title ?? '' });
    }
    folder.subfolders?.forEach(visit);
    folder.sections?.forEach(section => section.folders.forEach(visit));
  }
  collections.forEach(hub => hub.folders.forEach(visit));
  return result;
}
type ManifestState = { key: string; routes: InstalledRoute[]; failures: number; loading: boolean };
type CatalogIndex<T> = { byKey: Map<string, T>; options: ReturnType<typeof catalogOption>[] };
function indexCatalogs<T extends Route>(routes: T[], keyFor: (row: T) => string): CatalogIndex<T> {
  const byKey = new Map(routes.map(row => [keyFor(row), row]));
  return { byKey, options: [...byKey.entries()].map(([key, row]) => catalogOption(row, key)) };
}
type ConfiguredManifests = { key: string; rows: Map<string, ManifestProjection | null> };
const Context = createContext<{ token?: string; catalog: CatalogIndex<Route>; installed: CatalogIndex<InstalledRoute>; importManifest: (file: File) => Promise<number>; auto: boolean; manifests: ManifestState; retry: () => void;
  configured: Map<string, ManifestProjection | null>; retryConfigured: () => void } | null>(null);
export function useConfiguredManifestStatus() {
  const library = useContext(Context);
  return { rows: library?.configured, retry: library?.retryConfigured };
}
export function SyncCatalogProvider({ draft, token, children }: { draft: SyncProfileDraft; token?: string; children: ReactNode }) {
  const [imported, setImported] = useState<Route[]>([]);
  const [automatic, setAutomatic] = useState<ManifestState>({ key: '', routes: [], failures: 0, loading: false });
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [readerReady, setReaderReady] = useState(false);
  const [readerAttempt, setReaderAttempt] = useState(0);
  const [personal, setPersonal] = useState<ConfiguredManifests>({ key: '', rows: new Map() });
  const personalKey = JSON.stringify((draft.configuredAddons ?? []).filter(row => row.enabled).map(row => [row.id, row.manifestURL]).sort());
  useEffect(() => {
    const reader = frame.current?.contentWindow;
    if (!readerReady || !reader || personalKey === '[]') return;
    const controller = new AbortController(), { signal } = controller;
    const entries: [string, string][] = JSON.parse(personalKey);
    const rows = new Map<string, ManifestProjection | null>();
    let cursor = 0;
    async function scan(reader: Window) {
      while (cursor < entries.length && !signal.aborted) {
        const [id, url] = entries[cursor++];
        const result = await readConfiguredManifest(reader, url, signal);
        if (signal.aborted) return;
        rows.set(id, result);
        setPersonal({ key: personalKey, rows: new Map(rows) });
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => scan(reader)));
    return () => controller.abort();
  }, [personalKey, readerReady, readerAttempt]);
  const manifestKey = JSON.stringify([...new Set(draft.addons.filter(row => row.enabled)
    .flatMap(row => publicManifestURL(row.manifestURL) ?? []))].sort());
  useEffect(() => {
    if (!token) return;
    const urls: string[] = JSON.parse(manifestKey);
    if (!urls.length) return;
    const controller = new AbortController(), { signal } = controller;
    const loaded: InstalledRoute[] = [];
    let failures = 0;
    async function scan() {
      for (let i = 0; i < urls.length && !signal.aborted; i += 8) {
        const batch = urls.slice(i, i + 8);
        try {
          const answer = await syncRequest('/v1/editor/catalogs', { method: 'POST', body: { urls: batch }, token, signal, max: 1_650_000 });
          const rows = Array.isArray(answer.manifests) ? answer.manifests : [];
          for (const url of batch) {
            const row = rows.find(item => item?.url === url);
            if (row?.status !== 'ok' || !manifestID(row.id) || !Array.isArray(row.catalogs)) { failures++; continue; }
            for (const raw of row.catalogs.slice(0, 500)) {
              if (typeof raw?.id !== 'string' || typeof raw.type !== 'string') continue;
              const route = { addonID: row.id, mediaType: raw.type, catalogID: raw.id, manifestURL: url, paginated: raw.paginated === true,
                title: typeof raw.name === 'string' ? raw.name : '', provider: typeof row.name === 'string' && row.name ? row.name : row.id };
              if (portableRoute(route) && loaded.length < LIMIT) loaded.push(route);
            }
          }
        } catch { failures += batch.length; }
        if (!signal.aborted) setAutomatic({ key: manifestKey, routes: [...loaded], failures, loading: i + 8 < urls.length });
      }
    }
    void scan();
    return () => controller.abort();
  }, [manifestKey, token, attempt]);
  const manifests: ManifestState = automatic.key === manifestKey ? automatic
    : { key: manifestKey, routes: noInstalledRoutes, failures: 0, loading: !!token && manifestKey !== '[]' };
  const discovered = manifests.routes;
  const configured = useMemo(() => personal.key === personalKey ? personal.rows : new Map<string, ManifestProjection | null>(), [personal, personalKey]);
  const { home, collections } = draft;
  const catalog = useMemo(() => {
    const available = new Map<string, Route>();
    const personalIDs = new Map<string, number>();
    for (const manifest of configured.values()) if (manifest) personalIDs.set(manifest.id, (personalIDs.get(manifest.id) ?? 0) + 1);
    const publicIDs = new Set(discovered.map(route => route.addonID));
    const personalRoutes: Route[] = [...configured.values()].flatMap(manifest => manifest && personalIDs.get(manifest.id) === 1 && !publicIDs.has(manifest.id)
      ? manifest.catalogs.map(row => ({ addonID: manifest.id, mediaType: row.type, catalogID: row.id, title: row.name, provider: manifest.name || manifest.id })) : []);
    for (const route of [...discovered, ...personalRoutes, ...imported, ...draftRoutes(home, collections)]) {
      if (!portableRoute(route)) continue;
      const key = identity(route), old = available.get(key);
      if (!old || !!route.provider && !old.provider || !old.title && route.title) available.set(key, route);
      if (available.size >= LIMIT) break;
    }
    return indexCatalogs([...available.values()].sort((a, b) => (a.title || a.catalogID).localeCompare(b.title || b.catalogID)), identity);
  }, [home, collections, imported, discovered, configured]);
  const installed = useMemo(() => indexCatalogs(discovered, installedIdentity), [discovered]);
  async function importManifest(file: File) {
    if (file.size > MAX_FILE) throw new Error();
    const manifest = JSON.parse(await file.text());
    if (!manifestID(manifest?.id) || !Array.isArray(manifest.catalogs) || manifest.catalogs.length > LIMIT) throw new Error();
    const next: Route[] = manifest.catalogs.flatMap((row: { id?: unknown; type?: unknown; name?: unknown; extraRequired?: unknown; extra?: unknown } | null) => {
      if (typeof row?.id !== 'string' || typeof row.type !== 'string') return [];
      // Match the server's public catalog projection: a Home row can't
      // supply mandatory catalog parameters such as a search term.
      if ((Array.isArray(row.extraRequired) && row.extraRequired.length > 0) ||
        (Array.isArray(row.extra) && row.extra.some(extra => extra?.isRequired === true))) return [];
      const route = { addonID: manifest.id, catalogID: row.id, mediaType: row.type, title: typeof row.name === 'string' ? row.name.slice(0, 256) : '',
        provider: typeof manifest.name === 'string' ? manifest.name.slice(0, 128) : manifest.id };
      return portableRoute(route) ? [route] : [];
    });
    const unique = [...new Map(next.map(route => [identity(route), route])).values()];
    setImported(previous => [...unique, ...previous.filter(route => route.addonID !== manifest.id)].slice(0, LIMIT));
    return unique.length;
  }
  return <Context.Provider value={{ token, catalog, installed, importManifest, auto: !!token, manifests,
    configured, retryConfigured: () => { setPersonal({ key: '', rows: new Map() }); setReaderAttempt(n => n + 1); },
    retry: () => { setAutomatic({ key: manifestKey, routes: discovered, failures: 0, loading: true }); setAttempt(n => n + 1); } }}>
    {process.env.NEXT_PUBLIC_LUMA_CONFIGURED_ADDONS !== 'off' &&
      <iframe title="Configured add-on manifest reader" hidden sandbox="allow-scripts" referrerPolicy="no-referrer"
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sync-assets/configured-manifest-reader.html`} ref={frame} onLoad={() => setReaderReady(true)} />}
    {children}
  </Context.Provider>;
}

const cineManifest = 'https://v3-cinemeta.strem.io/manifest.json';
const cineIDs = new Set(['com.linvo.cinemeta', 'cinemeta', cineManifest]);
const aioAlias = new Set(['preset:aiometadata', 'YOUR_AIOMETADATA', 'MANIFEST_URL', '{{manifestUrl}}']);
const isAIO = (route: Route) => /aio.?metadata/i.test(route.addonID + ' ' + (route.provider ?? ''));

export function useCatalogIdentity() {
  const library = useContext(Context);
  return useMemo(() => {
    const available = new Map<string, InstalledRoute | null>();
    const aliases = new Map<string, InstalledRoute | null>();
    const record = (index: typeof available, key: string, route: InstalledRoute) => {
      if (!index.has(key)) index.set(key, route);
      else if (index.get(key)?.manifestURL !== route.manifestURL) index.set(key, null);
    };
    for (const route of library?.manifests.routes ?? []) {
      record(available, identity(route), route);
      record(available, identity({ ...route, addonID: route.manifestURL }), route);
      if (isAIO(route)) record(aliases, identity({ ...route, addonID: 'preset:aiometadata' }), route);
    }
    return (addonID: string, mediaType: string, rawCatalogID: string) => {
      const catalogID = rawCatalogID.startsWith(mediaType + '::') ? rawCatalogID.slice(mediaType.length + 2) : rawCatalogID;
      const key = identity({ addonID, mediaType, catalogID, title: '' });
      const candidate = aioAlias.has(addonID)
        ? aliases.get(identity({ addonID: 'preset:aiometadata', mediaType, catalogID, title: '' }))
        : available.get(key);
      const imported = library?.catalog.byKey.get(key);
      const cine = cineIDs.has(addonID) && ['movie', 'series'].includes(mediaType);
      const cineName = cine ? ({ top: 'Popular', imdbRating: 'Featured', year: 'New' } as Record<string, string>)[catalogID] : undefined;
      const fallback = cineName ? { addonID: 'com.linvo.cinemeta', mediaType, catalogID, title: cineName, provider: 'Cinemeta', manifestURL: cineManifest } : undefined;
      return {
        installed: candidate ?? (candidate === null ? undefined : fallback),
        title: candidate?.title || cineName || (imported?.provider ? imported.title : '') || '',
        provider: candidate?.provider || (cine ? 'Cinemeta' : aioAlias.has(addonID) ? 'AIOMetadata' : imported?.provider || ''),
        token: library?.token,
      };
    };
  }, [library]);
}

export function SyncCatalogPicker({ onSelect, label = 'Choose catalog' }: { onSelect: (catalog: Route) => void; label?: string }) {
  const library = useContext(Context);
  if (!library?.catalog.options.length) return library?.manifests.loading
    ? <span className="sync-meta" role="status">Loading catalogs…</span> : null;
  return <CatalogCombobox options={library.catalog.options} value="" onChange={key => {
    const route = library.catalog.byKey.get(key); if (route) onSelect(route);
  }} trigger={<Button type="button" size="sm" variant="outline">{label}</Button>} />;
}
export function LibraryCatalogPicker({ onSelect, label }: { onSelect: (catalog: InstalledRoute) => void; label: string }) {
  const library = useContext(Context);
  if (!library?.installed.options.length) return <span className="sync-meta" role="status">
    {library?.manifests.loading ? 'Loading catalogs…' : library?.manifests.failures ? 'Catalogs unavailable. Try again in Add-ons.' : 'No catalogs from installed public add-ons.'}
  </span>;
  return <CatalogCombobox options={library.installed.options} value="" onChange={key => {
    const route = library.installed.byKey.get(key); if (route) onSelect(route);
  }} trigger={<Button type="button" size="sm" variant="outline">{label}</Button>} />;
}
export function CatalogManifestImport({ showStatus = false }: { showStatus?: boolean }) {
  const library = useContext(Context);
  const [status, setStatus] = useState(''), [error, setError] = useState(false), [loading, setLoading] = useState(false);
  if (!library) return null;
  return <>{showStatus && library.auto && library.manifests.key !== '[]' && <div className="flex flex-wrap items-center gap-2 text-sm">
    <p role="status" className="text-muted-foreground">{library.manifests.loading ? 'Loading catalogs…'
      : library.manifests.failures ? `${library.manifests.failures} add-on(s) could not load. Import a catalog list or try again.`
        : `${library.manifests.routes.length} catalogs from installed add-ons`}</p>
    {!library.manifests.loading && !!library.manifests.failures && <Button variant="outline" onClick={library.retry}>Retry catalogs</Button>}
  </div>}<details className="sync-record"><summary className="sync-record-summary">Import catalog list</summary><div className="sync-record-body">
    <p className="text-sm text-muted-foreground">Import a manifest JSON file to choose its catalogs for this profile. Luma needs the add-on installed to load those catalogs.</p>
    <FilePicker label="Add-on manifest JSON" disabled={loading} onPick={file => {
      setLoading(true); setError(false); setStatus('');
      void library.importManifest(file).then(count => {
        setError(!count);
        setStatus(count ? `${count} ${count === 1 ? 'catalog' : 'catalogs'} imported.` : 'This manifest has no catalogs that can be shown on Home.');
      }).catch(() => {
        setError(true); setStatus('Choose an add-on manifest JSON file with a valid catalog list.');
      }).finally(() => setLoading(false));
    }} />
    {status && <p className="text-sm" role={error ? 'alert' : 'status'}>{status}</p>}
  </div></details></>;
}
