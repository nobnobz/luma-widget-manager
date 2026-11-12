'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ManagedConnections, managedProviders, providerNames, type ManagedProvider } from '@/lib/luma-sync/connections';
import type { SyncDocuments } from '@/lib/luma-sync/documents';
import { SyncHTTPError } from '@/lib/luma-sync/passkey';

type Props = {
  token: string; profile: string; documents: SyncDocuments; providers: readonly ManagedProvider[] | null; canChange: boolean;
  commit: (bindings: Partial<Record<ManagedProvider, string>>, signal: AbortSignal) => Promise<void>;
  sessionEnded: () => void;
};
type Account = { provider: ManagedProvider; binding: string; username?: string; usable: boolean };
function failure(error: unknown) {
  if (error instanceof SyncHTTPError) {
    if (error.status === 409) return 'Luma changed this setup. Reload before trying again.';
    if (error.status === 429) return 'The service is busy. Wait and try again.';
  }
  if (error instanceof Error && error.message === 'connection_changed') return 'Save or discard your setup changes, then try again.';
  if (error instanceof Error && error.message === 'invalid_sync_data') return 'The connected accounts changed or the library could not be read. Reload and try again.';
  return 'Could not save the change. Check your internet connection and try again.';
}
export function WatchActivity({ token, profile, documents, providers, canChange, commit, sessionEnded }: Props) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [consent, setConsent] = useState<Awaited<ReturnType<SyncDocuments['watchActivity']>> | undefined>(undefined);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const references = useMemo(() => managedProviders.flatMap(provider => {
    if (!providers?.includes(provider)) return [];
    try {
      const binding = documents.managedConnection(profile, provider);
      return binding && binding !== 'disconnected' ? [{ provider, binding }] : [];
    } catch { return []; }
  }), [documents, profile, providers]);
  useEffect(() => {
    const control = new AbortController();
    void documents.watchActivity(profile).then(value => { if (!control.signal.aborted) setConsent(value); }).catch(() => { if (!control.signal.aborted) setConsent(null); });
    void Promise.all(references.map(async ({ provider, binding }): Promise<Account> => {
      const id = binding.slice(binding.lastIndexOf(':') + 1);
      try {
        const status = await new ManagedConnections(provider, profile, token).status(id, control.signal);
        return { provider, binding, username: status.username, usable: !status.needsReconnect };
      } catch (failed) {
        if (failed instanceof SyncHTTPError && failed.status === 401) sessionEnded();
        return { provider, binding, usable: false };
      }
    })).then(rows => { if (!control.signal.aborted) setAccounts(rows); });
    return () => control.abort();
  }, [documents, profile, references, token, sessionEnded]);
  if (!providers) return null;
  const usable = accounts?.filter(row => row.usable) ?? [];
  const covered = consent ? managedProviders.filter(provider => consent.accounts[provider]) : [];
  const waiting = consent ? usable.filter(row => consent.accounts[row.provider]?.binding !== row.binding) : [];
  const active = consent ? usable.filter(row => consent.accounts[row.provider]?.binding === row.binding) : [];
  async function change(bindings: Partial<Record<ManagedProvider, string>>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await commit(bindings, new AbortController().signal);
      setOpen(false);
      setNotice(Object.keys(bindings).length ? 'Sync watch activity is on. Your devices start the exchange at their next sync.' : 'Sync watch activity is off. Your Luma library stays as it is.');
    } catch (failed) {
      if (failed instanceof SyncHTTPError && failed.status === 401) sessionEnded();
      else setError(failure(failed));
    } finally { setBusy(false); }
  }
  const names = (rows: { provider: ManagedProvider }[]) => rows.map(row => providerNames[row.provider]).join(', ');
  return <div className="sync-record grid gap-3 pb-3" aria-labelledby="sync-watch-title">
    <div><h3 id="sync-watch-title" className="font-medium">Sync watch activity</h3>
      <p className="sync-setting-hint" role="status">{consent === undefined || accounts === null ? 'Checking…' : consent
        ? `On for ${names(covered.map(provider => ({ provider })))}${waiting.length ? `. Confirm ${names(waiting)} in Luma.` : ''}` : 'Off'}</p></div>
    <p className="sync-setting-note">Brings watchlist items, watched marks and saved pauses together with your connected Trakt, Simkl and MDBList accounts, and sends new watched marks from Luma to them. The exchange itself runs on your Luma devices at their next sync.</p>
    {accounts && !usable.length && <p className="sync-setting-note">Connect an account above first.</p>}
    {notice && <p className="sync-banner" role="status">{notice}</p>}
    {error && !open && <p className="sync-banner sync-error" role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {(!consent || waiting.length > 0) && <Button type="button" variant="outline" disabled={!canChange || !usable.length || busy} onClick={() => { setError(''); setOpen(true); }}>
        {consent ? 'Add connected accounts' : 'Turn on'}</Button>}
      {consent && <Button type="button" variant="outline" className="sync-danger-outline" disabled={!canChange || busy} onClick={() => void change({})}>{busy ? 'Saving…' : 'Turn off'}</Button>}
    </div>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="sync-confirm">
        <DialogTitle>Sync watch activity for this profile?</DialogTitle>
        <DialogDescription>These connected accounts will exchange watch activity with your Luma library from now on. Luma becomes this profile’s watch progress and watchlist source. Older Luma marks and ratings are not sent.</DialogDescription>
        <ul className="grid gap-1 text-sm">{usable.map(row => <li key={row.provider}><strong>{providerNames[row.provider]}</strong>{row.username ? ` · ${row.username}` : ''}</li>)}</ul>
        {error && <p className="sync-banner sync-error" role="alert">{error}</p>}
        <div className="sync-confirm-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void change(Object.fromEntries(usable.map(row => [row.provider, row.binding])))}>{busy ? 'Saving…' : 'Turn on'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    {active.length === 0 && consent && waiting.length === 0 && <p className="sync-setting-note">None of the covered accounts is connected right now.</p>}
  </div>;
}
