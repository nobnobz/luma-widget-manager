'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Globe, RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SyncDevices, type SyncDevice } from '@/lib/luma-sync/devices';
import { SyncHTTPError } from '@/lib/luma-sync/passkey';

type Props = { token: string; deviceID: string; supported: boolean | null; sessionEnded: () => void };
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const added = (time: number) => dateFormat.format(time);
// A browser slot is named by the portal itself, so its stored name says little: lead with what it is.
const title = (row: SyncDevice, current: string) => row.browser ? (row.id === current ? 'This browser' : 'Web browser') : row.name || 'Unnamed device';
const detail = (row: SyncDevice) => `${row.browser && row.name ? `${row.name} · ` : ''}Added ${added(row.createdAt)}`;
function failure(error: unknown, action: 'load' | 'remove') {
  if (error instanceof SyncHTTPError) {
    if (error.status === 403) return action === 'remove' ? 'This device cannot be removed here. Browser sessions end when they sign out.' : 'This server does not allow device management for this session.';
    if (error.status === 429) return 'The service is busy. Wait and try again.';
  }
  return action === 'load' ? 'Could not load your devices. Check your internet connection and try again.' : 'Could not remove the device. Check your internet connection and try again.';
}
export function DevicesPanel({ token, deviceID, supported, sessionEnded }: Props) {
  const client = useMemo(() => new SyncDevices(token), [token]);
  const [devices, setDevices] = useState<SyncDevice[] | null>(null);
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<SyncDevice | null>(null);
  const [busy, setBusy] = useState(false), [removeError, setRemoveError] = useState('');
  const [notice, setNotice] = useState('');
  const ended = useRef(sessionEnded);
  useEffect(() => { ended.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => {
    if (!supported) return;
    const control = new AbortController();
    void client.list(control.signal).then(rows => {
      if (control.signal.aborted) return;
      setDevices(rows); setError('');
    }).catch(failed => {
      if (control.signal.aborted) return;
      if (failed instanceof SyncHTTPError && failed.status === 401) { ended.current(); return; }
      setError(failure(failed, 'load'));
    });
    return () => control.abort();
  }, [client, supported, revision]);
  function reload() { setError(''); setDevices(null); setRevision(n => n + 1); }
  async function remove() {
    if (!target || busy) return;
    setBusy(true); setRemoveError('');
    try {
      await client.remove(target.id);
      setNotice(`${target.name || 'Device'} was removed. It can be connected again from Luma.`);
      setTarget(null); setRevision(n => n + 1);
    } catch (failed) {
      if (failed instanceof SyncHTTPError && failed.status === 401) { setTarget(null); ended.current(); }
      else setRemoveError(failure(failed, 'remove'));
    } finally { setBusy(false); }
  }
  const active = devices?.filter(row => row.revokedAt === null) ?? [];
  const removed = (devices?.filter(row => row.revokedAt !== null) ?? []).sort((a, b) => b.revokedAt! - a.revokedAt!);
  return <section className="sync-panel" aria-labelledby="sync-devices-title">
    <div className="sync-section-heading">
      <div><h2 id="sync-devices-title">Devices</h2>
        <p className="sync-setting-note">Devices that sync this account. Removing a device only stops its syncing.</p></div>
      {supported && <Button type="button" variant="outline" disabled={devices === null && !error} onClick={reload}><RefreshCw />Refresh</Button>}
    </div>
    {notice && <p className="sync-banner" role="status">{notice}</p>}
    {supported === null && <p className="sync-empty" role="status">Checking the server…</p>}
    {supported === false && <p className="sync-empty">This Sync server does not offer device management in the browser yet. Manage devices in Luma.</p>}
    {supported && error && <div className="sync-banner sync-error" role="alert"><p>{error}</p>
      <Button type="button" variant="outline" className="mt-2" onClick={reload}><RefreshCw />Try again</Button></div>}
    {supported && !error && devices === null && <p className="sync-empty" role="status">Loading devices…</p>}
    {supported && devices && <>
      {active.length === 0 ? <p className="sync-empty">No active devices.</p> : <ul className="sync-device-list" aria-label="Active devices">
        {active.map(row => {
          const Icon = row.browser ? Globe : Smartphone;
          return <li key={row.id} className="sync-device">
            <Icon aria-hidden className="sync-device-icon" />
            <div className="sync-device-copy"><strong>{title(row, deviceID)}</strong>
              <span className="sync-setting-hint">{detail(row)}</span></div>
            {row.browser ? null
              : <Button type="button" variant="outline" className="sync-danger-outline" aria-label={`Remove ${row.name || 'unnamed device'}`}
                onClick={() => { setRemoveError(''); setNotice(''); setTarget(row); }}>Remove device</Button>}
          </li>;
        })}
      </ul>}
      {removed.length > 0 && <details className="sync-record sync-device-removed">
        <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" />Recently removed ({removed.length})</summary>
        <ul className="sync-device-list" aria-label="Recently removed devices">
          {removed.map(row => <li key={row.id} className="sync-device is-removed">
            {row.browser ? <Globe aria-hidden className="sync-device-icon" /> : <Smartphone aria-hidden className="sync-device-icon" />}
            <div className="sync-device-copy"><strong>{title(row, deviceID)}</strong>
              <span className="sync-setting-hint">{detail(row)} · Removed {added(row.revokedAt!)}</span></div>
          </li>)}
        </ul>
      </details>}
    </>}
    <Dialog open={!!target} onOpenChange={open => { if (!open && !busy) setTarget(null); }}>
      {target && <DialogContent className="sync-confirm">
        <DialogTitle>Remove {target.name || 'this device'}?</DialogTitle>
        <DialogDescription>It stops syncing with this account. Its local data stays on the device, and you can connect it again later from Luma.</DialogDescription>
        {removeError && <p className="sync-setting-note text-destructive" role="alert">{removeError}</p>}
        <div className="sync-confirm-actions">
          <Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>Keep device</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove device'}</Button>
        </div>
      </DialogContent>}
    </Dialog>
  </section>;
}
