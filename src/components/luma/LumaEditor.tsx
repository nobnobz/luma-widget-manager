'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useConfig } from '@/context/ConfigContext';
import { atPath, editDocument, exportDocument, importDocument, MAX_DEPTH, moveFolder, newFolder, newHub, newID, parseDocument, starterDocument, type CatalogSource, type Folder, type Hub, type LumaDocument, type Path, type Section } from '@/lib/luma-document';
import './luma-editor.css';

const STORAGE = 'luma-widget-manager.document.v1';
const button = (label: string, action: () => void, disabled = false) => <button type="button" onClick={action} disabled={disabled}>{label}</button>;
function Field({ label, value, onChange, multiline = false }: { label: string; value: unknown; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="luma-field"><span>{label}</span>{multiline ? <textarea value={String(value ?? '')} onChange={e => onChange(e.target.value)} /> : <input value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}</label>;
}
function Select({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (v: string) => void }) {
  return <label className="luma-field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)}>{values.map(v => <option key={v}>{v}</option>)}</select></label>;
}
export function LumaEditor() {
  const fusion = useConfig();
  const [doc, setDoc] = useState<LumaDocument>({ collections: [] });
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [history, setHistory] = useState<LumaDocument[]>([]);
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState('');
  const [cut, setCut] = useState<Path | null>(null);
  const [manifestURL, setManifestURL] = useState('');
  const [addonID, setAddonID] = useState('');
  const [catalogs, setCatalogs] = useState<{ id: string; name?: string; type: string }[]>([]);
  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE); if (saved) setDoc(parseDocument(saved).document); }
    catch (e) { setRecovery(true); setMessage(`Saved document could not be loaded. Download the recovery copy before replacing it. ${String(e)}`); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || recovery) return;
    try { localStorage.setItem(STORAGE, JSON.stringify(doc)); }
    catch { setMessage('Browser storage is full or unavailable. Download your document to keep changes.'); }
  }, [doc, ready, recovery]);
  function commit(next: LumaDocument) {
    setHistory(h => [...h.slice(-29), doc]); setDoc(next); setCut(null);
  }
  function change(path: Path, value: unknown) {
    commit(editDocument(doc, draft => { const parent = atPath(draft, path.slice(0, -1)) as Record<string | number, unknown>; parent[path.at(-1)!] = value; }));
  }
  function insert(path: Path, item: unknown) { change(path, [...(atPath(doc, path) as unknown[] ?? []), item]); }
  function remove(path: Path) { change(path.slice(0, -1), (atPath(doc, path.slice(0, -1)) as unknown[]).filter((_, i) => i !== path.at(-1))); }
  function reorder(path: Path, offset: number) {
    const listPath = path.slice(0, -1), index = path.at(-1) as number;
    const list = [...atPath(doc, listPath) as unknown[]];
    if (index + offset < 0 || index + offset >= list.length) return;
    [list[index], list[index + offset]] = [list[index + offset], list[index]]; change(listPath, list);
  }
  function controls(path: Path, kind: string): ReactNode {
    const index = path.at(-1) as number, length = (atPath(doc, path.slice(0, -1)) as unknown[]).length;
    return <div className="luma-actions">{button(`Move ${kind} up`, () => reorder(path, -1), index === 0)}{button(`Move ${kind} down`, () => reorder(path, 1), index === length - 1)}{kind === 'folder' && button('Cut folder', () => setCut(path))}{button(`Delete ${kind}`, () => remove(path))}</div>;
  }
  function pasteInto(path: Path, depth: number) {
    if (!cut) return;
    try { commit(moveFolder(doc, cut, path, depth)); setMessage('Folder moved.'); } catch (e) { setMessage(String(e)); }
  }
  function folders(items: Folder[], path: Path, depth: number): ReactNode {
    return <div className="luma-folder-list">{items.map((folder, i) => folderCard(folder, [...path, i], depth))}
      <div className="luma-actions">{button('Add folder', () => insert(path, newFolder()), depth > MAX_DEPTH)}{cut && button('Paste folder here', () => pasteInto(path, depth), depth > MAX_DEPTH)}</div></div>;
  }
  function toggle(row: Folder | Hub | Section | CatalogSource, path: Path, key: string, label: string, defaultValue = false) {
    return <label className="luma-check"><input type="checkbox" checked={(row[key] as boolean | undefined) ?? defaultValue} onChange={e => change([...path, key], e.target.checked)} />{label}</label>;
  }
  function sourceCard(source: CatalogSource, path: Path, index: number): ReactNode {
    return <div className="luma-source" key={index}>
      <strong>Catalog {index + 1} · {source.provider}</strong>{controls(path, 'catalog')}
      {source.provider === 'addon' ? <div className="luma-fields">
        {['title', 'addonId', 'type', 'catalogId', 'genre', 'sortBy', 'releaseFilter'].map(key => <Field key={key} label={key} value={source[key]} onChange={v => change([...path, key], v)} />)}
      </div> : <p>Provider settings are preserved. Use the JSON view to edit provider-specific fields.</p>}
      {toggle(source, path, 'homeEnabled', 'Enabled', true)}
    </div>;
  }
  function folderCard(folder: Folder, path: Path, depth: number): ReactNode {
    const sourcePath = [...path, 'sources'];
    const blocks = [...(folder.sources ?? []).map((s, i) => ({ key: `catalog:${s.id ?? i}`, kind: 'catalog', i })), ...(folder.sections ?? []).map((s, i) => ({ key: `section:${s.id}`, kind: 'section', i }))];
    const order = [...new Set([...(folder.blockOrder ?? []).filter(k => blocks.some(b => b.key === k)), ...blocks.map(b => b.key)])];
    return <details className="luma-folder" key={String(path)} open={depth === 1 ? true : undefined}>
      <summary><span>▸ {folder.title || 'Untitled folder'}</span><small>Level {depth} · {(folder.sources ?? []).length} catalogs · {(folder.sections ?? []).length} sections</small></summary>
      <div className="luma-folder-body">{controls(path, 'folder')}
        <div className="luma-fields"><Field label="Folder title" value={folder.title} onChange={v => change([...path, 'title'], v)} />
          <Select label="Tile shape" value={folder.tileShape ?? 'LANDSCAPE'} values={['LANDSCAPE', 'POSTER', 'SQUARE']} onChange={v => change([...path, 'tileShape'], v)} />
          <Select label="Folder view" value={String(folder.viewMode ?? 'ROWS')} values={['ROWS', 'TABBED_GRID', 'FOLLOW_LAYOUT']} onChange={v => change([...path, 'viewMode'], v)} />
          {['coverImageUrl', 'focusVideoUrl', 'heroBackdropUrl', 'titleLogoUrl'].map(key => <Field key={key} label={key} value={folder[key]} onChange={v => change([...path, key], v)} />)}
        </div>
        <div className="luma-actions">{toggle(folder, path, 'homeEnabled', 'Enabled', true)}{toggle(folder, path, 'hideTitle', 'Hide title')}{toggle(folder, path, 'focusGifEnabled', 'Animate cover on focus', true)}</div>
        <h4>Page blocks</h4><p className="luma-muted">Catalogs and sections appear in this order. The subfolder grid follows them.</p>
        {order.map((key, index) => {
          const block = blocks.find(b => b.key === key)!;
          const itemPath = [...path, block.kind === 'catalog' ? 'sources' : 'sections', block.i];
          return <div className="luma-block" key={key}><div className="luma-actions"><span>{index + 1}. {block.kind}</span>{button('Block up', () => { const next = [...order]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change([...path, 'blockOrder'], next); }, index === 0)}{button('Block down', () => { const next = [...order]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; change([...path, 'blockOrder'], next); }, index === order.length - 1)}</div>
            {block.kind === 'catalog' ? sourceCard(folder.sources![block.i], itemPath, block.i) : sectionCard(folder.sections![block.i], itemPath, depth + 1)}</div>;
        })}
        <div className="luma-actions">{button('Add catalog', () => insert(sourcePath, { id: newID(), provider: 'addon', addonId: addonID || 'preset:aiometadata', type: 'movie', catalogId: '', title: 'New catalog' }))}
          {button('Add section', () => insert([...path, 'sections'], { id: newID(), title: 'New section', folders: [], tileShape: 'LANDSCAPE' }), depth >= MAX_DEPTH)}</div>
        {!!catalogs.length && <Select label="Add catalog from manifest" value="Choose catalog…" values={['Choose catalog…', ...catalogs.map((c, i) => `${i + 1}. ${c.name ?? c.id} (${c.type})`)]} onChange={v => { const c = catalogs[Number.parseInt(v) - 1]; if (c) insert(sourcePath, { id: newID(), provider: 'addon', addonId: addonID, type: c.type, catalogId: c.id, title: c.name ?? c.id }); }} />}
        <h4>Subfolder grid</h4>
        <Select label="Subfolder tile shape" value={String(folder.subfolderTileShape ?? 'POSTER')} values={['POSTER', 'LANDSCAPE', 'SQUARE']} onChange={v => change([...path, 'subfolderTileShape'], v)} />
        {depth < MAX_DEPTH ? folders(folder.subfolders ?? [], [...path, 'subfolders'], depth + 1) : <p className="luma-muted">Maximum folder depth reached.</p>}
      </div></details>;
  }
  function sectionCard(section: Section, path: Path, depth: number): ReactNode {
    return <div className="luma-section">{controls(path, 'section')}<div className="luma-fields"><Field label="Section title" value={section.title} onChange={v => change([...path, 'title'], v)} /><Select label="Section tile shape" value={section.tileShape ?? 'LANDSCAPE'} values={['LANDSCAPE', 'POSTER', 'SQUARE']} onChange={v => change([...path, 'tileShape'], v)} /><Field label="Dynamic collection ID (optional)" value={section.dynamicSource} onChange={v => change([...path, 'dynamicSource'], v)} /></div>{toggle(section, path, 'homeEnabled', 'Enabled', true)}{toggle(section, path, 'hideTitle', 'Hide section title')}{folders(section.folders, [...path, 'folders'], depth)}</div>;
  }
  function load(value: unknown) {
    try { const imported = importDocument(value); commit(imported.document); setRecovery(false); setMessage(imported.notes.join('\n') || 'Luma collections imported.'); } catch (e) { setMessage(String(e)); }
  }
  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function manifest() {
    try {
      const url = new URL(manifestURL); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP(S) manifest URL without embedded credentials.');
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!response.ok) throw new Error(`Manifest: HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.id !== 'string' || !Array.isArray(data.catalogs)) throw new Error('Invalid manifest.');
      setAddonID(data.id); setCatalogs(data.catalogs.filter((c: { id: unknown; type: unknown }) => typeof c.id === 'string' && typeof c.type === 'string'));
      setMessage('Manifest loaded. Add its catalogs inside a folder. Only the manifest ID is written into exports.');
    } catch (e) { setMessage(`Could not load manifest (the server must allow browser access): ${String(e)}`); }
  }
  if (!ready) return <main className="luma-app">Loading editor…</main>;
  return <main className="luma-app">
    <header className="luma-header"><div><span className="luma-eyebrow">UME v4.0 · COLLECTION BUILDER</span><h1>Luma Widget Manager</h1><p>Build hubs. Arrange sections. Go deeper.</p></div><Link href="/fusion">Fusion tools ↗</Link></header>
    <div className="luma-toolbar">{button('Add hub', () => insert(['collections'], newHub()))}{button('Load UME starter', () => { commit(starterDocument()); setRecovery(false); setMessage('Starter loaded. Add your catalogs and covers before exporting.'); })}{button('Undo', () => { const previous = history.at(-1); if (previous) { setDoc(previous); setHistory(history.slice(0, -1)); setCut(null); } }, !history.length)}{button('Download Luma JSON', () => { try { download(exportDocument(doc), 'ume-v4-luma-collections.json'); setMessage('Export validated. Import this file through Luma Collections.'); } catch (e) { setMessage(String(e)); } }, !doc.collections.length)}{button('Copy Luma JSON', () => { try { const text = exportDocument(doc); navigator.clipboard.writeText(text).then(() => setMessage('Luma JSON copied.'), () => setMessage('Clipboard unavailable. Use Download Luma JSON.')); } catch (e) { setMessage(String(e)); } }, !doc.collections.length)}</div>
    {message && <div role="status" className="luma-message">{message}</div>}
    {recovery && button('Download saved recovery JSON', () => download(localStorage.getItem(STORAGE) ?? '', 'luma-recovery.json'))}
    <div className="luma-layout"><aside>
      <section className="luma-panel"><h2>Your structure</h2><p className="luma-muted">Home collection → hub folder → sections and subfolders. Up to three folder levels.</p>{doc.collections.map((hub, i) => <a className="luma-outline" key={i} href={`#hub-${i}`}>{hub.title} <small>{hub.folders.length} folders</small></a>)}{!doc.collections.length && <p>No hubs yet. Start with a blank hub or the UME starter.</p>}</section>
      <section className="luma-panel"><h2>Import</h2><label className="luma-field"><span>Luma or Fusion JSON file</span><input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 4 * 1024 * 1024) throw new Error('The file exceeds 4 MB.'); load(JSON.parse(await file.text())); } catch (err) { setMessage(String(err)); } e.target.value = ''; }} /></label><Field label="Paste JSON" value={paste} onChange={setPaste} multiline />{button('Import pasted JSON', () => { try { const result = parseDocument(paste); commit(result.document); setRecovery(false); setMessage(result.notes.join('\n') || 'Imported.'); } catch (e) { setMessage(String(e)); } })}{button('Use current Fusion workspace', () => { try { load(fusion.exportConfig()); } catch (e) { setMessage(String(e)); } }, !fusion.widgets.length)}</section>
      <section className="luma-panel"><h2>Catalog manifest</h2><Field label="Manifest URL" value={manifestURL} onChange={setManifestURL} />{button('Load manifest', () => void manifest())}<p className="luma-muted">{catalogs.length} catalogs loaded. You can also enter add-on and catalog IDs manually.</p></section>
      <section className="luma-panel"><h2>Import into Luma</h2><p>Download the native JSON and import it using Collection Backups on iOS or Collections on macOS.</p><p>Apple TV currently imports flat collections, but its folder browser does not yet render nested hub pages. Those require a Luma tvOS update.</p><p className="luma-muted">Nested pages use Luma’s native collections format. Existing Fusion exports support flat groups and rows. Layout-only folders need catalog sources before they show content.</p></section>
    </aside><div className="luma-content">{doc.collections.map((hub, i) => { const path: Path = ['collections', i]; return <section id={`hub-${i}`} className="luma-hub" key={i}><div className="luma-hub-heading"><span className="luma-eyebrow">HOME COLLECTION {i + 1}</span>{controls(path, 'hub')}</div><div className="luma-fields"><Field label="Hub title" value={hub.title} onChange={v => change([...path, 'title'], v)} /><Select label="Collection view" value={hub.viewMode ?? 'ROWS'} values={['ROWS', 'TABBED_GRID', 'FOLLOW_LAYOUT']} onChange={v => change([...path, 'viewMode'], v)} /></div><div className="luma-actions">{toggle(hub, path, 'pinToTop', 'Pin to top')}{toggle(hub, path, 'hideTitle', 'Hide collection title')}{toggle(hub, path, 'showAllTab', 'Show All tab', true)}</div>{folders(hub.folders, [...path, 'folders'], 1)}</section>; })}
      {!doc.collections.length && <section className="luma-empty"><span className="luma-eyebrow">A HOME FOR EVERY WORLD</span><h2>Start your UME v4.0</h2><p>Create a collection, add hub folders, then build their pages with catalog rows, sections and subfolders.</p>{button('Create first hub', () => insert(['collections'], newHub()))}</section>}
      <details className="luma-panel"><summary>Native JSON preview</summary><pre>{JSON.stringify(doc.collections, null, 2)}</pre></details>
    </div></div><footer>Based on the open-source Fusion Widget Manager · Saved locally in this browser · <a href="https://github.com/nobnobz/luma-widget-manager">Source on GitHub</a></footer>
  </main>;
}
