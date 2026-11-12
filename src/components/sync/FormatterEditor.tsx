'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilePicker } from './FilePicker';
import { PreferenceControl } from './PreferenceEditor';
import { deviceValue, formatterPresentationFields, type PreferenceSettings } from '@/lib/luma-sync/preferences';
import { publicPacks, readPublicPack } from '@/lib/luma-sync/public-pack';
import { ArtworkPreview } from '@/components/editor/ArtworkPreview';
import { FORMATTER_LIMIT, MAX_FORMATTER_FILE, formatterArtworkURL, formatterValue, importFormatterPack, isUMEArtwork, type FormatterPack, type FormatterTag } from '@/lib/luma-sync/formatter';

const presets = Object.entries(publicPacks.formatter);
const tagCount = (count: number) => `${count} ${count === 1 ? 'tag' : 'tags'}`;
const hexColor = (value: unknown) => typeof value === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(value) ? value : undefined;
function BadgeSwatch({ tag, url }: { tag: FormatterTag; url?: string }) {
  const [failed, setFailed] = useState(false);
  const style = String(tag.tagStyle || '').toLowerCase(), color = hexColor(tag.tagColor);
  const outline = style === 'outline' || style === 'outlined';
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="sync-tag-image" src={url} alt={tag.name} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className="sync-tag-pill rounded-md border border-border px-2 py-1 font-semibold"
    style={{ color: hexColor(tag.textColor) ?? (outline ? color : undefined), backgroundColor: outline ? 'transparent' : color,
      borderColor: hexColor(tag.borderColor) ?? color }}>{tag.name}</span>;
}
function TagSwatches({ tags, label = 'Tag appearance' }: { tags: FormatterTag[]; label?: string }) {
  const [loadImages, setLoadImages] = useState(false);
  const visible = tags.filter(tag => tag.isEnabled !== false).slice(0, 12)
    .map(tag => ({ tag, url: formatterArtworkURL(tag) }));
  if (!visible.length) return <p className="sync-setting-hint">No enabled tags.</p>;
  return <div aria-label={label} className="grid gap-2">
    <div className="flex flex-wrap items-center gap-2">{visible.map(({ tag, url }, index) =>
      <BadgeSwatch key={`${index}:${tag.name}:${url}`} tag={tag} url={url && (loadImages || isUMEArtwork(url)) ? url : undefined} />)}</div>
    {!loadImages && visible.some(({ url }) => url && !isUMEArtwork(url)) && <Button type="button" variant="ghost" size="sm"
      className="justify-self-start" onClick={() => setLoadImages(true)}>Load badge images</Button>}
  </div>;
}
function SourcePresentation({ values, unavailable, change, tags }: {
  values: PreferenceSettings; unavailable: string[]; change: (values: PreferenceSettings) => void; tags: FormatterTag[];
}) {
  const size = ({ COMPACT: 1, STANDARD: 1.1, LARGE: 1.25, EXTRA_LARGE: 1.45, HUGE: 1.6 })[String(deviceValue(values, 'playback.formatter.size', 'ios') ?? 'COMPACT') as 'COMPACT'] ?? 1;
  const placement = deviceValue(values, 'playback.formatter.placement', 'ios') ?? 'BOTTOM';
  const badges = <TagSwatches tags={tags.length ? tags : [{ name: '4K', pattern: '4K' }, { name: 'HDR', pattern: 'HDR' }]} label="Source badge preview" />;
  return <section className="mb-5" aria-labelledby="source-presentation-title">
    <h3 id="source-presentation-title" className="mb-2 text-sm font-semibold">Stream appearance</h3>
    <p className="sync-setting-note">Badge placement and size are set for each device type under Per device. The preview shows iPhone &amp; iPad.</p>
    <div className="sync-stream-layout">
      <div className="sync-settings-grid">{formatterPresentationFields.map(field =>
        <PreferenceControl key={field.id} field={field} value={values[field.id]} unavailable={unavailable.includes(field.id)}
          onChange={value => change({ ...values, [field.id]: value })} />)}</div>
      <div className="sync-tag-preview" aria-label="Source preview"
        style={{ '--sync-badge-height': `${23 * size}px`, '--sync-badge-font': `${.75 * size}rem` } as React.CSSProperties}>
        <p>Example stream</p>
        {placement === 'TOP' && badges}
        {values['playback.formatter.showTitles'] !== false && <strong>4K Blu-ray</strong>}
        {values['playback.formatter.showDetails'] !== false && <p>2160p · HEVC · English</p>}
        {placement !== 'TOP' && badges}
      </div>
    </div>
  </section>;
}
function packLabel(pack: FormatterPack, index: number) {
  const known = presets.find(([, url]) => url === pack.sourceUrl);
  if (known) return `UME ${known[0]}`;
  if (pack.sourceUrl.startsWith('file:')) return pack.sourceUrl.slice(5);
  try { return new URL(pack.sourceUrl).hostname || `Pack ${index + 1}`; }
  catch { return `Pack ${index + 1}`; }
}
export function FormatterEditor({ packs, onChange, preferences, unavailable, onPreferences }: {
  packs: FormatterPack[] | null; onChange: (packs: FormatterPack[]) => void; preferences: PreferenceSettings | null;
  unavailable: string[]; onPreferences: (values: PreferenceSettings) => void;
}) {
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const [candidate, setCandidate] = useState<FormatterPack>();
  const [tagQueries, setTagQueries] = useState<Record<string, string>>({});
  const [remove, setRemove] = useState<string>();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (!packs) return <section className="sync-panel"><h2>Formatter tags</h2><p className="sync-empty">This profile’s formatter packs can’t be edited here. Open them in Luma.</p></section>;
  const rows = packs;
  const active = rows.findIndex(pack => pack.isActive !== false);
  function install(pack: FormatterPack) {
    const matching = rows.findIndex(item => item.sourceUrl.toLowerCase() === pack.sourceUrl.toLowerCase());
    const next = rows.map((item, index) => index === matching ? pack : { ...item, isActive: false });
    if (matching < 0) next.push(pack);
    if (next.length > FORMATTER_LIMIT) { setError('Remove a pack before adding another. Luma supports up to three.'); return; }
    try { formatterValue(next); } catch { setError('These packs are too large to sync together.'); return; }
    onChange(next);
    setCandidate(undefined);
  }
  function movePack(index: number, offset: number) {
    const next = [...rows], to = index + offset;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }
  async function importFile(file: File) {
    pending.current?.abort();
    const control = new AbortController(); pending.current = control;
    setError(''); setCandidate(undefined); setLoading(true);
    try {
      if (file.size > MAX_FORMATTER_FILE) throw new Error();
      const text = await file.text();
      if (control.signal.aborted) return;
      setCandidate(importFormatterPack(text, file.name));
    } catch { if (!control.signal.aborted) setError('Use a formatter pack JSON file with tag names and patterns. Image links must be public HTTPS URLs.'); }
    finally { if (pending.current === control && !control.signal.aborted) { pending.current = null; setLoading(false); } }
  }
  async function loadPreset(name: string, url: string) {
    pending.current?.abort();
    const control = new AbortController(); pending.current = control;
    setError(''); setCandidate(undefined); setLoading(true);
    try {
      const text = await readPublicPack(url, MAX_FORMATTER_FILE, AbortSignal.any([control.signal, AbortSignal.timeout(12_000)]));
      if (!control.signal.aborted) setCandidate({ ...importFormatterPack(text, name, true), sourceUrl: url });
    } catch { if (!control.signal.aborted) setError('Could not load this UME pack. Try again or import a JSON file.'); }
    finally { if (pending.current === control && !control.signal.aborted) { pending.current = null; setLoading(false); } }
  }
  return <section className="sync-panel" aria-labelledby="sync-tags-title">
    <div className="sync-section-heading"><h2 id="sync-tags-title">Tags</h2></div>
    {preferences && <SourcePresentation values={preferences} unavailable={unavailable} change={onPreferences} tags={rows[active]?.filters ?? []} />}
    <h3 className="mb-3 text-sm font-semibold">Badge packs</h3>
    <div className="sync-tag-tools">
      <section className="sync-template" aria-label="UME tag presets">
        <h3 className="text-sm font-semibold">UME packs</h3>
        <div className="flex flex-wrap gap-2">{presets.map(([name, url]) => <Button key={url} variant="outline" type="button"
          disabled={loading || rows.some(pack => pack.sourceUrl === url)} onClick={() => void loadPreset(name, url)}>{name}</Button>)}</div>
      </section>
      <section className="sync-template" aria-label="Import pack">
        <h3>Import pack</h3>
        <FilePicker label="Import formatter pack" disabled={loading} onPick={file => void importFile(file)} />
      </section>
    </div>
    {loading && <p className="sync-setting-note" role="status">Loading pack…</p>}
    {error && <p className="sync-banner sync-error" role="alert">{error}</p>}
    {candidate && <div className="sync-record-body rounded-xl border border-border p-4">
      <p role="status" className="text-sm">{packLabel(candidate, rows.length)} · {tagCount(candidate.filters.length)}</p>
      <TagSwatches tags={candidate.filters} label="Pack preview" />
      <div className="flex flex-wrap gap-2"><Button onClick={() => install(candidate)}>Add pack</Button>
        <Button variant="outline" onClick={() => setCandidate(undefined)}>Cancel</Button></div>
    </div>}
    {!rows.length && <p className="sync-empty">No packs installed.</p>}
    {rows.map((pack, i) => {
      const query = tagQueries[pack.sourceUrl] ?? '';
      const visible = pack.filters.map((tag, index) => ({ tag, index })).filter(({ tag }) => tag.name.toLowerCase().includes(query.trim().toLowerCase()));
      return <details className="sync-record" key={pack.sourceUrl}>
      <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" /><span className="min-w-0 flex-1 break-words">{packLabel(pack, i)}</span><span className="sync-meta">{i === active ? 'Active · ' : ''}{tagCount(pack.filters.length)}</span></summary>
      <div className="sync-record-body">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onChange(rows.map((row, index) => ({ ...row, isActive: i !== active && index === i })))}>{i === active ? 'Turn off pack' : 'Use this pack'}</Button>
          {rows.length > 1 && <>
            <Button variant="outline" size="icon" aria-label={`Move ${packLabel(pack, i)} up`} disabled={!i} onClick={() => movePack(i, -1)}><ArrowUp /></Button>
            <Button variant="outline" size="icon" aria-label={`Move ${packLabel(pack, i)} down`} disabled={i === rows.length - 1} onClick={() => movePack(i, 1)}><ArrowDown /></Button>
          </>}
          {remove === pack.sourceUrl ? <><Button variant="destructive" onClick={() => { onChange(rows.filter(row => row.sourceUrl !== pack.sourceUrl)); setRemove(undefined); }}>Remove pack</Button><Button variant="outline" onClick={() => setRemove(undefined)}>Cancel</Button></>
            : <Button variant="outline" className="sync-danger-outline" onClick={() => setRemove(pack.sourceUrl)}>Remove…</Button>}
        </div>
        <TagSwatches tags={pack.filters} />
        {pack.filters.length > 12 && <Input type="search" aria-label="Search tags" placeholder="Search tags" value={query} onChange={event => {
          setTagQueries({ ...tagQueries, [pack.sourceUrl]: event.target.value });
          setExpanded({ ...expanded, [pack.sourceUrl]: 12 });
        }} />}
        {!visible.length && <p className="sync-setting-hint">No matching tags.</p>}
        {visible.slice(0, expanded[pack.sourceUrl] ?? 12).map(({ tag, index }) => <div className="sync-tag-row" key={index}>
          <div className="sync-tag-row-line">
            <span className="min-w-0 break-words font-medium">{tag.name}</span>
            <label className="sync-tag-switch"><input type="checkbox" aria-label={`Show ${tag.name}`} checked={tag.isEnabled !== false} onChange={event => {
              const checked = event.target.checked;
              onChange(rows.map((row, p) => p === i ? { ...row, filters: row.filters.map((filter, t) => t === index ? { ...filter, isEnabled: checked } : filter) } : row));
            }} /><span aria-hidden="true">{tag.isEnabled === false ? 'Off' : 'On'}</span></label>
          </div>
          <details className="sync-tag-detail"><summary>Pattern and image</summary>
            <p className="break-all text-xs text-muted-foreground"><code>{tag.pattern}</code></p>
            {Boolean(tag.imageURL || tag.imageUrl) && <ArtworkPreview src={tag.imageURL ?? tag.imageUrl} onDemand fit="contain" className="h-20 max-w-48 rounded-md" />}
          </details>
        </div>)}
        {(expanded[pack.sourceUrl] ?? 12) < visible.length && <Button variant="outline" onClick={() => setExpanded({ ...expanded, [pack.sourceUrl]: (expanded[pack.sourceUrl] ?? 12) + 24 })}>Show more tags</Button>}
      </div>
    </details>})}
  </section>;
}
