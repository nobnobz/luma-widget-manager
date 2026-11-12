'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SyncDocuments } from '@/lib/luma-sync/documents';
import { SyncHTTPError } from '@/lib/luma-sync/passkey';
import type { Bytes } from '@/lib/luma-sync/wire';
import { NativeRoot, normalizeKey, protectedKinds, protectedKindNames, validateKey, type ProtectedKind } from '@/lib/luma-sync/protected-keys';

type Props = {
  token: string; master: Bytes; spaceID: string; documents: SyncDocuments; profile: string;
  supported: boolean | null; canChange: boolean; dirty: boolean;
  commit: (kind: ProtectedKind, value: string, root: Bytes, signal: AbortSignal) => Promise<void>;
  sessionEnded: () => void;
};
type Access = 'loading' | 'ready' | 'empty' | 'waiting' | 'error';
type Entry = { state: 'set'; value: string } | { state: 'unset' } | { state: 'unreadable' };
function failure(error: unknown) {
  if (error instanceof SyncHTTPError) {
    if (error.status === 403) return 'This server does not allow API keys for this session. Reload or sign in again.';
    if (error.status === 409) return 'Luma changed this setup. Reload before trying again.';
    if (error.status === 429) return 'The service is busy. Wait and try again.';
  }
  if (error instanceof Error && error.message === 'key_invalid') return 'Use the key without spaces or line breaks, up to 4096 bytes.';
  if (error instanceof Error && error.message === 'connection_changed') return 'Save or discard your setup changes, then try again.';
  return 'Could not save the key. Check your internet connection and try again.';
}
function KeyRow({ kind, entry, busy, canChange, save, remove }: { kind: ProtectedKind; entry: Entry | undefined; busy: boolean; canChange: boolean;
  save: (value: string) => void; remove: () => void }) {
  const name = protectedKindNames[kind];
  const [value, setValue] = useState(''), [typing, setTyping] = useState(false), [reveal, setReveal] = useState(false);
  const status = !entry ? 'Checking…' : entry.state === 'set' ? 'Set' : entry.state === 'unset' ? 'Not set' : 'Cannot be read on this server';
  const normalized = normalizeKey(value);
  let invalid = false;
  try { validateKey(normalized); } catch { invalid = true; }
  return <div className="sync-record grid min-w-0 content-start gap-3 pb-3">
    <div><h3 className="font-medium">{name} API key</h3><p className="sync-setting-hint" role="status">{status}</p></div>
    {entry?.state === 'set' && <div className="flex flex-wrap items-center gap-2">
      <output className="sync-secret" aria-label={`${name} key`}>{reveal ? entry.value : '•'.repeat(Math.min(24, Math.max(8, entry.value.length)))}</output>
      <Button type="button" variant="ghost" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff /> : <Eye />}{reveal ? 'Hide' : 'Show'}</Button>
    </div>}
    {entry?.state === 'unreadable' && <p className="sync-setting-note">This key was written in a form this browser cannot open. Replace it from Luma.</p>}
    {entry && entry.state !== 'unreadable' && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); if (!invalid && normalized) { save(normalized); setValue(''); setTyping(false); } }}>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">{entry.state === 'set' ? `Replace ${name} key` : `${name} key`}
        <span className="flex gap-2"><Input className="text-foreground" type={typing ? 'text' : 'password'} value={value} autoComplete="new-password" spellCheck={false}
          autoCapitalize="none" maxLength={4200} disabled={!canChange || busy} onChange={event => setValue(event.target.value)} aria-invalid={invalid || undefined} />
          <Button type="button" variant="outline" size="icon" aria-label={typing ? `Hide the ${name} key you are typing` : `Show the ${name} key you are typing`} aria-pressed={typing}
            onClick={() => setTyping(!typing)}>{typing ? <EyeOff /> : <Eye />}</Button></span></label>
      {invalid && <p className="sync-setting-note text-destructive" role="alert">Use the key without spaces or line breaks, up to 4096 bytes.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canChange || busy || invalid || !normalized}>{busy ? 'Saving…' : entry.state === 'set' ? 'Replace key' : 'Save key'}</Button>
        {entry.state === 'set' && <Button type="button" variant="outline" className="sync-danger-outline" disabled={!canChange || busy} onClick={remove}>Remove key</Button>}
      </div>
    </form>}
  </div>;
}
export function ProtectedKeysPanel(props: Props) {
  const { token, master, spaceID, documents, profile, supported, canChange, dirty, commit, sessionEnded } = props;
  const client = useMemo(() => new NativeRoot(token, master, spaceID), [token, master, spaceID]);
  const [access, setAccess] = useState<Access>('loading');
  const [root, setRoot] = useState<Bytes | null>(null);
  const [entries, setEntries] = useState<Partial<Record<ProtectedKind, Entry>>>({});
  const [busy, setBusy] = useState<ProtectedKind | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  const ended = useRef(sessionEnded);
  useEffect(() => { ended.current = sessionEnded; }, [sessionEnded]);
  // The root is read-only here and only held in memory while this panel is shown.
  useEffect(() => {
    if (!supported) return;
    const control = new AbortController();
    let opened: Bytes | undefined;
    void client.existing(control.signal).then(found => {
      if (control.signal.aborted) return;
      if (found === 'none') { setRoot(null); setAccess('empty'); return; }
      if (found === 'waiting') { setRoot(null); setAccess('waiting'); return; }
      opened = found.root; setRoot(found.root); setAccess('ready');
    }).catch(failed => {
      if (control.signal.aborted) return;
      if (failed instanceof SyncHTTPError && failed.status === 401) { ended.current(); return; }
      setAccess('error');
    });
    return () => { control.abort(); opened?.fill(0); setRoot(null); setEntries({}); };
  }, [client, supported, attempt]);
  useEffect(() => {
    let current = true;
    void (async () => {
      const next: Partial<Record<ProtectedKind, Entry>> = {};
      for (const kind of protectedKinds) {
        let register;
        try { register = documents.protectedRegister(profile, kind); } catch { next[kind] = { state: 'unreadable' }; continue; }
        if (!register) { next[kind] = { state: 'unset' }; continue; }
        if (!root) { next[kind] = { state: 'unreadable' }; continue; }
        try { const value = await documents.protectedKeys(profile, root).open(register, kind); next[kind] = value ? { state: 'set', value } : { state: 'unset' }; }
        catch { next[kind] = { state: 'unreadable' }; }
      }
      if (current) setEntries(next);
    })();
    return () => { current = false; };
  }, [documents, profile, root]);
  async function change(kind: ProtectedKind, value: string) {
    if (busy) return;
    setBusy(kind); setError(''); setNotice('');
    const control = new AbortController();
    try {
      let active = root;
      if (!active) {
        active = (await client.ensure(control.signal)) ?? null;
        if (!active) { setAccess('waiting'); return; }
        setRoot(active); setAccess('ready');
      }
      await commit(kind, value, active, control.signal);
      setNotice(value ? `${protectedKindNames[kind]} key saved. It is stored encrypted and reaches your apps on their next sync.` : `${protectedKindNames[kind]} key removed. Your apps remove it on their next sync.`);
    } catch (failed) {
      if (failed instanceof SyncHTTPError && failed.status === 401) ended.current();
      else setError(failure(failed));
    } finally { setBusy(null); }
  }
  return <section className="sync-panel" aria-labelledby="sync-keys-title">
    <h2 id="sync-keys-title">API keys</h2>
    <p className="sync-setting-note">Your personal TMDB and MDBList keys for this profile. A key is stored encrypted and reaches your apps on their next sync.</p>
    {dirty && <p className="sync-setting-note">Save or discard your setup changes before changing a key.</p>}
    {supported === false && <p className="sync-empty">This Sync server does not store API keys from the browser yet. Enter them in Luma.</p>}
    {supported && access === 'loading' && <p className="sync-empty" role="status">Checking your keys…</p>}
    {supported && access === 'error' && <div className="sync-banner sync-error" role="alert"><p>Could not reach the key store. Check your internet connection and try again.</p>
      <Button type="button" variant="outline" className="mt-2" onClick={() => { setAccess('loading'); setAttempt(n => n + 1); }}>Try again</Button></div>}
    {supported && access === 'waiting' && <p className="sync-banner" role="status">Open Luma on a device that already has your keys and sync once, then reload. Keys cannot be changed here until then.</p>}
    {notice && <p className="sync-banner" role="status">{notice}</p>}
    {error && <p className="sync-banner sync-error" role="alert">{error}</p>}
    {supported && (access === 'ready' || access === 'empty') && <div className="grid gap-3 md:grid-cols-2">
      {protectedKinds.map(kind => <KeyRow key={`${profile}:${kind}`} kind={kind} entry={entries[kind]} busy={busy === kind} canChange={canChange && !dirty}
        save={value => void change(kind, value)} remove={() => void change(kind, '')} />)}
    </div>}
  </section>;
}
