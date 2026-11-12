'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePicker } from './FilePicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { convertOmniToFusion } from '@/lib/omni-converter';
import { publicPacks, readPublicPack } from '@/lib/luma-sync/public-pack';
import { cloneFolder, editorToDocument } from '@/lib/luma-editor-adapter';
import { newID, parseDocument, starterDocument, validateDocument, type Hub } from '@/lib/luma-document';
import { MAX_HOME_FILE_BYTES } from '@/lib/luma-home-limits';
import { appendHomeFile, readHomeFile, writeVisibleHome, type HomeFile } from '@/lib/luma-sync/home-files';
import { applyCoverPack, loadCoverPack } from '@/lib/luma-sync/cover-pack';
import { collectionHomeID, collectionSource, type SyncProfileDraft } from '@/lib/luma-sync/documents';

export function SetupLibrary({ draft, change, disabled }: { draft: SyncProfileDraft; change: (next: SyncProfileDraft) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<'templates' | 'files' | 'covers'>('templates');
  const [covers, setCovers] = useState<Awaited<ReturnType<typeof loadCoverPack>>>();
  const [imported, setImported] = useState<Hub[]>();
  const [homeFile, setHomeFile] = useState<HomeFile>();
  const [template, setTemplate] = useState<Hub[]>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const result = covers && applyCoverPack(draft.collections, covers);

  function close(value: boolean) {
    setOpen(value);
    if (!value) {
      pending.current?.abort(); pending.current = null;
      setCovers(undefined); setImported(undefined); setHomeFile(undefined); setTemplate(undefined); setError(''); setLoading(false);
      setSection('templates');
    }
  }
  function add(hubs: Hub[], showOnHome: boolean) {
    try {
      const copies = hubs.map(hub => ({ ...hub, id: newID(), folders: hub.folders.map(cloneFolder) }));
      const collections = [...draft.collections, ...copies];
      validateDocument({ collections });
      const position = draft.home.reduce((max, row) => Math.max(max, row.position + 1), 0);
      const home = !showOnHome ? draft.home : [...draft.home, ...copies.map((hub, i) => ({
        id: collectionHomeID(hub.id), kind: 'collection' as const, title: '', position: position + i,
        source: collectionSource(hub.id), enabled: true,
      }))];
      change({ ...draft, collections, home });
      close(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not add these collections.'); }
  }
  async function importFile(file: File) {
    const control = new AbortController();
    pending.current?.abort(); pending.current = control;
    setError(''); setImported(undefined); setHomeFile(undefined); setLoading(true);
    try {
      if (file.size > MAX_HOME_FILE_BYTES) throw new Error('The file exceeds 4 MB.');
      const text = await file.text();
      const home = readHomeFile(JSON.parse(text));
      if (home) { if (!control.signal.aborted) setHomeFile(home); return; }
      const { document } = parseDocument(text);
      if (!document.collections.length) throw new Error('This file contains no collections.');
      if (!control.signal.aborted) setImported(document.collections);
    } catch (failure) {
      if (!control.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not open the collections file.');
    } finally { if (pending.current === control) { pending.current = null; setLoading(false); } }
  }
  async function loadTemplate() {
    const control = new AbortController();
    pending.current = control; setError(''); setLoading(true);
    try {
      const text = await readPublicPack(publicPacks.template, MAX_HOME_FILE_BYTES, AbortSignal.any([control.signal, AbortSignal.timeout(12_000)]));
      const config = convertOmniToFusion(JSON.parse(text));
      const document = editorToDocument(config.widgets.filter(widget => widget.type === 'collection.row'));
      validateDocument(document);
      if (!document.collections.length) throw new Error();
      if (!control.signal.aborted) setTemplate(document.collections);
    } catch { if (!control.signal.aborted) setError('Could not load the UME collections. Try again.'); }
    finally { if (pending.current === control) { pending.current = null; setLoading(false); } }
  }
  async function findCovers() {
    const control = new AbortController();
    pending.current = control; setError(''); setLoading(true);
    try { setCovers(await loadCoverPack(AbortSignal.any([control.signal, AbortSignal.timeout(12_000)]))); }
    catch { if (!control.signal.aborted) setError('Could not load the UME cover pack. Try again.'); }
    finally { if (pending.current === control) { pending.current = null; setLoading(false); } }
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogTrigger asChild><Button variant="outline" disabled={disabled}>Home tools</Button></DialogTrigger>
    <DialogContent className="sync-library">
      <DialogTitle>Home tools</DialogTitle>
      <DialogDescription className="sr-only">Templates, layout files and animated covers for this profile.</DialogDescription>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3">
        <div className="sync-choice-bar" role="group" aria-label="Home tools">
          {([['templates', 'Templates'], ['files', 'Home file'], ['covers', 'Covers']] as const).map(([key, label]) =>
            <Button key={key} type="button" variant="ghost" aria-pressed={section === key} onClick={() => {
              if (section === key) return;
              pending.current?.abort(); pending.current = null;
              setSection(key); setError(''); setLoading(false);
            }}>{label}</Button>)}
        </div>
        {section === 'templates' && <div className="sync-template-grid">
          <section className="sync-template">
            <h3>UME Hub Starter</h3>
            <p>Empty folders for Movies, Series and Anime.</p>
            <Button variant="outline" onClick={() => add(starterDocument().collections, true)}>Add starter to Home</Button>
          </section>
          <section className="sync-template">
            <h3>UME Omni <span className="sync-meta">3.1.1</span></h3>
            <p>Requires AIOMetadata catalogs.</p>
            {!template ? <Button variant="outline" disabled={loading} onClick={() => void loadTemplate()}>{loading ? 'Loading…' : 'Load UME collections'}</Button> : <>
              <p role="status">{template.length} collections</p>
              <Button variant="outline" disabled={loading} onClick={() => add(template, false)}>Add UME collections</Button></>}
          </section>
        </div>}
        {section === 'files' && <section className="sync-library-row">
          <h3 className="text-sm font-semibold">Import a layout</h3>
          <p className="sync-setting-hint">Adds rows to this profile. Existing rows stay in place.</p>
          <FilePicker label="Luma layout or collections JSON" disabled={loading} onPick={file => void importFile(file)} />
          {homeFile && <div className="flex flex-wrap items-center gap-2"><p role="status" className="text-sm text-muted-foreground">{homeFile.home.length} Home rows</p>
            <Button variant="outline" onClick={() => {
              try { change(appendHomeFile(draft, homeFile)); close(false); }
              catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not import Home.'); }
            }}>Add rows to Home</Button></div>}
          <Button variant="outline" className="justify-self-start" disabled={!draft.home.some(row => row.enabled)} onClick={() => {
            try {
              const url = URL.createObjectURL(new Blob([writeVisibleHome(draft)], { type: 'application/json' }));
              const link = document.createElement('a'); link.href = url; link.download = 'Luma-Home.json'; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not export Home.'); }
          }}>Export visible Home</Button>
          {imported && <div className="flex flex-wrap items-center gap-2"><p role="status" className="text-sm text-muted-foreground">{imported.length} {imported.length === 1 ? 'collection' : 'collections'}</p>
            <Button variant="outline" disabled={loading} onClick={() => add(imported, false)}>Add to collections</Button></div>}
        </section>}
        {section === 'covers' && <section className="sync-library-row">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Animated covers</h3>
            {!result && <Button variant="outline" disabled={loading || !draft.collections.length} onClick={() => void findCovers()}>{loading ? 'Finding covers…' : 'Find matching covers'}</Button>}
          </div>
          {!draft.collections.length ? <p className="text-xs text-muted-foreground">Add a collection first.</p> : !result ? null
            : !result.changed.length ? <p role="status" className="text-sm">No matching folders without covers.</p>
              : <><p role="status" className="text-sm">{result.changed.length} {result.changed.length === 1 ? 'folder matches' : 'folders match'}.</p>
                <ul className="max-h-28 list-inside list-disc overflow-auto text-sm text-muted-foreground">{result.changed.map((title, index) => <li key={index}>{title}</li>)}</ul>
                <Button variant="outline" className="justify-self-start" onClick={() => { change({ ...draft, collections: result.collections }); close(false); }}>Apply covers</Button></>}
        </section>}
      </fieldset>
      {error && <p role="alert" className="sync-banner sync-error">{error}</p>}
    </DialogContent>
  </Dialog>;
}
