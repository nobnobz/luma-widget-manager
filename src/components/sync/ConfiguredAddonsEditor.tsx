'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { configuredID, configuredManifestURL, type ConfiguredAddon } from '@/lib/luma-sync/configured-addons';
import { useConfiguredManifestStatus } from './SyncCatalogs';

export function ConfiguredAddonsEditor({ rows, unavailable, inherited, change }: {
  rows: ConfiguredAddon[]; unavailable: boolean; inherited: boolean; change: (rows: ConfiguredAddon[]) => void;
}) {
  const { rows: manifests, retry } = useConfiguredManifestStatus();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState(''), [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = configuredManifestURL(link);
  const duplicate = rows.some(row => row.id !== editing && row.manifestURL === parsed);
  const editable = !inherited && !unavailable;
  function edit(row?: ConfiguredAddon) {
    setEditing(row?.id ?? ''); setName(row?.name ?? ''); setLink(row?.manifestURL ?? '');
  }
  function stopEdit() { setEditing(null); setName(''); setLink(''); }
  function move(index: number, offset: number) {
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    change(next);
  }
  async function accept() {
    if (!parsed || duplicate || !editable || (editing === '' && rows.length >= 100)) return;
    setSaving(true);
    try {
      const id = await configuredID(parsed);
      const existing = rows.find(row => row.id === editing);
      const row = { id, name: name.trim(), manifestURL: parsed, enabled: existing?.enabled ?? true, order: existing?.order ?? rows.length };
      change(existing ? rows.map(item => item.id === existing.id ? row : item) : [...rows, row]);
      stopEdit();
    } finally { setSaving(false); }
  }
  return <section className="sync-panel" aria-labelledby="configured-addons-title">
    <div className="sync-section-heading"><h2 id="configured-addons-title">Configured add-ons</h2>
      {inherited && <span className="sync-meta">From the primary profile</span>}
      {editable && editing === null && <Button type="button" variant="outline" disabled={rows.length >= 100} onClick={() => edit()}>Add configured add-on</Button>}
    </div>
    <p className="sync-meta">Personal links are synced encrypted. This browser loads each manifest directly from its provider.</p>
    {unavailable ? <p role="status" className="sync-meta">Configured add-ons could not be unlocked. Reload this profile to try again.</p> :
      !rows.length && <p className="sync-empty">No configured add-ons have synced from {inherited ? 'the primary profile' : 'this profile'} yet.</p>}
    {rows.map((row, index) => {
      const result = manifests?.get(row.id), host = new URL(row.manifestURL).hostname;
      const displayName = row.name || result?.name || host;
      return <div className="sync-record sync-addon" key={row.id}>
        <div className="min-w-0"><p className="font-medium">{displayName}</p><p className="sync-meta">{host}</p>
          <p className="sync-meta" role="status">{!row.enabled ? 'Disabled' : result === undefined ? 'Loading manifest…' : result === null
            ? 'Manifest unavailable in this browser' : !result.catalogs.length ? 'Manifest loaded · No Home catalogs' :
              `${result.catalogs.length} ${result.catalogs.length === 1 ? 'catalog' : 'catalogs'} available`}</p></div>
        {editable && <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Edit ${displayName}`} onClick={() => edit(row)}>Edit</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => change(rows.map(item => item.id === row.id ? { ...row, enabled: !row.enabled } : item))}>{row.enabled ? 'Disable' : 'Enable'}</Button>
          <Button type="button" size="sm" variant="outline" disabled={index === 0} aria-label={`Move ${displayName} up`} onClick={() => move(index, -1)}>↑</Button>
          <Button type="button" size="sm" variant="outline" disabled={index + 1 === rows.length} aria-label={`Move ${displayName} down`} onClick={() => move(index, 1)}>↓</Button>
          <Button type="button" size="sm" variant="outline" className="sync-danger-outline" aria-label={`Remove ${displayName}`} onClick={() => { if (editing === row.id) stopEdit(); change(rows.filter(item => item.id !== row.id)); }}>Remove</Button>
        </div>}
      </div>;
    })}
    {rows.some(row => row.enabled && manifests?.get(row.id) === null) && <Button type="button" variant="outline" size="sm" onClick={retry}>Retry configured manifests</Button>}
    {editable && editing !== null && <div className="sync-record grid gap-3">
      <label className="grid gap-1 text-sm">Configured add-on name<input className="min-w-0 px-3" value={name} autoComplete="off" maxLength={128} onChange={e => setName(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Personal manifest URL<input className="min-w-0 px-3" type="password" autoComplete="new-password" spellCheck={false} value={link} maxLength={4096} onChange={e => setLink(e.target.value)} /></label>
      {link && !parsed && <p className="sync-meta">Enter the configured HTTPS manifest link from the add-on’s setup page. Public links belong in Add-ons above.</p>}
      {duplicate && <p className="sync-meta">This link is already installed for this profile.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!parsed || duplicate || saving} onClick={() => { void accept(); }}>{editing ? 'Apply add-on changes' : 'Add to profile'}</Button>
        <Button type="button" variant="outline" onClick={stopEdit}>Cancel</Button>
      </div>
    </div>}
  </section>;
}
