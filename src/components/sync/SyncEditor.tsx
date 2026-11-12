'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Image from 'next/image';
import { arrayMove } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, Check, Clock, Ellipsis, House, KeyRound, LogOut, Monitor, Moon, Plus, Puzzle, RefreshCw, Save, SlidersHorizontal, Sun, Tags, History, UsersRound, Smartphone } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HomeEditor } from './HomeEditor';
import { SortableRow, SortableRows } from './SortableRows';
import { SetupLibrary } from './SetupLibrary';
import { FormatterEditor } from './FormatterEditor';
import { PreferenceEditor } from './PreferenceEditor';
import { CatalogManifestImport, SyncCatalogProvider } from './SyncCatalogs';
import { ConfiguredAddonsEditor } from './ConfiguredAddonsEditor';
import { ProfileEditor } from './ProfileEditor';
import { ProviderConnections } from './ProviderConnections';
import { DevicesPanel } from './DevicesPanel';
import { ProtectedKeysPanel } from './ProtectedKeys';
import type { ProtectedKind } from '@/lib/luma-sync/protected-keys';
import { connectionID, ManagedConnections, managedProviders, type ManagedProvider } from '@/lib/luma-sync/connections';
import { withBasePath } from '@/lib/base-path';
import { MAX_SYNC_ADDONS, publicManifestURL } from '@/lib/luma-sync/addons';
import { initialProfileSnapshot, SyncDocuments, type ProfileEdit, type SyncProfileDraft } from '@/lib/luma-sync/documents';
import { displayProfileName, editedProfileName, profileFieldError } from '@/lib/luma-sync/profiles';
import { DraftVault, type LocalDraft } from '@/lib/luma-sync/draft-vault';
import { beginRegistration, finishRegistration, signIn, SyncHTTPError, syncRequest, type EditorSession, type PendingRegistration } from '@/lib/luma-sync/passkey';
import { SyncTransport, type LoadedSync } from '@/lib/luma-sync/transport';
import { lzfseDecoder, uuid, type Bytes } from '@/lib/luma-sync/wire';

const PANEL = 'sync-panel';
const ID_KEY = 'luma.widget-editor.browser-id.v1';
const SESSION_WARNING = 5 * 60_000;
const configuredAddonsEnabled = process.env.NEXT_PUBLIC_LUMA_CONFIGURED_ADDONS !== 'off';

type Operation = 'sign in' | 'register' | 'load' | 'save' | 'profile';
type DraftAction = { type: 'reload' | 'logout' } | { type: 'profile'; id: string };
type Workspace = { baseline: LoadedSync; documents: SyncDocuments; profile: string; draft: SyncProfileDraft };
type InterruptedDraft = { spaceID: string; value: LocalDraft };
type Backup = 'writing' | 'secured' | 'unavailable';
function message(error: unknown, operation: Operation) {
  if (error instanceof SyncHTTPError) {
    if (error.status === 403 && operation === 'register') return 'Could not create the account. Check your invitation or start again if the passkey request expired.';
    if (error.status === 409) return operation === 'profile' ? 'Luma changed this setup. Close this form and reload the profiles before trying again.' : 'Luma changed this setup. Your draft is still here. Reload to see the latest version.';
    if (error.status === 401) return 'This browser session ended. Sign in again to continue.';
    if (error.status === 403) return 'Access was declined or revoked. Check the passkey and your account in Luma.';
    if (error.status === 429) return 'The server reached a request or storage limit. Wait and try again.';
    if (error.status === 413) return 'The setup is larger than this server allows.';
    if (error.status === 426) return 'Update Luma and sync your profile once in the app before saving from the browser.';
  }
  if (error instanceof Error) {
    const profileError = profileFieldError(error);
    if (profileError) return profileError;
    if (error.name === 'NotAllowedError') return operation === 'register' ? 'Passkey setup was cancelled. You can try again.' : 'Passkey sign-in was cancelled or no matching passkey was available.';
    if (error.message === 'missing_prf') return 'This passkey provider could not unlock the encrypted setup. Try a browser and password manager with passkey PRF support.';
    if (error.message === 'unsupported_browser') return 'Open the editor directly on your Luma Sync server over HTTPS in a browser that supports passkeys.';
    if (error.message === 'sync_reset') return 'Cloud sync was reset. Resume sync in Luma and reload your setup here.';
    if (error.message === 'private_addon_route') return 'Use a manifest ID or a public manifest address for a new catalog source. Keep configured links in Luma.';
    if (error.message === 'addons_incomplete') return 'Some synced add-ons could not be read. Sync the profile in Luma, then reload before editing add-ons.';
    if (error.message === 'widget_source_missing') return 'Fill in the manifest ID, catalog type and catalog ID for each widget.';
    if (error.message === 'local_draft_discard') return 'The browser could not remove its local draft. Your changes are still here.';
  }
  return operation === 'register' ? 'Could not finish registration. If the account was created, you can sign in with the passkey.' : operation === 'save' || operation === 'profile' ? 'Could not confirm the save. Check the fields and reload the server setup before retrying if the connection was interrupted.'
    : operation === 'load' ? 'Could not read the setup. Check the server connection and try again.'
      : 'Could not sign in. Check that you are on the same server you use in Luma.';
}
function storedBrowserID() {
  let id: string | null = null;
  try { id = localStorage.getItem(ID_KEY); } catch { /* Report inability to reuse a slot below. */ }
  if (uuid(id)) return id;
  id = crypto.randomUUID();
  localStorage.setItem(ID_KEY, id);
  return id;
}
function move<T>(rows: T[], index: number, offset: number) {
  const next = [...rows];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}
function Text({ label, value, onChange, placeholder, maxLength = 1024 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; maxLength?: number }) {
  return <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">{label}<Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} className="text-foreground" /></label>;
}
function Switch({ checked, change, children }: { checked: boolean; change: (checked: boolean) => void; children: ReactNode }) {
  return <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => change(e.target.checked)} />{children}</label>;
}
function Appearance() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    return () => { if (previous === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', previous); };
  }, [theme]);
  const [open, setOpen] = useState(false);
  const options = [['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const;
  const [mode, title, Icon] = options.find(([id]) => hydrated && theme === id) ?? options[0];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Appearance" title={`Appearance: ${title}`}><Icon aria-hidden /></Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="sync-appearance-menu" aria-label="Appearance">
      {options.map(([id, label, OptionIcon]) => <Button key={id} type="button" variant="ghost" aria-pressed={id === mode}
        onClick={() => { setTheme(id); setOpen(false); }}>
        <OptionIcon aria-hidden />{label}{id === mode && <Check aria-hidden className="ml-auto" />}
      </Button>)}
    </PopoverContent>
  </Popover>;
}

function AddonsEditor({ draft, inherited, change }: { draft: SyncProfileDraft; inherited: boolean; change: (draft: SyncProfileDraft) => void }) {
  const [manifest, setManifest] = useState(''), [name, setName] = useState('');
  const [adding, setAdding] = useState(false), [remove, setRemove] = useState<string>();
  const url = publicManifestURL(manifest);
  const duplicate = draft.addons.some(addon => publicManifestURL(addon.manifestURL) === url);
  const incomplete = draft.addonStatus === 'incomplete';
  const readOnly = inherited || incomplete;
  function update(addons: SyncProfileDraft['addons']) { change({ ...draft, addons }); }
  function clearAdd() { setAdding(false); setName(''); setManifest(''); }
  function add() {
    if (!url || duplicate || readOnly || draft.addons.length >= MAX_SYNC_ADDONS) return;
    update([...draft.addons, { id: url, manifestURL: url, name: name.trim() || new URL(url).hostname, enabled: true, order: draft.addons.length }]);
    clearAdd();
  }
  return <section className={PANEL} aria-labelledby="addon-title">
    <div className="sync-section-heading"><h2 id="addon-title">Public add-ons</h2>
      {inherited && <span className="sync-meta">From the primary profile</span>}
      {!readOnly && <Button type="button" variant="outline" disabled={draft.addons.length >= MAX_SYNC_ADDONS}
        aria-expanded={adding} aria-controls={adding ? 'public-addon-form' : undefined} onClick={() => adding ? clearAdd() : setAdding(true)}><Plus />Add public add-on</Button>}
    </div>
    {incomplete && <p className="sync-setting-note" role="status">Some synced entries could not be read. Sync {inherited ? 'the primary profile' : 'this profile'} in Luma, then reload.</p>}
    {!incomplete && !draft.addons.length && <p className="sync-empty">{draft.addonStatus === 'missing'
      ? `No add-on list has synced from ${inherited ? 'the primary profile' : 'this profile'} yet. If it has public add-ons, sync it in Luma and reload here.`
      : 'No public add-ons in this profile.'}</p>}
    {!readOnly && adding && <form id="public-addon-form" className="sync-addon-form" onSubmit={event => { event.preventDefault(); add(); }}>
      <Text label="Public manifest URL" value={manifest} onChange={setManifest} placeholder="https://example.org/manifest.json" maxLength={8192} />
      <Text label="Add-on name" value={name} onChange={setName} placeholder="Optional" maxLength={128} />
      {manifest && !url && <p className="sync-setting-note">Use a public HTTPS link ending in /manifest.json. {configuredAddonsEnabled
        ? 'Personal links go under Configured add-ons.' : 'For personal links, use Luma.'}</p>}
      {duplicate && <p className="sync-setting-note">This add-on is already in this profile.</p>}
      <div className="sync-row-actions"><Button type="submit" disabled={!url || duplicate}>Add</Button>
        <Button type="button" variant="ghost" onClick={clearAdd}>Cancel</Button></div>
    </form>}
    <SortableRows ids={readOnly ? [] : draft.addons.map(addon => addon.manifestURL)} reorder={(from, to) => { if (!readOnly) update(arrayMove(draft.addons, from, to)); }}>{draft.addons.map((addon, index) => {
      const label = addon.name || new URL(addon.manifestURL).hostname;
      const host = new URL(addon.manifestURL).hostname;
      const card = <div className="sync-record sync-addon">
        <div className="min-w-0"><p className="font-medium break-words">{label}</p>{label !== host && <p className="sync-setting-hint break-words">{host}</p>}</div>
        {readOnly ? <span className="sync-meta">{addon.enabled ? 'On' : 'Off'}</span> : <div className="sync-addon-actions">
          <Switch checked={addon.enabled} change={enabled => update(draft.addons.map((item, i) => i === index ? { ...item, enabled } : item))}>Enabled</Switch>
          <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${label}`}><Ellipsis /></Button></PopoverTrigger>
            <PopoverContent align="end" className="home-node-menu">
              {index > 0 && <Button type="button" variant="ghost" onClick={() => update(move(draft.addons, index, -1))}><ArrowUp />Move up</Button>}
              {index < draft.addons.length - 1 && <Button type="button" variant="ghost" onClick={() => update(move(draft.addons, index, 1))}><ArrowDown />Move down</Button>}
              <Button type="button" variant="ghost" className="text-destructive" onClick={() => setRemove(addon.manifestURL)}>Remove…</Button>
            </PopoverContent>
          </Popover>
        </div>}
      </div>;
      return readOnly || draft.addons.length < 2 ? <div key={addon.manifestURL}>{card}</div> : <SortableRow key={addon.manifestURL} id={addon.manifestURL} label={label}>{card}</SortableRow>;
    })}</SortableRows>
    <Dialog open={!!remove} onOpenChange={open => { if (!open) setRemove(undefined); }}>
      <DialogContent className="sync-confirm">
        <DialogTitle>Remove {draft.addons.find(addon => addon.manifestURL === remove)?.name || 'add-on'}?</DialogTitle>
        <DialogDescription>Widgets using this add-on stay in your layout. Their catalogs may stop loading.</DialogDescription>
        <div className="sync-confirm-actions">
          <Button type="button" variant="outline" onClick={() => setRemove(undefined)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => { if (!readOnly) update(draft.addons.filter(addon => addon.manifestURL !== remove)); setRemove(undefined); }}>Remove add-on</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
export function SyncEditor() {
  const [automaticCatalogs, setAutomaticCatalogs] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [devicesSupported, setDevicesSupported] = useState<boolean | null>(null);
  const [keysSupported, setKeysSupported] = useState<boolean | null>(null);
  const [connectionProviders, setConnectionProviders] = useState<ManagedProvider[] | null>(null);
  const [registration, setRegistration] = useState<'invite' | 'open' | null>(null);
  const [create, setCreate] = useState(false), [invite, setInvite] = useState('');
  const [firstName, setFirstName] = useState('Main');
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState<Operation | null>(null);
  const [dirty, setDirty] = useState(false), [stale, setStale] = useState(false), [parked, setParked] = useState(false);
  const [backup, setBackup] = useState<Backup | null>(null), [ending, setEnding] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const editorBar = useRef<HTMLDivElement>(null), workspaceStart = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'home' | 'addons' | 'tracking' | 'tags' | 'preferences' | 'devices'>('home');
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const transport = useRef<SyncTransport | null>(null);
  const active = useRef<AbortController | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0), checkExpiry = useRef<(() => void) | null>(null);
  const vault = useRef<DraftVault | null>(null);
  const unsaved = useRef<LocalDraft | null>(null);
  const secured = useRef<LocalDraft | null>(null);
  const interrupted = useRef<InterruptedDraft | null>(null);
  const [confirm, setConfirm] = useState<DraftAction | null>(null);
  const [profileForm, setProfileForm] = useState<'create' | 'edit' | null>(null);
  const [profileMenu, setProfileMenu] = useState(false);
  const profileTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    void syncRequest('/v1/server', { signal: abort.signal }).then(value => {
      setAvailable(value.widgetEditor === 1);
      setConnectionProviders(value.widgetConnections === 1 ? managedProviders.filter(provider =>
        value[provider === 'mdblist' ? 'mdbListConnections' : `${provider}Connections`] === 1) : null);
      setDevicesSupported(value.widgetDevices === 1);
      setKeysSupported(value.widgetProtectedKeys === 1);
      setAutomaticCatalogs(value.widgetCatalogs === 1);
      if (value.widgetRegistration === 1 && (value.registration === 'open' || value.registration === 'invite')) setRegistration(value.registration);
    }).catch(() => {
      if (!abort.signal.aborted) setAvailable(false);
    });
    function dispose() {
      active.current?.abort(); active.current = null;
      transport.current?.close(); transport.current = null;
      if (expiry.current) clearTimeout(expiry.current);
      checkExpiry.current = null; deadline.current = 0; vault.current = null; secured.current = null;
    }
    function pageHide() { dispose(); unsaved.current = null; interrupted.current = null; setParked(false); setConnected(false); setWorkspace(null); setDirty(false); setStale(false); setEnding(false); setBackup(null); setBusy(null); setConfirm(null); setProfileForm(null); setProfileMenu(false); setStatus(''); setError(''); setPending(null); setInvite(''); setFirstName('Main'); setCreate(false); }
    function checkClock() { checkExpiry.current?.(); }
    window.addEventListener('pagehide', pageHide);
    window.addEventListener('focus', checkClock);
    document.addEventListener('visibilitychange', checkClock);
    return () => {
      window.removeEventListener('pagehide', pageHide);
      window.removeEventListener('focus', checkClock);
      document.removeEventListener('visibilitychange', checkClock);
      abort.abort(); dispose();
    };
  }, []);
  useEffect(() => {
    if (backup === 'secured' || !dirty && !parked) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = true; }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, parked, backup]);

  useEffect(() => {
    if (error && connected) feedbackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, connected]);

  function detach() {
    active.current?.abort(); active.current = null;
    const connection = transport.current;
    transport.current = null;
    if (expiry.current) { clearTimeout(expiry.current); expiry.current = null; }
    checkExpiry.current = null; deadline.current = 0; vault.current = null; secured.current = null; setEnding(false);
    setBusy(null); setWorkspace(null); setConnected(false); setDirty(false); setStale(false); setConfirm(null); setProfileForm(null); setProfileMenu(false);
    return connection;
  }
  function sessionEnded() {
    const spaceID = transport.current?.session.spaceID;
    const local = unsaved.current;
    if (spaceID && local && local !== secured.current) interrupted.current = { spaceID, value: local };
    unsaved.current = null;
    detach()?.close();
    setError('');
    setParked(!!local || !!interrupted.current);
    setStatus(local || interrupted.current ? '' : 'Session ended. Sign in to continue.');
  }
  function logout() {
    const connection = detach();
    const token = connection?.session.token;
    connection?.close();
    unsaved.current = null; interrupted.current = null; setParked(false); setBackup(null);
    setError(''); setStatus('');
    if (token) void syncRequest('/v1/editor/session', { method: 'DELETE', token }).catch(() => undefined);
  }
  function persist(value: LocalDraft) {
    const store = vault.current;
    secured.current = null;
    setBackup(store ? 'writing' : 'unavailable');
    if (!store) return;
    void store.write(value).then(
      () => {
        if (unsaved.current === value) { secured.current = value; setBackup('secured'); }
        else if (interrupted.current?.value === value) { interrupted.current = null; setBackup('secured'); }
      },
      () => { if (unsaved.current === value) setBackup('unavailable'); },
    );
  }
  async function discardLocal() {
    try { await vault.current?.clear(); }
    catch { throw new Error('local_draft_discard'); }
  }
  function run(operation: Operation, action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    if (deadline.current && Date.now() >= deadline.current) { sessionEnded(); return; }
    const control = new AbortController(); active.current = control;
    setBusy(operation); setError(''); setStatus(''); setConfirm(null);
    void action(control.signal).catch(failure => {
      if (control.signal.aborted) return;
      if (transport.current && failure instanceof SyncHTTPError && failure.status === 401) { sessionEnded(); return; }
      if (failure instanceof SyncHTTPError && failure.status === 409 && (operation === 'save' || operation === 'profile')) setStale(true);
      setError(message(failure, operation));
    }).finally(() => {
      if (active.current === control) { active.current = null; setBusy(null); }
    });
  }
  async function reload(connection: SyncTransport, signal: AbortSignal, selected?: string, initialName?: string, mode: 'normal' | 'recover' | 'discard' = 'normal') {
    let baseline = await connection.load(signal);
    const realm = await connection.realm();
    if (baseline.bootstrap) {
      try { await connection.publish(initialProfileSnapshot(realm, connection.session.deviceID, initialName), baseline, signal); }
      catch (error) {
        if (!(error instanceof SyncHTTPError) || error.status !== 409) throw error;
        baseline = await connection.load(signal);
        if (baseline.bootstrap) throw error;
      }
      if (baseline.bootstrap) baseline = await connection.load(signal);
    }
    const documents = new SyncDocuments(baseline, realm, connection.session.deviceID);
    if (configuredAddonsEnabled) await documents.unlockConfiguredAddons(connection.session.master);
    signal.throwIfAborted();
    let disk: LocalDraft | null = null;
    let unreadable = false;
    if (mode === 'recover') {
      try { disk = await vault.current?.read() ?? null; }
      catch { unreadable = true; }
    } else if (mode === 'discard') {
      await discardLocal();
    }
    signal.throwIfAborted();
    const memory = mode === 'recover' && interrupted.current?.spaceID === connection.session.spaceID ? interrupted.current.value : null;
    const previous = memory ?? disk;
    const canReview = previous && documents.canReviewDraft(previous.profile, previous.base);
    const profile = canReview ? previous.profile : documents.profiles.find(row => row.id === selected)?.id ?? documents.profiles[0]?.id;
    if (canReview && !documents.matchesDraft(previous.profile, previous.draft)) {
      const rebased = documents.restoreDraft(previous.profile, previous.base, previous.draft);
      const next = rebased ? { profile: previous.profile, base: documents.draftBaseline(previous.profile), draft: rebased } : previous;
      interrupted.current = null; setParked(false);
      unsaved.current = next;
      setWorkspace({ baseline, documents, profile: next.profile, draft: next.draft }); setDirty(true); setStale(!rebased);
      if (memory) persist(next);
      else { secured.current = next; setBackup('secured'); }
      setStatus(rebased ? 'Draft restored. Review it and save when ready.'
        : 'This profile changed since the draft was created. Your draft is shown for review. Reload to discard it and open the latest setup.');
      return;
    }
    if (previous && !documents.paused) {
      try { await discardLocal(); } catch { unreadable = true; }
      signal.throwIfAborted();
    }
    const next = profile ? { baseline, documents, profile, draft: documents.draft(profile) } : null;
    if (!documents.paused) interrupted.current = null;
    unsaved.current = null; secured.current = null; setParked(false); setBackup(null);
    setWorkspace(next);
    setDirty(false); setStale(false);
    if (documents.paused) setStatus('Cloud sync was reset. Resume sync in Luma before editing here.');
    else if (unreadable) setStatus('The browser could not open its local draft storage.');
    else if (previous && !canReview) setStatus('This draft belongs to a setup that was removed or reset. It could not be restored.');
    else if (!profile) setStatus('No profiles have synced yet. Enable sync in Luma, then reload here.');
  }
  async function attach(credential: EditorSession, signal: AbortSignal, initialName?: string) {
    let connection: SyncTransport | undefined;
    let storage: DraftVault | null = null;
    try {
      const wasm = await fetch(withBasePath('/sync-assets/lzfse.wasm'), { credentials: 'omit', mode: 'same-origin', redirect: 'error', signal });
      if (!wasm.ok) throw new Error('decoder_unavailable');
      connection = new SyncTransport(credential, await lzfseDecoder(await wasm.arrayBuffer()));
      try { storage = await DraftVault.unlock(credential.origin, credential.spaceID, credential.master); }
      catch { /* This session can still edit and save with an in-memory draft. */ }
      signal.throwIfAborted();
    } catch (error) {
      credential.master.fill(0);
      void syncRequest('/v1/editor/session', { token: credential.token, method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
    if (interrupted.current?.spaceID !== credential.spaceID) { interrupted.current = null; setParked(false); }
    vault.current = storage;
    transport.current = connection; setConnected(true);
    deadline.current = credential.expiresAt;
    function tick() {
      if (expiry.current) clearTimeout(expiry.current);
      const remaining = credential.expiresAt - Date.now();
      if (remaining <= 0) { sessionEnded(); return; }
      setEnding(remaining <= SESSION_WARNING);
      expiry.current = setTimeout(tick, remaining > SESSION_WARNING ? remaining - SESSION_WARNING : remaining);
    }
    checkExpiry.current = tick;
    tick();
    await reload(connection, signal, undefined, initialName, 'recover');
  }
  function connect() {
    run('sign in', async signal => attach(await signIn(storedBrowserID(), signal), signal));
  }
  function register() {
    run('register', async signal => {
      const name = editedProfileName(firstName);
      if (pending) {
        try { await attach(await finishRegistration(pending, signal), signal, name); }
        catch (error) { if (!(error instanceof DOMException && error.name === 'NotAllowedError')) setPending(null); throw error; }
        setPending(null); setFirstName('Main'); setCreate(false);
      } else {
        const flow = await beginRegistration(storedBrowserID(), invite.trim(), signal);
        signal.throwIfAborted();
        setPending(flow); setInvite('');
      }
    });
  }
  function requestConfirmation(action: DraftAction, control: HTMLElement) {
    opener.current = control;
    setConfirm(action);
  }
  function refresh(discard = false) {
    const connection = transport.current;
    const mode = discard ? 'discard' : !workspace || workspace.documents.paused ? 'recover' : 'normal';
    if (connection) run('load', signal => reload(connection, signal, workspace?.profile, undefined, mode));
  }
  function switchProfile(profile: string) {
    if (!workspace) return;
    try {
      const draft = workspace.documents.draft(profile);
      unsaved.current = null; secured.current = null;
      setWorkspace({ ...workspace, profile, draft });
      setConfirm(null); setDirty(false); setBackup(null); setStatus(''); setError('');
    } catch {
      setConfirm(null);
      setError('Could not open that profile. Your current setup is still here.');
    }
  }
  function save(nextProfile?: string) {
    const connection = transport.current;
    if (!connection || !workspace || stale) return;
    run('save', async signal => {
      const publication = await workspace.documents.encryptedPublication(workspace.profile, workspace.draft, connection.session.master);
      signal.throwIfAborted();
      if (!publication) {
        await discardLocal();
        signal.throwIfAborted();
        if (nextProfile) switchProfile(nextProfile);
        else { unsaved.current = null; secured.current = null; setDirty(false); setBackup(null); setStatus('No changes to sync.'); }
        return;
      }
      try { await connection.publish(publication, workspace.baseline, signal); }
      catch (error) {
        if (!(error instanceof SyncHTTPError) || error.status !== 409) throw error;
        const baseline = await connection.load(signal);
        const latest = new SyncDocuments(baseline, await connection.realm(), connection.session.deviceID);
        if (configuredAddonsEnabled) await latest.unlockConfiguredAddons(connection.session.master);
        const rebased = workspace.documents.rebaseDraft(workspace.profile, workspace.draft, latest);
        if (!rebased) throw error;
        const update = await latest.encryptedPublication(workspace.profile, rebased, connection.session.master);
        if (update) await connection.publish(update, baseline, signal);
      }
      signal.throwIfAborted();
      unsaved.current = null; secured.current = null; setDirty(false); setBackup(null); setStatus('Saved to Luma Sync.');
      let cleanupFailed = false;
      try { await discardLocal(); } catch { cleanupFailed = true; }
      signal.throwIfAborted();
      try { await reload(connection, signal, nextProfile ?? workspace.profile); }
      catch (failure) {
        if (!signal.aborted) {
          if (failure instanceof SyncHTTPError && failure.status === 401) { sessionEnded(); return; }
          if (nextProfile) {
            try { await reload(connection, signal, workspace.profile); }
            catch { if (!signal.aborted) setStale(true); }
            if (!signal.aborted) setError('Your draft was saved. The other profile could not be opened.');
          } else { setStale(true); setStatus('Saved to Luma Sync. Reload the latest setup to continue editing.'); }
        }
      }
      if (cleanupFailed && !signal.aborted) setError('Saved to Luma Sync, but the browser could not remove the local backup.');
    });
  }
  function edit(draft: SyncProfileDraft) {
    if (active.current || !workspace || workspace.documents.paused || stale) return;
    if (deadline.current && Date.now() >= deadline.current) { sessionEnded(); return; }
    const value = { profile: workspace.profile, base: unsaved.current?.base ?? workspace.documents.draftBaseline(workspace.profile), draft };
    unsaved.current = value;
    setWorkspace({ ...workspace, draft }); setDirty(true); setStatus('');
    persist(value);
  }
  function saveProfile(edit: ProfileEdit) {
    const connection = transport.current;
    if (!connection || !workspace || dirty || stale || !workspace.baseline.modern) return;
    run('profile', async signal => {
      const { id, snapshot } = workspace.documents.profilePublication(edit);
      if (snapshot) await connection.publish(snapshot, workspace.baseline, signal);
      signal.throwIfAborted();
      setProfileForm(null);
      if (!snapshot) return;
      try {
        await reload(connection, signal, id);
        if (!('id' in edit)) setTab('home');
        setStatus('Profile saved to Luma Sync.');
      } catch (failure) {
        if (signal.aborted) return;
        if (failure instanceof SyncHTTPError && failure.status === 401) { sessionEnded(); return; }
        setStale(true); setStatus('Profile saved to Luma Sync. Reload to see the latest profiles.');
      }
    });
  }
  function deleteProfile(id: string) {
    const connection = transport.current;
    if (!connection || !workspace || dirty || stale || !workspace.baseline.modern) return;
    run('profile', async signal => {
      const { snapshot, grants } = workspace.documents.profileDeletion(id);
      await connection.publish(snapshot, workspace.baseline, signal);
      signal.throwIfAborted();
      setProfileForm(null);
      // The roster is saved. Revoking the profile's provider grants is best effort, as a native client does before it publishes.
      let revoked = true;
      for (const grant of grants) {
        try { await new ManagedConnections(grant.provider, id, connection.session.token).disconnect(grant.id, signal); }
        catch { signal.throwIfAborted(); revoked = false; }
      }
      try {
        await reload(connection, signal, '1');
        setTab('home');
        setStatus(revoked ? 'Profile deleted. Other devices remove it on their next sync.' : 'Profile deleted. Other devices remove it on their next sync. Some connected accounts could not be disconnected; revoke them in the provider’s account settings.');
      } catch (failure) {
        if (signal.aborted) return;
        if (failure instanceof SyncHTTPError && failure.status === 401) { sessionEnded(); return; }
        setStale(true); setStatus('Profile deleted. Reload to see the latest profiles.');
      }
    });
  }
  async function commitConnection(provider: ManagedProvider, value: string, expected: string | undefined, signal: AbortSignal) {
    const connection = transport.current;
    if (!connection || !workspace || active.current || dirty || stale) throw new Error('connection_changed');
    for (let attempt = 0; attempt < 2; attempt++) {
      const baseline = await connection.load(signal);
      const documents = new SyncDocuments(baseline, await connection.realm(), connection.session.deviceID);
      const snapshot = documents.connectionPublication(workspace.profile, provider, value, expected);
      try { if (snapshot) await connection.publish(snapshot, baseline, signal); }
      catch (error) { if (attempt === 0 && error instanceof SyncHTTPError && error.status === 409) continue; throw error; }
      // Re-read confirms ambiguous replies on a retry and preserves all unrelated domains.
      await reload(connection, signal, workspace.profile);
      setStatus('Account connection saved to Luma Sync.');
      return;
    }
  }
  // Like account connections, a key change is published at once and never joins the setup draft.
  async function commitProtectedKey(kind: ProtectedKind, value: string, root: Bytes, signal: AbortSignal) {
    const connection = transport.current;
    if (!connection || !workspace || active.current || dirty || stale) throw new Error('connection_changed');
    for (let attempt = 0; attempt < 2; attempt++) {
      const baseline = await connection.load(signal);
      const documents = new SyncDocuments(baseline, await connection.realm(), connection.session.deviceID);
      const keys = documents.protectedKeys(workspace.profile, root);
      let register;
      try { register = await keys.propose(value, documents.protectedRegister(workspace.profile, kind), kind, connection.session.deviceID); }
      catch (error) { if (!(error instanceof SyncHTTPError)) throw new Error('key_invalid'); throw error; }
      if (!register) return;
      try { await connection.publish(documents.protectedKeyPublication(workspace.profile, kind, register), baseline, signal); }
      catch (error) { if (attempt === 0 && error instanceof SyncHTTPError && error.status === 409) continue; throw error; }
      await reload(connection, signal, workspace.profile);
      return;
    }
  }
  async function abandonConnection(provider: ManagedProvider, value: string, signal: AbortSignal) {
    const connection = transport.current;
    if (!connection || !workspace) throw new Error('connection_changed');
    for (let attempt = 0; attempt < 2; attempt++) {
      const baseline = await connection.load(signal), realm = await connection.realm();
      const documents = new SyncDocuments(baseline, realm, connection.session.deviceID);
      if (documents.managedConnection(workspace.profile, provider) === value) return true;
      // Keep the latest selection, advancing the cursor before revoking the
      // unused grant. A delayed earlier commit can no longer install it.
      try { await connection.publish(documents.connectionBarrier(workspace.profile, provider), baseline, signal); }
      catch (error) { if (attempt === 0 && error instanceof SyncHTTPError && error.status === 409) continue; throw error; }
      const id = connectionID(value, realm);
      if (id) await new ManagedConnections(provider, workspace.profile, connection.session.token).disconnect(id, signal);
      await reload(connection, signal, workspace.profile);
      return false;
    }
    throw new Error('connection_changed');
  }
  function openProfileForm(mode: 'create' | 'edit') {
    setProfileMenu(false); setError(''); setProfileForm(mode);
  }
  const disabled = !!busy || stale || !!workspace?.documents.paused || workspace?.baseline.modern === false || !!confirm || !!profileForm;
  const activeProfile = workspace?.documents.profiles.find(profile => profile.id === workspace.profile);
  const draftLabel = stale ? 'Draft needs review' : backup === 'secured' ? 'Draft secured on this browser' : backup === 'unavailable' ? 'Draft only in this tab' : 'Securing draft…';
  const expiryLabel = dirty ? 'Session ends in less than 5 minutes. Save to Luma Sync before it ends.' : 'Session ends in less than 5 minutes.';
  const feedback = <>
    {status && <p className={`sync-banner${status.startsWith('Saved to Luma Sync.') ? ' sync-saved' : ''}`} role="status">{status}</p>}
    {error && <p className="sync-banner sync-error" role="alert">{error}</p>}
  </>;
  return <div className="sync-web">
    <a className="sync-skip" href="#sync-main">Skip to content</a>
    <header className="sync-topbar">
      <div className="brand sync-brand"><Image src="/assets/luma-mark.svg" alt="" width={25} height={29} unoptimized /><span>Luma <span className="sync-brand-label">Sync</span></span></div>
      <div className="sync-toolbar"><Appearance />
        {connected && <Button className="sync-signout" aria-label="Sign out" title="Sign out" variant="ghost" disabled={dirty && !!busy} onClick={event => dirty ? requestConfirmation({ type: 'logout' }, event.currentTarget) : logout()}><LogOut /><span>Sign out</span></Button>}
      </div>
    </header>
    <main id="sync-main" tabIndex={-1} className={`sync-main${connected ? ' sync-setup' : ' sync-entry'}`}>
    <div className={connected ? 'sr-only' : 'sync-page-heading'}><h1>{connected ? 'Luma setup' : create ? 'Create account' : 'Sign in'}</h1></div>
    {!connected && <section className="sync-login">
      <p className="sync-lede">{create ? 'Set up an account with a passkey. Your setup is encrypted on this device before it is stored on your Luma Sync server.'
        : 'Edit your Luma setup in the browser. Sign in with the passkey you registered for Luma Sync. Your setup stays end-to-end encrypted.'}</p>
      {feedback}
      {parked && <p role="status" className="sync-banner">Session ended. Sign in with the same account to recover your draft.</p>}
      {available === null ? <p role="status" className="text-sm text-muted-foreground">Checking the server…</p> : !available ? <p className="text-sm text-muted-foreground">Open this page on your Luma Sync server.</p>
        : create ? <form className="grid justify-items-start gap-3" onSubmit={event => { event.preventDefault(); register(); }}>
          {pending ? <p className="text-sm">Confirm the passkey you just created.</p> : <>
            <label className="grid w-full max-w-xs gap-1 text-sm">First profile name<Input value={firstName} onChange={event => setFirstName(event.target.value)}
              autoComplete="off" required disabled={!!busy} /></label>
            {registration === 'invite' && <label className="grid w-full max-w-xs gap-1 text-sm">Invitation code<Input value={invite} onChange={e => setInvite(e.target.value)}
              maxLength={256} autoComplete="off" spellCheck={false} required disabled={!!busy} aria-describedby="sync-invite-hint" /><span id="sync-invite-hint" className="sync-setting-hint">The server operator gives you this code.</span></label>}
          </>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!!busy || (!pending && registration === 'invite' && !invite.trim())}><KeyRound />{pending ? 'Confirm passkey' : 'Create passkey'}</Button>
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => { setPending(null); setInvite(''); setFirstName('Main'); setError(''); setCreate(false); }}>Back to sign in</Button>
          </div>
        </form> : <div className="flex flex-wrap gap-2"><Button onClick={connect} disabled={!!busy}><KeyRound />{busy === 'sign in' ? 'Signing in…' : 'Sign in with passkey'}</Button>
          {registration && <Button variant="outline" disabled={!!busy} onClick={() => { setCreate(true); setError(''); }}>Create account</Button>}</div>}
    </section>}
    {connected && <div ref={editorBar} className="sync-editor-bar"><section className="sync-controls" aria-label="Sync controls">
      <div className="sync-controls-row">
        {workspace && <label className="sync-profile">Profile<select disabled={!!busy} value={workspace.profile} onChange={event => {
          const profile = event.currentTarget.value;
          if (dirty) requestConfirmation({ type: 'profile', id: profile }, event.currentTarget);
          else switchProfile(profile);
        }}>{workspace.documents.profiles.map(row => <option key={row.id} value={row.id}>{displayProfileName(row)}</option>)}</select></label>}
        {workspace && <Popover open={profileMenu} onOpenChange={setProfileMenu}>
          <PopoverTrigger asChild><Button ref={profileTrigger} variant="outline" disabled={disabled} aria-label="Manage profiles"><UsersRound /><span>Profiles</span></Button></PopoverTrigger>
          <PopoverContent align="end" className="sync-profile-menu" aria-label="Profile actions" onCloseAutoFocus={event => { if (profileForm) event.preventDefault(); }}>
            {dirty ? <p className="sync-setting-note">Save or reload your setup before managing profiles.</p> : <>
              <Button variant="ghost" onClick={() => openProfileForm('edit')}>Edit current profile</Button>
              <Button variant="ghost" disabled={!workspace.documents.unusedProfileSlot} onClick={() => openProfileForm('create')}>Create profile</Button>
              {!workspace.documents.unusedProfileSlot && <p className="sync-setting-note">{workspace.documents.profiles.length === 6 ? 'This account has six profiles.' : 'No unused slots. Manage previously deleted profiles in Luma.'}</p>}
            </>}
          </PopoverContent>
        </Popover>}
        <Button variant="outline" disabled={!!busy} onClick={event =>
          dirty ? requestConfirmation({ type: 'reload' }, event.currentTarget) : refresh()}><RefreshCw />{busy === 'load' ? 'Loading…' : 'Reload'}</Button>
        {workspace && <div className="sync-desktop-save">
          {dirty && <span className="sync-draft-note">{draftLabel}</span>}
          <Button disabled={disabled || !dirty} onClick={() => save()}><Save />{busy === 'save' ? 'Saving…' : 'Save to Luma Sync'}</Button>
        </div>}
      </div>
    </section>
    {ending && <p role="status" className="sync-banner sync-expiry sync-expiry-desktop"><Clock aria-hidden="true" />{expiryLabel}</p>}
    {workspace && (
      <nav className="sync-area-grid" aria-label="Setup sections">
        {([
          ['home', 'Home', House],
          ['addons', 'Add-ons', Puzzle],
          ['tracking', 'Tracking', History],
          ['tags', 'Tags', Tags],
          ['preferences', 'Preferences', SlidersHorizontal],
          ['devices', 'Devices', Smartphone],
        ] as const).map(([id, label, Icon]) => <button key={id} type="button" className="sync-area" aria-pressed={tab === id}
          aria-label={label} onClick={() => {
            if (tab === id) return;
            setTab(id);
            const start = workspaceStart.current;
            const bottom = editorBar.current?.getBoundingClientRect().bottom;
            if (start && bottom !== undefined && start.getBoundingClientRect().top < bottom) start.scrollIntoView({ block: 'start' });
          }}>
          <Icon aria-hidden className="size-4" />
          <span>{label}</span>
        </button>)}
      </nav>)}
    </div>}
    {connected && <div ref={feedbackRef} className="sync-feedback">
      {!profileForm && feedback}
      {workspace?.baseline.modern === false && <p className="text-xs text-muted-foreground">Update Luma and sync your profile once in the app to enable editing here.</p>}
    </div>}
    <Dialog open={!!profileForm} onOpenChange={open => { if (!open && busy !== 'profile') { setProfileForm(null); setError(''); } }}>
      {profileForm && workspace && <ProfileEditor key={`${profileForm}:${workspace.profile}`} profile={profileForm === 'edit' ? activeProfile : undefined}
        templates={profileForm === 'create' ? workspace.documents.profiles.map(profile => ({ profile, count: workspace.documents.publicAddonCount(profile.id) })).filter(row => row.count > 0) : []}
        preferred={workspace.profile} saving={busy === 'profile'} stale={stale} serverError={error}
        restoreFocus={() => { const target = profileTrigger.current; if (target && !target.disabled) target.focus({ preventScroll: true }); }}
        close={() => { setProfileForm(null); setError(''); }} submit={saveProfile}
        remove={profileForm === 'edit' && activeProfile && Number(activeProfile.id) !== 1 && workspace.documents.profiles.length > 1 ? deleteProfile : undefined} />}
    </Dialog>
    <Dialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}>
      {confirm && <DialogContent className="sync-confirm" onCloseAutoFocus={event => {
        event.preventDefault();
        const target = opener.current;
        opener.current = null;
        requestAnimationFrame(() => {
          if (target?.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
        });
      }}>
        <DialogTitle>Unsaved changes</DialogTitle>
        <DialogDescription>{confirm.type === 'profile' ? 'Save or discard this draft before switching profiles.'
          : confirm.type === 'reload' ? 'Reloading replaces this draft with the setup on Luma Sync.'
            : backup === 'secured' ? 'Keep the encrypted draft on this browser or discard it before signing out.' : 'Signing out will discard this draft.'}</DialogDescription>
        <div className="sync-confirm-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>Keep editing</Button>
          <Button variant="outline" className="sync-danger-outline" onClick={() => {
            const action = confirm;
            if (action.type === 'reload') refresh(true);
            else run('load', async signal => {
              await discardLocal();
              signal.throwIfAborted();
              if (action.type === 'profile') switchProfile(action.id);
              else logout();
            });
          }}>{confirm.type === 'profile' ? 'Discard and switch' : confirm.type === 'reload' ? 'Discard and reload' : 'Discard and sign out'}</Button>
          {confirm.type === 'profile' && !stale && <Button onClick={() => save(confirm.id)}>Save and switch</Button>}
          {confirm.type === 'logout' && backup === 'secured' && <Button onClick={logout}>Keep draft and sign out</Button>}
        </div>
      </DialogContent>}
    </Dialog>
    {workspace && <>
      <div ref={workspaceStart} />
      <SyncCatalogProvider key={`catalogs:${workspace.profile}`} draft={workspace.draft} token={automaticCatalogs ? transport.current?.session.token : undefined}><fieldset className="sync-workspace" disabled={disabled && tab !== 'home'} key={`${workspace.profile}:${tab}`}>
        {tab === 'home' && <HomeEditor draft={workspace.draft} change={edit} disabled={disabled} revision={workspace.documents}
          actions={apply => <SetupLibrary draft={workspace.draft} change={apply} disabled={disabled} />} />}
        {tab === 'addons' && <><AddonsEditor draft={workspace.draft} inherited={!!workspace.documents.profiles.find(row => row.id === workspace.profile)?.inheritsAddons} change={edit} />
          {configuredAddonsEnabled && <ConfiguredAddonsEditor rows={workspace.draft.configuredAddons ?? []} unavailable={!!workspace.draft.configuredUnavailable}
            inherited={!!workspace.documents.profiles.find(row => row.id === workspace.profile)?.inheritsAddons}
            change={configuredAddons => edit({ ...workspace.draft, configuredAddons })} />}<CatalogManifestImport showStatus /></>}
        {tab === 'tracking' && transport.current && <ProviderConnections token={transport.current.session.token} profile={workspace.profile}
          realm={workspace.documents.draftBaseline(workspace.profile).realm} documents={workspace.documents} providers={connectionProviders}
          dirty={dirty} canChange={!disabled && !dirty} commit={commitConnection} abandon={abandonConnection} sessionEnded={sessionEnded} />}
        {tab === 'preferences' && transport.current && <ProtectedKeysPanel token={transport.current.session.token} master={transport.current.session.master}
          spaceID={transport.current.session.spaceID} documents={workspace.documents} profile={workspace.profile} supported={keysSupported}
          dirty={dirty} canChange={!disabled && !dirty} commit={commitProtectedKey} sessionEnded={sessionEnded} />}
        {(tab === 'tracking' || tab === 'preferences') && <PreferenceEditor section={tab} values={workspace.draft.preferences}
          unavailable={workspace.draft.unavailablePreferences} addons={workspace.draft.addons} onChange={preferences => edit({ ...workspace.draft, preferences })} />}
        {tab === 'tags' && <FormatterEditor packs={workspace.draft.formatter} onChange={formatter => edit({ ...workspace.draft, formatter })}
          preferences={workspace.draft.preferences} unavailable={workspace.draft.unavailablePreferences}
          onPreferences={preferences => edit({ ...workspace.draft, preferences })} />}
        {tab === 'devices' && transport.current && <DevicesPanel token={transport.current.session.token} deviceID={transport.current.session.deviceID}
          supported={devicesSupported} sessionEnded={sessionEnded} />}
      </fieldset></SyncCatalogProvider>
      {(ending || dirty || status.startsWith('Saved to Luma Sync.')) && <div className="sync-mobile-save">
        {ending && <p role="status" className="sync-expiry sync-expiry-mobile"><Clock aria-hidden="true" />{expiryLabel}</p>}
        {(dirty || status.startsWith('Saved to Luma Sync.')) && <span role={dirty ? undefined : 'status'}>{dirty ? draftLabel : 'Saved to Luma Sync'}</span>}
        {dirty ? <Button disabled={disabled} onClick={() => save()}><Save />{busy === 'save' ? 'Saving…' : 'Save to Luma Sync'}</Button>
          : status.startsWith('Saved to Luma Sync.') && <Button variant="outline" onClick={() => setStatus('')}>Dismiss</Button>}
      </div>}
    </>}
    </main>
    <footer className="sync-footer">Luma Sync</footer>
  </div>;
}
