'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { connectionID, disconnected, managedProviders, ManagedConnections, providerNames, waitForConnection,
  type ConnectionChallenge, type ConnectionStatus, type ManagedProvider } from '@/lib/luma-sync/connections';
import { SyncHTTPError } from '@/lib/luma-sync/passkey';
import type { SyncDocuments } from '@/lib/luma-sync/documents';

type Props = {
  token: string; profile: string; realm: string; documents: SyncDocuments;
  providers: readonly ManagedProvider[] | null; canChange: boolean; dirty: boolean;
  commit: (provider: ManagedProvider, value: string, expected: string | undefined, signal: AbortSignal) => Promise<void>;
  abandon: (provider: ManagedProvider, value: string, signal: AbortSignal) => Promise<boolean>;
  sessionEnded: () => void;
};
function failureMessage(error: unknown) {
  if (error instanceof SyncHTTPError) {
    if (error.status === 401) return 'Your session ended. Sign in again to continue.';
    if (error.status === 403) return 'This server does not allow this action. Reload or sign in again.';
    if (error.status === 404) return 'This authorization expired or was removed. Start again.';
    if (error.status === 409) return 'The authorization expired or the setup changed. Reload before trying again.';
    if (error.status === 429) return 'The service is busy. Wait and try again.';
  }
  if (error instanceof Error && error.message === 'connection_changed') return 'This account was changed on another device. Close and reload before trying again.';
  if (error instanceof Error && error.message === 'connection_expired') return 'The code expired. Start again to get a new code.';
  return 'Could not confirm the connection. Check your internet connection and try again.';
}
function ProviderAccount({ provider, ...props }: Props & { provider: ManagedProvider }) {
  const { token, profile, realm, documents, providers, canChange, commit, abandon, sessionEnded } = props;
  const name = providerNames[provider];
  const client = useMemo(() => new ManagedConnections(provider, profile, token), [provider, profile, token]);
  let selection: string | undefined, id: string | undefined, unreadable = false;
  try { selection = documents.managedConnection(profile, provider); id = connectionID(selection, realm); }
  catch { unreadable = true; }
  const enabled = !!providers?.includes(provider);
  const [account, setAccount] = useState<ConnectionStatus | null>(null), [missing, setMissing] = useState(false);
  const [statusError, setStatusError] = useState(''), [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<'connect' | 'disconnect' | null>(null);
  const [challenge, setChallenge] = useState<ConnectionChallenge | null>(null);
  const [ready, setReady] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null), pending = useRef<string | null>(null), approved = useRef(false);
  const expected = useRef<string | undefined>(undefined);
  const ended = useRef(sessionEnded);
  useEffect(() => { ended.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => {
    const control = new AbortController();
    if (id && enabled) void client.status(id, control.signal).then(value => {
      if (!control.signal.aborted) { setAccount(value); setMissing(false); setStatusError(''); }
    }).catch(error => {
      if (control.signal.aborted) return;
      if (error instanceof SyncHTTPError && error.status === 401) { ended.current(); return; }
      setAccount(null); setMissing(error instanceof SyncHTTPError && error.status === 404);
      setStatusError(error instanceof SyncHTTPError && error.status === 404 ? '' : failureMessage(error));
    });
    return () => control.abort();
  }, [client, id, enabled, revision]);
  useEffect(() => () => {
    active.current?.abort();
    if (pending.current && !approved.current) void client.cancel(pending.current).catch(() => undefined);
  }, [client]);

  async function install(value: string, signal: AbortSignal) {
    await commit(provider, value, expected.current, signal);
    signal.throwIfAborted();
    const previous = connectionID(expected.current, realm);
    // Commit first: cancelling or losing the replacement flow keeps the old account.
    if (previous && value !== disconnected && previous !== connectionID(value, realm)) {
      try { await client.disconnect(previous, signal); }
      catch { setNotice('New account connected. The previous authorization could not be removed; revoke it in the provider’s account settings.'); }
    }
    pending.current = null; setReady(null); setChallenge(null); setMode(null); setRevision(n => n + 1);
  }
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const control = new AbortController(); active.current = control; setBusy(true); setError('');
    try { await action(control.signal); }
    catch (error) {
      if (!control.signal.aborted) {
        if (error instanceof SyncHTTPError && error.status === 401) sessionEnded();
        else setError(failureMessage(error));
      }
    }
    finally { if (active.current === control) { active.current = null; setBusy(false); } }
  }
  function connect() {
    expected.current = selection; approved.current = false; pending.current = null;
    setMode('connect'); setChallenge(null); setReady(null); setNotice('');
    void run(async signal => {
      const flow = await client.start(crypto.randomUUID(), signal);
      pending.current = flow.id;
      if (signal.aborted) { void client.cancel(flow.id).catch(() => undefined); signal.throwIfAborted(); }
      setChallenge(flow);
      const deadline = Date.now() + flow.expiresIn * 1000;
      let interval = flow.interval;
      while (Date.now() + interval * 1000 < deadline) {
        await waitForConnection(interval * 1000, signal);
        try {
          const next = await client.poll(flow.id, signal);
          signal.throwIfAborted();
          if (next.state === 'pending') { interval = next.interval; continue; }
          approved.current = true;
          const value = `${realm}:${next.account.id}`;
          setReady(value); setChallenge(null);
          await install(value, signal); return;
        } catch (error) {
          if (approved.current) throw error;
          if (error instanceof SyncHTTPError && error.status === 429) { interval = Math.max(interval, error.retryAfter ?? 5); continue; }
          if (error instanceof TypeError || error instanceof Error && error.name === 'TimeoutError' || error instanceof SyncHTTPError && error.status >= 500) continue;
          throw error;
        }
      }
      throw new Error('connection_expired');
    });
  }
  async function close() {
    if (ready && ready !== disconnected) {
      void run(async signal => {
        // A publication reply may have been lost. Re-read before revoking.
        const installed = await abandon(provider, ready, signal);
        if (installed) { await install(ready, signal); return; }
        pending.current = null; setReady(null); setChallenge(null); setMode(null);
      });
      return;
    }
    active.current?.abort(); active.current = null; setBusy(false);
    if (pending.current && !approved.current) void client.cancel(pending.current).catch(() => undefined);
    pending.current = null; setReady(null); setChallenge(null); setMode(null); setRevision(n => n + 1);
  }
  const status = unreadable ? 'Manage this connection in Luma.' : id ?
    missing || account?.needsReconnect ? 'Reconnect this account.' : account?.id === id ? `Connected as ${account.username}` : statusError || 'Checking account…'
    : selection === disconnected ? 'Disconnected' : 'No Luma Sync connection';
  return <div className="sync-record grid min-w-0 content-start gap-3 pb-3">
    <div><h3 className="font-medium">{name}</h3><p className="sync-setting-hint" role="status">{status}</p></div>
    {!enabled && <p className="sync-setting-hint">{providers === null ? 'Update the Sync server to manage accounts here.' : `${name} is not enabled on this Sync server.`}</p>}
    {notice && <p className="sync-setting-note" role="status">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!enabled || !canChange || unreadable} onClick={connect}>
        {id ? missing || account?.needsReconnect ? 'Reconnect' : 'Switch account' : 'Connect'} {name}
      </Button>
      {id && <Button type="button" variant="outline" disabled={!enabled || !canChange || unreadable} onClick={() => {
        expected.current = selection; setMode('disconnect'); setReady(null); setError('');
      }}>Disconnect {name}</Button>}
      {id && enabled && statusError && <Button type="button" variant="ghost" aria-label={`Check ${name} connection`} onClick={() => setRevision(n => n + 1)}><RefreshCw />Retry</Button>}
    </div>
    <Dialog open={mode !== null} onOpenChange={open => { if (!open) void close(); }}>
      <DialogContent className="max-w-md [&_[data-slot=dialog-close]]:hidden" onEscapeKeyDown={event => { event.preventDefault(); if (!busy || !ready) void close(); }}
        onPointerDownOutside={event => event.preventDefault()}>
        <DialogTitle>{mode === 'disconnect' ? `Disconnect ${name}?` : `Connect ${name}`}</DialogTitle>
        <DialogDescription>{mode === 'disconnect' ? 'This disconnects the account from this Luma profile on every synced device.'
          : 'Approve this code in your own account. The connection will be saved for this profile on your Luma devices.'}</DialogDescription>
        {mode === 'connect' && challenge && <div className="grid gap-3">
          <p className="text-center font-mono text-2xl tracking-widest" aria-label={`${name} device code`}>{challenge.userCode}</p>
          <a className="inline-flex items-center justify-center gap-2 underline" href={challenge.verificationURL} target="_blank" rel="noopener noreferrer">Open {name}<ExternalLink aria-hidden className="size-4" /></a>
          <p className="sync-setting-hint" role="status">Waiting for approval… The code is valid for up to {Math.ceil(challenge.expiresIn / 60)} minutes.</p>
        </div>}
        {ready && <p role="status">{busy ? 'Saving the connection to Luma Sync…' : 'The account change could not be confirmed in Luma Sync. Retry to finish.'}</p>}
        {busy && !challenge && !ready && <p role="status">{mode === 'connect' ? 'Requesting a code…' : 'Disconnecting…'}</p>}
        {error && <p className="sync-setting-note text-destructive" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={!!ready && busy} onClick={() => void close()}>{ready ? 'Close' : 'Cancel'}</Button>
          {ready && <Button type="button" disabled={busy} onClick={() => void run(signal => install(ready, signal))}>Retry save</Button>}
          {!ready && mode === 'disconnect' && <Button type="button" variant="destructive" disabled={busy} onClick={() => void run(async signal => {
            if (!id) return;
            await client.disconnect(id, signal); approved.current = true; setReady(disconnected);
            await install(disconnected, signal);
          })}>Disconnect on all devices</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
export function ProviderConnections(props: Props) {
  return <section className="sync-panel" aria-labelledby="sync-accounts-title">
    <h2 id="sync-accounts-title">Connected accounts</h2>
    <p className="sync-setting-note">Connect once per profile. Existing direct sign-ins stay on their device. Account changes are saved immediately.</p>
    {props.dirty && <p className="sync-setting-note">Save or discard your setup changes before changing an account.</p>}
    <div className="grid gap-3 md:grid-cols-3">{managedProviders.map(provider => <ProviderAccount {...props} key={provider} provider={provider} />)}</div>
  </section>;
}
