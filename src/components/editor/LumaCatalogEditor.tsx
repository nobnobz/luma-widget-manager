'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newID, type Folder, type CatalogSource, type CatalogGroup } from '@/lib/luma-document';

const orders = ['standard', 'releaseDateNewest', 'releaseDateOldest', 'popular', 'leastPopular', 'topRated', 'lowestRated', 'mostVotes', 'fewestVotes', 'title', 'titleDescending', 'random'];
const releases = ['all', 'released', 'digital_released', 'upcoming'];
const fieldClass = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-xs';
function TextField({ label, value, change, type = 'text', min, max }: { label: string; value: unknown; change: (v: string) => void; type?: string; min?: number; max?: number }) {
  return <label className="block space-y-1 text-xs text-muted-foreground"><span>{label}</span><Input aria-label={label} type={type} min={min} max={max} value={String(value ?? '')} onChange={e => change(e.target.value)} /></label>;
}
export function IDField({ label, value, change }: { label: string; value: unknown; change: (v: string) => void }) {
  const [error, setError] = useState('');
  const text = Array.isArray(value) ? value.join(', ') : '';
  return <label className="block space-y-1 text-xs text-muted-foreground"><span>{label}</span><Input key={text} aria-label={label} defaultValue={text} onBlur={e => { if (e.target.value.split(/[,\s]+/).filter(Boolean).some(v => !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) <= 0)) { setError('Use positive whole genre IDs separated by commas.'); return; } setError(''); change(e.target.value); }} />{error && <span role="alert" className="block text-destructive">{error}</span>}</label>;
}
function Select({ label, value, options, change }: { label: string; value: unknown; options: string[]; change: (v: string) => void }) {
  const current = String(value ?? '');
  return <label className="block space-y-1 text-xs text-muted-foreground"><span>{label}</span><select aria-label={label} className={fieldClass} value={current} onChange={e => change(e.target.value)}>{[...new Set([current, ...options])].map(v => <option key={v} value={v}>{v || 'Automatic'}</option>)}</select></label>;
}
function JSONFields({ value, onSave }: { value: CatalogSource; onSave: (source: CatalogSource) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  return <details onToggle={e => { if (e.currentTarget.open) setText(JSON.stringify(value, null, 2)); }}><summary className="cursor-pointer text-xs">Advanced provider JSON</summary><textarea aria-label="Provider JSON" className="mt-2 min-h-40 w-full rounded-xl border border-border bg-background p-3 font-mono text-xs" value={text} onChange={e => setText(e.target.value)} /><Button variant="outline" size="sm" onClick={() => { try { const next = JSON.parse(text); if (!next || Array.isArray(next) || typeof next !== 'object' || typeof next.provider !== 'string') throw new Error('Enter a source object with a provider.'); onSave({ ...next, id: value.id }); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid JSON'); } }}>Apply provider JSON</Button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</details>;
}
export function LumaCatalogEditor({ folder, onChange }: { folder: Folder; onChange: (folder: Folder) => void }) {
  const sources = folder.sources ?? [];
  const groups = folder.catalogGroups ?? [];
  function sourceChange(index: number, changes: Partial<CatalogSource>) { onChange({ ...folder, sources: sources.map((s, i) => i === index ? { ...s, ...changes } : s) }); }
  function moveGroup(index: number, offset: number) {
    const next = [...groups]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange({ ...folder, catalogGroups: next });
  }
  function moveMember(groupIndex: number, index: number, offset: number) {
    const next = [...groups[groupIndex].catalogIDs]; [next[index], next[index + offset]] = [next[index + offset], next[index]];
    groupChange(groupIndex, { catalogIDs: next });
  }
  function groupChange(index: number, changes: Partial<CatalogGroup>) { onChange({ ...folder, catalogGroups: groups.map((g, i) => i === index ? { ...g, ...changes } : g) }); }
  function add(provider: string) {
    const source: CatalogSource = { id: newID(), provider, title: 'New catalog', ...(provider === 'tmdb' ? { tmdbSourceType: 'DISCOVER', mediaType: 'movie' } : provider === 'trakt' ? { traktListId: '', type: 'movie' } : { addonId: provider === 'addon' ? 'preset:aiometadata' : '', type: 'movie', catalogId: '' }) };
    onChange({ ...folder, sources: [...sources, source] });
  }
  return <section className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-4 sm:p-5"><h3 className="text-sm font-bold">Catalogs &amp; sections</h3><p className="text-xs text-muted-foreground">Build catalog copies with independent filters. Sections group related catalogs under a heading and add jump links in Luma.</p>
    <div className="flex flex-wrap gap-2">{['addon', 'tmdb', 'trakt', 'jellyfin'].map(provider => <Button key={provider} variant="outline" size="sm" onClick={() => add(provider)}>Add {provider === 'addon' ? 'add-on' : provider === 'tmdb' ? 'TMDB' : provider === 'trakt' ? 'Trakt' : 'Jellyfin'} catalog</Button>)}</div>
    {sources.map((source, i) => {
      const filters = (source.contentFilters ?? {}) as Record<string, unknown>;
      const filter = (key: string, value: unknown) => sourceChange(i, { contentFilters: { ...filters, [key]: value } });
      const ids = (v: string) => [...new Set(v.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
      return <details key={source.id ?? i} className="space-y-3 rounded-xl border border-border/60 bg-background/60 p-4"><summary className="cursor-pointer text-xs font-bold">{i + 1}. {String(source.title || source.catalogId || source.provider)} · {source.provider}</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TextField label="Catalog title" value={source.title} change={title => sourceChange(i, { title })} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={source.homeEnabled !== false} onChange={e => sourceChange(i, { homeEnabled: e.target.checked })} />Catalog enabled</label>
        {['addon', 'jellyfin'].includes(source.provider) && <><TextField label="Add-on or server ID" value={source.addonId} change={addonId => sourceChange(i, { addonId })} /><TextField label="Catalog route type" value={source.type} change={type => sourceChange(i, { type })} /><TextField label="Catalog route ID" value={source.catalogId} change={catalogId => sourceChange(i, { catalogId })} /></>}
        {source.provider === 'tmdb' && <><Select label="TMDB source type" value={source.tmdbSourceType ?? 'DISCOVER'} options={['DISCOVER', 'LIST', 'COLLECTION', 'PERSON', 'DIRECTOR', 'COMPANY', 'NETWORK']} change={tmdbSourceType => sourceChange(i, { tmdbSourceType })} /><TextField label="TMDB ID" type="number" min={1} value={source.tmdbId} change={tmdbId => sourceChange(i, { tmdbId })} /></>}
        {source.provider === 'trakt' && <><TextField label="Trakt list ID" type="number" min={1} value={source.traktListId} change={traktListId => sourceChange(i, { traktListId })} /><Select label="Trakt media type" value={source.type ?? 'movie'} options={['movie', 'series']} change={type => sourceChange(i, { type })} /><Select label="Trakt sort direction" value={source.sortHow ?? ''} options={['', 'asc', 'desc']} change={sortHow => sourceChange(i, { sortHow })} /></>}
        <Select label="Catalog media filter" value={source.mediaType ?? ''} options={['', 'movie', 'series']} change={mediaType => sourceChange(i, { mediaType })} />
        <TextField label="Provider genre" value={source.genre} change={genre => sourceChange(i, { genre })} />
        <TextField label="Provider sort" value={source.sortBy} change={sortBy => sourceChange(i, { sortBy })} />
        <Select label="Release filter" value={source.releaseFilter ?? 'all'} options={releases} change={releaseFilter => sourceChange(i, { releaseFilter })} />
        <Select label="Ranking numbers" value={(source.lumaPresentation as Record<string, unknown> | undefined)?.showRanking === undefined ? '' : String((source.lumaPresentation as Record<string, unknown>).showRanking)} options={['', 'true', 'false']} change={v => sourceChange(i, { lumaPresentation: { ...(source.lumaPresentation as object ?? {}), showRanking: v === '' ? undefined : v === 'true' } })} />
        <IDField label="Provider excluded genre IDs" value={source.excludedGenreIDs} change={v => sourceChange(i, { excludedGenreIDs: ids(v) })} />
        <IDField label="Included genre IDs" value={filters.includedGenreIDs} change={v => filter('includedGenreIDs', ids(v))} />
        <IDField label="Excluded genre IDs" value={filters.excludedGenreIDs} change={v => filter('excludedGenreIDs', ids(v))} />
        <TextField label="Year" type="number" min={1800} max={3000} value={filters.year} change={v => filter('year', v ? Number(v) : undefined)} />
        <Select label="Minimum rating" value={filters.minimumRating ?? ''} options={['', ...Array.from({ length: 11 }, (_, i) => String(i))]} change={v => filter('minimumRating', v ? Number(v) : undefined)} />
        <Select label="Local catalog order" value={filters.order ?? 'standard'} options={orders} change={v => filter('order', v)} />
        <Select label="Local release filter" value={filters.release ?? 'all'} options={releases} change={v => filter('release', v)} />
      </div>{source.provider === 'tmdb' && <details><summary className="cursor-pointer text-xs">TMDB Discover filters</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{['withGenres','withoutGenres','withCompanies','withNetworks','withOriginalLanguage','withOriginCountry','withKeywords','withWatchProviders','watchRegion','year','voteCountGte','voteAverageGte','voteAverageLte','releaseDateGte','releaseDateLte'].map(key => <TextField key={key} label={`Discover ${key}`} value={(source.filters as Record<string, unknown> | undefined)?.[key]} change={v => sourceChange(i, { filters: { ...(source.filters as object ?? {}), [key]: v || undefined } })} />)}</div></details>}<p className="text-[11px] text-muted-foreground">Genre IDs use TMDB numbers (e.g. 28 Action, 35 Comedy, 18 Drama). Provider parameters and TMDB Discover filters can also be edited below. Add-ons and Jellyfin servers must be installed in Luma.</p><JSONFields value={source} onSave={next => sourceChange(i, next)} />
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => onChange({ ...folder, sources: [...sources.slice(0, i + 1), { ...structuredClone(source), id: newID(), title: `${source.title || 'Catalog'} (copy)` }, ...sources.slice(i + 1)] })}>Duplicate catalog</Button><Button variant="outline" size="sm" onClick={() => onChange({ ...folder, sources: sources.filter((_, index) => index !== i), catalogGroups: groups.map(g => ({ ...g, catalogIDs: g.catalogIDs.filter(id => id !== source.id) })), blockOrder: folder.blockOrder?.filter(key => key !== `catalog:${source.id}`) })}>Remove catalog</Button></div></details>;
    })}
    <div className="space-y-3 border-t border-border/50 pt-4"><h4 className="text-sm font-bold">Catalog sections</h4>{groups.map((group, i) => <div key={group.id} className="space-y-3 rounded-xl border border-border/60 p-4"><TextField label="Catalog section title" value={group.title} change={title => groupChange(i, { title })} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={group.isEnabled !== false} onChange={e => groupChange(i, { isEnabled: e.target.checked })} />Section enabled</label>{sources.map(s => <label key={s.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={group.catalogIDs.includes(s.id!)} onChange={e => onChange({ ...folder, catalogGroups: groups.map(g => ({ ...g, catalogIDs: e.target.checked ? [...g.catalogIDs.filter(id => id !== s.id), ...(g.id === group.id ? [s.id!] : [])] : g.id === group.id ? g.catalogIDs.filter(id => id !== s.id) : g.catalogIDs })) })} />{String(s.title || s.catalogId || s.provider)}</label>)}{group.catalogIDs.filter(id => !sources.some(s => s.id === id)).length > 0 && <p className="text-xs text-amber-600">Unavailable catalog references are preserved in this section.</p>}<div className="space-y-2">{group.catalogIDs.map((id, memberIndex) => <div key={id} className="flex flex-wrap items-center gap-2 text-xs"><span className="min-w-0 flex-1 break-words">{String(sources.find(s => s.id === id)?.title || sources.find(s => s.id === id)?.catalogId || id)}</span><Button variant="outline" size="sm" aria-label={`Move section catalog ${memberIndex + 1} up`} disabled={memberIndex === 0} onClick={() => moveMember(i, memberIndex, -1)}>↑</Button><Button variant="outline" size="sm" aria-label={`Move section catalog ${memberIndex + 1} down`} disabled={memberIndex === group.catalogIDs.length - 1} onClick={() => moveMember(i, memberIndex, 1)}>↓</Button></div>)}</div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={i === 0} onClick={() => moveGroup(i, -1)}>Move section up</Button><Button variant="outline" size="sm" disabled={i === groups.length - 1} onClick={() => moveGroup(i, 1)}>Move section down</Button></div><Button variant="outline" size="sm" onClick={() => onChange({ ...folder, catalogGroups: groups.filter((_, index) => index !== i) })}>Remove section</Button></div>)}<Button variant="outline" size="sm" onClick={() => onChange({ ...folder, catalogGroups: [...groups, { id: newID(), title: 'New section', catalogIDs: [] }] })}>Add catalog section</Button></div>
  </section>;
}
