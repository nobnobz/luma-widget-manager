'use client';

import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { syncRequest } from '@/lib/luma-sync/passkey';
import { isJellyfinCatalogReference } from '@/lib/luma-sync/jellyfin';
import { useCatalogIdentity } from './SyncCatalogs';
import type { HomeNode } from '@/lib/luma-sync/home-tree';

const posterHosts = new Set(['image.tmdb.org', 'images.metahub.space', 'images-na.ssl-images-amazon.com', 'm.media-amazon.com']);
const coverHosts = new Set([...posterHosts, 'i.postimg.cc', 'raw.githubusercontent.com']);
export function trustedArt(value: unknown, hosts = coverHosts) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.has(url.hostname) && !url.username && !url.password &&
      !url.port && !url.search && !url.hash ? url.href : '';
  } catch { return ''; }
}

export function nodeCatalog(node: HomeNode) {
  const source = node.source, row = node.row;
  return { addon: source?.addonId ?? row?.source.addonID ?? '', type: source?.type ?? row?.source.mediaType ?? '',
    id: source?.catalogId ?? row?.source.catalogID ?? '' };
}
export function catalogDisplay(node: HomeNode, resolve: ReturnType<typeof useCatalogIdentity>) {
  const { addon, type, id } = nodeCatalog(node);
  const identity = resolve(addon, type, id);
  const jellyfin = node.source?.provider === 'jellyfin' || isJellyfinCatalogReference(addon);
  const provider = jellyfin ? 'Jellyfin' : identity.provider || ({
    tmdb: 'TMDB', trakt: 'Trakt', jellyfin: 'Jellyfin', addon: 'Add-on',
  } as Record<string, string>)[node.source?.provider ?? 'addon'] || 'Catalog';
  const media = ({ movie: 'Movies', series: 'Series', anime: 'Anime' } as Record<string, string>)[type] ?? type;
  const genre = node.source?.genre ?? node.row?.widget?.genre;
  const legacyTitle = node.title.trim() === id || node.title.trim() === type + '::' + id ? '' : node.title.trim();
  const title = legacyTitle || identity.title || (id ? 'Catalog · ' + (id.split('::').at(-1) ?? id) : provider + ' catalog');
  return { ...identity, jellyfin, title, detail: [identity.title !== title && identity.title, provider, media, typeof genre === 'string' && genre].filter(Boolean).join(' · '), genre };
}

type Item = { title: string; poster?: string };
type Result = { status: string; items?: Item[] };
const cache = new Map<string, { expires: number; result: Result }>();
const filled = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== 'all' && value !== 'standard' &&
  (typeof value !== 'object' || Object.values(value).some(filled));
export function HomeCatalogPreview({ node }: { node: HomeNode }) {
  const resolve = useCatalogIdentity();
  const { installed, token, title, genre, jellyfin } = catalogDisplay(node, resolve);
  const widget = node.row?.widget, source = node.source;
  const needsDevice = filled(widget?.query) || filled(widget?.filters) || filled(widget?.extras) ||
    filled(widget?.mediaType) && widget?.mediaType !== nodeCatalog(node).type ||
    filled(source?.query) || filled(source?.extras) || filled(source?.contentFilters) || filled(source?.sortBy) ||
    filled(source?.releaseFilter) || filled(source?.excludedGenreIDs) ||
    !!source && (source.provider !== 'addon' || filled(source.mediaType) && source.mediaType !== source.type);
  const payload = installed && token && !needsDevice && !jellyfin ? JSON.stringify({ url: installed.manifestURL, addonID: installed.addonID,
    type: installed.mediaType, id: installed.catalogID, ...(typeof genre === 'string' && genre ? { genre } : {}) }) : '';
  const [response, setResponse] = useState<{ payload: string; token: string; attempt: number; value: Result }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!payload || !token) return;
    const controller = new AbortController();
    const prior = cache.get(payload);
    const load = prior && prior.expires > Date.now() && attempt === 0
      ? Promise.resolve(prior.result) : syncRequest('/v1/editor/catalog-preview', { method: 'POST', body: JSON.parse(payload),
        token, signal: controller.signal, max: 8192 }).then(value => {
          const status = typeof value.status === 'string' ? value.status : 'unavailable';
          const items = Array.isArray(value.items) ? value.items.slice(0, 6).flatMap(item =>
            typeof item?.title === 'string' ? [{ title: item.title.slice(0, 160), poster: trustedArt(item.poster, posterHosts) }] : []) : [];
          const result = { status, items };
          if (status === 'ok') {
            cache.set(payload, { expires: Date.now() + 300_000, result });
            if (cache.size > 64) cache.delete(cache.keys().next().value!);
          }
          return result;
        }).catch(() => ({ status: 'unavailable' }));
    void load.then(value => { if (!controller.signal.aborted) setResponse({ payload, token, attempt, value }); });
    return () => controller.abort();
  }, [payload, token, attempt]);
  const value = response?.payload === payload && response.token === token && response.attempt === attempt ? response.value : undefined;
  if (jellyfin) return <p className="sync-empty">Open this catalog in Luma with the matching Jellyfin connection.</p>;
  if (!payload) return <p className="sync-empty">{needsDevice ? 'This catalog’s settings are applied on your Luma device.' :
    'Catalog preview is only available for supported public add-ons.'}</p>;
  if (!value) return <p role="status" className="sync-empty">Loading catalog preview…</p>;
  if (value.status === 'unsupported') return <p className="sync-empty">This catalog’s settings are applied on your Luma device.</p>;
  if (value.status !== 'ok') return <div className="grid justify-items-start gap-2"><p className="sync-meta">Catalog preview unavailable.</p><Button type="button" size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></div>;
  if (!value.items?.length) return <p className="sync-empty">This catalog returned no titles.</p>;
  return <ul className="home-poster-grid" aria-label={`Titles from ${title}`}>
    {value.items.map((item, i) => <li key={i}><Poster item={item} /><span>{item.title}</span></li>)}
  </ul>;
}

function Poster({ item }: { item: Item }) {
  const [failed, setFailed] = useState('');
  return <div className="home-poster">
    {item.poster && failed !== item.poster
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={item.poster} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(item.poster ?? '')} />
      : <Film aria-hidden />}
  </div>;
}
