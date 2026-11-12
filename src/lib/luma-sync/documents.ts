import { projectSyncAddons, publicManifestURL, readSyncAddons, type SyncAddon } from './addons';
import { validateDocument, type Hub } from '../luma-document';
import { base64, compare, int, json, object, parse, requireSync, unbase64, utf8, type JSONObject } from './wire';
import { FORMATTER_FIELD, formatterValue, readFormatter, type FormatterPack } from './formatter';
import { MAX_SYNC_HOME_WIDGETS } from '../luma-home-limits';
import { isPreferenceField, isSkipField, skipFields, skipSchemaField, validPreferenceValue, type PreferenceSettings } from './preferences';
import { isJellyfinCatalogReference } from './jellyfin';
import { ConfiguredAddonCipher, configuredMaxRecords, configuredPrefix, type ConfiguredAddon } from './configured-addons';
import { editedProfileAvatar, editedProfileName, isProfileSlot, profileSlots } from './profiles';
import type { Bytes } from './wire';
import type { LoadedSync } from './transport';
import { protectedField, ProtectedKeys, type ProtectedKind, type ProtectedRegister } from './protected-keys';
import { connectionField, connectionID, disconnected, managedProviders, type ManagedProvider } from './connections';

const PREFIX = 'apple.kvs.sync.v2';
const ACCOUNT = '__account__';
const PROFILE = 'profile', EPOCH = 'deletionEpoch', RESET = 'deletionMarker';
const HOME = 'homeContent.v1', WIDGETS = 'homeWidgets.v1', COLLECTIONS = 'collections.v2', ADDONS = 'addons';
const COMMON = 'commonSettings.v1';
const editable = [HOME, WIDGETS, COLLECTIONS, ADDONS, COMMON];
const allowed = [...editable, 'settings', 'settings.macos.v1', 'local-library.v1'];
// AppleSyncDomain.allProfileDomains, in the order the native clients clear them.
const profileDomains = ['settings', COMMON, 'settings.macos.v1', HOME, WIDGETS, COLLECTIONS, ADDONS, 'local-library.v1'];
const key = (profile: string, domain: string) => `${PREFIX}.${profile}.${domain}`;
const decode = (value: unknown) => parse(unbase64(value, 64_000_000));
const encode = (value: unknown) => base64(json(value));
interface Stamp { counter: number; device: string }
interface Register<T> { value: T; stamp: Stamp }
interface RecordEntry { stamp: Stamp; value?: string }
interface Envelope { data: string; deletionEpoch?: string }
interface StoredEntry extends RecordEntry { envelope?: Envelope }
interface Source { addonID: string; mediaType: string; catalogID: string; collectionID: string }
interface ContentEntry extends JSONObject { source: Source; title: Register<string>; enabled: Register<boolean>; position: Register<number> }
interface RowEntry extends JSONObject { stamp: Stamp; row?: string; seeds?: Record<string, string> }
interface RowDocument { entries: Map<string, RowEntry>; migratedPlatforms: Set<string> }
interface WireProfile { id: string; name: string; avatar: string; isPinProtected: boolean; isAdmin: boolean; usesPrimaryAddons: boolean; usesPrimaryPlugins: boolean }
export interface SyncProfile { id: string; name: string; avatar: string; inheritsAddons: boolean }
export type ProfileEdit = { name: string; avatar: string } & ({ id: string; inheritsAddons: boolean } | { copyPublicFrom?: string });
export interface SyncHomeRow { id: string; kind: 'catalog' | 'collection' | 'widget'; title: string; position: number; enabled: boolean; source: Source; widget?: JSONObject }
export interface SyncProfileDraft { home: SyncHomeRow[]; collections: Hub[]; addons: SyncAddon[]; addonStatus: 'ready' | 'missing' | 'incomplete'; configuredAddons?: ConfiguredAddon[]; configuredUnavailable?: boolean; formatter: FormatterPack[] | null; preferences: PreferenceSettings | null; unavailablePreferences: string[] }
export interface DraftBaseline {
  realm: string;
  epoch?: string;
  roster: string[];
  draft: SyncProfileDraft;
  settings: Record<string, unknown> | null;
}
interface Snapshot extends JSONObject { schema: 1; realm: string; device: string; platform: string; records: Record<string, RecordEntry> }
const compareStamp = (a: Stamp, b: Stamp) => a.counter - b.counter || compare(a.device, b.device);
const stableJSON = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort(compare).filter(k => (value as JSONObject)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJSON((value as JSONObject)[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const equal = (a: unknown, b: unknown) => stableJSON(a) === stableJSON(b);
function addonRoutes(hubs: Hub[]) {
  const urls = new Set<string>();
  function folder(row: Hub['folders'][number]) {
    for (const source of row.sources ?? []) if (['addon', 'jellyfin'].includes(source.provider) && source.addonId) urls.add(source.addonId);
    row.sections?.forEach(section => section.folders.forEach(folder));
    row.subfolders?.forEach(folder);
  }
  hubs.forEach(hub => hub.folders.forEach(folder));
  return urls;
}
function verifyAddonRoute(value: string) {
  if (isJellyfinCatalogReference(value)) return;
  if (/^[a-z][a-z0-9+.-]*:\/\/|^stremio:/i.test(value.trim()) && !publicManifestURL(value)) throw new Error('private_addon_route');
}
function stamp(value: unknown): Stamp {
  const { counter, device } = object(value);
  requireSync(int(counter) && typeof device === 'string' && device.length <= 128);
  return { counter, device };
}
function register<T>(value: unknown, check: (value: unknown) => value is T): Register<T> {
  const raw = object(value);
  requireSync(check(raw.value));
  return { ...raw, value: raw.value, stamp: stamp(raw.stamp) };
}
const string = (value: unknown): value is string => typeof value === 'string';
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
function joinRegister<T>(a: Register<T>, b: Register<T>): Register<T> {
  const diff = compareStamp(a.stamp, b.stamp);
  if (diff === 0) requireSync(equal(a.value, b.value));
  return diff < 0 ? b : a;
}
const nextStamp = (counter: number, device: string): Stamp => { requireSync(int(counter, 1)); return { counter, device }; };
const sourceID = (source: Source) => [source.collectionID ? 'collection' : 'catalog', source.addonID, source.mediaType, source.catalogID, source.collectionID]
  .map(value => `${utf8.encode(value).length}:${value}`).join('');
function readSource(value: unknown): Source {
  const raw = object(value);
  const { addonID, mediaType, catalogID, collectionID } = raw;
  requireSync(string(addonID) && string(mediaType) && string(catalogID) && string(collectionID) &&
    (collectionID ? !addonID && !mediaType && !catalogID : addonID && mediaType && catalogID));
  return { ...raw, addonID, mediaType, catalogID, collectionID };
}
function readContent(candidates: Envelope[]) {
  const rows = new Map<string, ContentEntry>();
  for (const item of candidates) {
    const doc = object(decode(item.data));
    requireSync(doc.version === 1);
    for (const [id, raw] of Object.entries(object(doc.entries))) {
      const entry = object(raw), source = readSource(entry.source);
      requireSync(sourceID(source) === id);
      const title = register(entry.title, string), enabled = register(entry.enabled, boolean), position = register(entry.position, int);
      const old = rows.get(id);
      rows.set(id, { ...old, ...entry, source, title: old ? joinRegister(old.title, title) : title,
        enabled: old ? joinRegister(old.enabled, enabled) : enabled, position: old ? joinRegister(old.position, position) : position });
    }
  }
  return rows;
}
function unionSeed(a: JSONObject, b: JSONObject): JSONObject {
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => {
    if (!Object.hasOwn(b, k)) return [k, a[k]];
    const left = a[k], right = b[k];
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) return [k, unionSeed(object(left), object(right))];
    const isObject = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
    if (Array.isArray(left) && Array.isArray(right) && left.every(isObject) && right.every(isObject)) {
      const result = [...left];
      for (const row of right) {
        const id = object(row).id;
        const i = string(id) ? result.findIndex(item => object(item).id === id) : -1;
        if (i >= 0) result[i] = unionSeed(object(result[i]), object(row));
        else if (!result.some(item => equal(item, row))) result.push(row);
      }
      return [k, result];
    }
    return [k, right];
  }));
}
function compareData(a: string, b: string) {
  const lhs = unbase64(a, 64_000_000), rhs = unbase64(b, 64_000_000);
  for (let i = 0; i < Math.min(lhs.length, rhs.length); i++) if (lhs[i] !== rhs[i]) return lhs[i] - rhs[i];
  return lhs.length - rhs.length;
}
function readRows(candidates: Envelope[]): RowDocument {
  const entries = new Map<string, RowEntry>(), migratedPlatforms = new Set<string>();
  for (const item of candidates) {
    const doc = object(decode(item.data));
    requireSync(doc.version === 2 && Array.isArray(doc.migratedPlatforms) && doc.migratedPlatforms.every(string));
    doc.migratedPlatforms.forEach(value => migratedPlatforms.add(value));
    for (const [id, raw] of Object.entries(object(doc.entries))) {
      const value = object(raw), row = value.row == null ? undefined : value.row;
      requireSync(row === undefined || string(row));
      if (row !== undefined) { const data = object(decode(row)); requireSync(data.id === id && string(data.title)); }
      const seeds = value.seeds == null ? undefined : Object.fromEntries(Object.entries(object(value.seeds)).map(([device, data]) => {
        requireSync(string(data) && object(decode(data)).id === id); return [device, data];
      }));
      const next = { ...value, stamp: stamp(value.stamp), row, seeds };
      const old = entries.get(id);
      if (!old) { entries.set(id, next); continue; }
      const diff = compareStamp(old.stamp, next.stamp);
      if (old.seeds && next.seeds && old.row && next.row) {
        const merged = new Map(Object.entries(old.seeds));
        for (const [device, data] of Object.entries(next.seeds)) {
          const previous = merged.get(device);
          if (!previous || compareData(previous, data) < 0) merged.set(device, data);
        }
        const combined = [...merged.keys()].sort(compare).reduce<JSONObject>((acc, device) => unionSeed(acc, object(decode(merged.get(device)))), {});
        entries.set(id, { ...old, ...next, stamp: diff < 0 ? next.stamp : old.stamp, row: encode(combined), seeds: Object.fromEntries(merged) });
      } else if (diff < 0 || diff === 0 && (!next.row || old.row && compareData(next.row, old.row) < 0)) entries.set(id, next);
    }
  }
  return { entries, migratedPlatforms };
}
type ProfileRegisters = Map<string, Map<string, Register<unknown>>>;
const profileValues = (profile: WireProfile) => ({ exists: true, name: profile.name, avatar: profile.avatar,
  pin: profile.isPinProtected, admin: profile.isAdmin, addons: profile.usesPrimaryAddons, plugins: profile.usesPrimaryPlugins });
function wireProfile(raw: unknown): WireProfile {
  const { id, name, avatar, isPinProtected, isAdmin, usesPrimaryAddons, usesPrimaryPlugins } = object(raw);
  requireSync(string(id) && isProfileSlot(id) && string(name) && string(avatar) && boolean(isPinProtected) &&
    boolean(isAdmin) && boolean(usesPrimaryAddons) && boolean(usesPrimaryPlugins));
  return { id, name, avatar, isPinProtected, isAdmin, usesPrimaryAddons, usesPrimaryPlugins };
}
function profileRegisters(candidates: Envelope[]): ProfileRegisters {
  const rows: ProfileRegisters = new Map();
  for (const candidate of candidates) {
    const { profiles, revisions } = object(decode(candidate.data));
    requireSync(Array.isArray(profiles) && profiles.length <= 6);
    const legacy = profiles.map(wireProfile);
    requireSync(new Set(legacy.map(row => Number(row.id))).size === legacy.length);
    const raw = revisions == null ? Object.fromEntries(legacy.map(profile => [profile.id, {
      fields: Object.fromEntries(Object.entries(profileValues(profile)).map(([key, value]) => [key, { stamp: { counter: 0, device: '' }, value }])),
    }])) : object(revisions);
    for (const [id, value] of Object.entries(raw)) {
      const old = rows.get(id) ?? new Map<string, Register<unknown>>();
      for (const [field, raw] of Object.entries(object(object(value).fields))) {
        const item = object(raw), next = { ...item, stamp: stamp(item.stamp), value: item.value };
        requireSync(string(item.value) || boolean(item.value) || typeof item.value === 'number' && Number.isFinite(item.value));
        const previous = old.get(field);
        if (!previous || compareStamp(previous.stamp, next.stamp) < 0) old.set(field, next);
      }
      rows.set(id, old);
    }
  }
  return rows;
}
function projectProfiles(rows: ProfileRegisters): WireProfile[] {
  const slots = new Set<number>(), result: WireProfile[] = [];
  for (const [id, fields] of rows) {
    const get = (name: string) => fields.get(name)?.value;
    const exists = get('exists');
    requireSync(boolean(exists)); if (!exists) continue;
    requireSync(!slots.has(Number(id)));
    slots.add(Number(id)); result.push(wireProfile({ id, name: get('name'), avatar: get('avatar'), isPinProtected: get('pin'),
      isAdmin: get('admin'), usesPrimaryAddons: get('addons'), usesPrimaryPlugins: get('plugins') }));
  }
  return result.sort((a, b) => Number(a.id) - Number(b.id));
}
function readWidget(raw: unknown): JSONObject & { id: string; source: Source; title: string; enabled: boolean; position: number } {
  const value = object(raw);
  const { id, title, enabled, position, mediaType } = value, source = readSource(value.source);
  const extras = Object.values(object(value.extras));
  requireSync(string(id) && id.length > 0 && id.length <= 128 && string(title) && boolean(enabled) && int(position) && !source.collectionID &&
    (mediaType == null || ['all', 'movie', 'series'].includes(String(mediaType))) && extras.length <= 32 && extras.every(string));
  return { ...value, id, source, title, enabled, position };
}
export const collectionSource = (collectionID: string): Source => ({ collectionID, addonID: '', mediaType: '', catalogID: '' });
export const collectionHomeID = (id: string) => `collection:${sourceID(collectionSource(id))}`;

function newProfile(id: string, name: string, avatar: string): WireProfile {
  return { id, name, avatar, isPinProtected: false, isAdmin: id === '1', usesPrimaryAddons: id === '1', usesPrimaryPlugins: true };
}
export function initialProfileSnapshot(realm: string, device: string, name = 'Main'): Snapshot {
  return { schema: 1, realm, device, platform: 'macos', records: {
    [key(ACCOUNT, PROFILE)]: { stamp: { counter: 1, device }, value: encode({
      schemaVersion: 2, profileID: ACCOUNT, domain: PROFILE, deviceID: device,
      modifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      data: encode({ profiles: [newProfile('1', editedProfileName(name), '')] }),
    }) },
  } };
}

export class SyncDocuments {
  readonly profiles: SyncProfile[];
  private groups = new Map<string, StoredEntry[]>();
  private own: Snapshot;
  private maximum = 0;
  private epoch: string | undefined;
  private device: string;
  private realmID: string;
  private roster: ProfileRegisters;
  private configured = new Map<string, ConfiguredAddon[] | null>();
  constructor(loaded: LoadedSync, realm: string, device: string) {
    this.device = device;
    this.realmID = realm;
    // The schema predates browsers. This required compatibility label is unused
    // for shared domains; an editor snapshot never contains a settings slot.
    this.own = { schema: 1, realm, device, platform: 'macos', records: {} };
    for (const [writer, raw] of loaded.snapshots) {
      const snapshot = object(raw);
      requireSync(snapshot.schema === 1 && snapshot.realm === realm && snapshot.device === writer &&
        ['ios', 'tvos', 'macos'].includes(String(snapshot.platform)));
      const records = Object.entries(object(snapshot.records));
      requireSync(records.length <= 1024);
      const ownRecords: [string, RecordEntry][] = [];
      for (const [recordKey, raw] of records) {
        const match = /^apple\.kvs\.sync\.v2\.([^.]+)\.(.+)$/.exec(recordKey);
        requireSync(match && recordKey.length <= 256);
        const [, profile, domain] = match;
        requireSync((profile === ACCOUNT ? [PROFILE, EPOCH, RESET] : allowed).includes(domain));
        const item = object(raw), revision = stamp(item.stamp);
        requireSync(revision.counter > 0 && revision.device === writer);
        this.maximum = Math.max(this.maximum, revision.counter);
        const value = item.value == null ? undefined : item.value;
        requireSync(value === undefined || string(value));
        let envelope: Envelope | undefined;
        if (value !== undefined) {
          const decoded = object(decode(value));
          requireSync(int(decoded.schemaVersion, 1, 2) && decoded.profileID === profile && decoded.domain === domain && string(decoded.data) &&
            (decoded.deletionEpoch == null || string(decoded.deletionEpoch)) && string(decoded.modifiedAt) && string(decoded.deviceID));
          envelope = { data: decoded.data, deletionEpoch: decoded.deletionEpoch == null ? undefined : decoded.deletionEpoch };
        }
        const group = this.groups.get(recordKey) ?? [];
        group.push({ stamp: revision, value, envelope }); this.groups.set(recordKey, group);
        if (writer === device) {
          requireSync(profile === ACCOUNT ? domain === PROFILE : allowed.includes(domain));
          ownRecords.push([recordKey, { ...item, stamp: revision, value }]);
        }
      }
      if (writer === device) this.own = { ...this.own, ...snapshot, records: Object.fromEntries(ownRecords) };
    }
    for (const group of this.groups.values()) group.sort((a, b) => compareStamp(a.stamp, b.stamp));
    this.epoch = this.groups.get(key(ACCOUNT, EPOCH))?.at(-1)?.envelope?.data;
    this.roster = profileRegisters(this.candidates(ACCOUNT, PROFILE));
    this.profiles = projectProfiles(this.roster).map(({ id, name, avatar, usesPrimaryAddons }) =>
      ({ id, name, avatar, inheritsAddons: Number(id) !== 1 && usesPrimaryAddons }));
  }
  get paused() { return this.candidates(ACCOUNT, RESET).length > 0; }
  managedConnection(id: string, provider: ManagedProvider): string | undefined {
    this.profile(id);
    requireSync(managedProviders.includes(provider));
    const value = this.commonRegisters(id).winners.get(connectionField(provider))?.value;
    connectionID(value, this.realmID);
    return value as string | undefined;
  }
  connectionPublication(id: string, provider: ManagedProvider, value: string, expected: string | undefined): Snapshot | null {
    return this.connectionRecord(id, provider, value, expected, false);
  }
  connectionBarrier(id: string, provider: ManagedProvider): Snapshot {
    const current = this.managedConnection(id, provider);
    return this.connectionRecord(id, provider, current, current, true)!;
  }
  private connectionRecord(id: string, provider: ManagedProvider, value: string | undefined, expected: string | undefined, barrier: boolean): Snapshot | null {
    if (this.paused) throw new Error('sync_reset');
    this.profile(id);
    requireSync(managedProviders.includes(provider));
    connectionID(value, this.realmID);
    requireSync(barrier || value === disconnected || !!connectionID(value, this.realmID));
    const current = this.managedConnection(id, provider);
    if (current === value && !barrier) return null; // A retry after a lost commit reply.
    requireSync(!barrier || current === value);
    if (current !== expected) throw new Error('connection_changed');
    const records = { ...this.own.records }, recordKey = key(id, COMMON);
    const existing = records[recordKey]?.value;
    const prior = existing ? object(decode(existing)) : undefined;
    const fields = { ...(prior && (prior.deletionEpoch ?? undefined) === this.epoch ? object(object(decode(prior.data)).fields) : {}) };
    const revision = this.commonRegisters(id).maximum + 1;
    requireSync(int(revision, 1));
    fields[connectionField(provider)] = { value, revision, deviceID: this.device };
    records[recordKey] = this.record(id, COMMON, { fields }, this.maximum + 1);
    return { ...this.own, records };
  }
  /** The winning (highest revision, then device) protected key register, still sealed. */
  protectedRegister(id: string, kind: ProtectedKind): ProtectedRegister | undefined {
    this.profile(id);
    const winner = this.commonRegisters(id).winners.get(protectedField(kind));
    return winner ? { value: winner.value as string, revision: winner.revision, deviceID: winner.deviceID } : undefined;
  }
  protectedKeys(id: string, root: Bytes) {
    this.profile(id);
    return new ProtectedKeys(root, this.realmID, id, this.epoch);
  }
  /** Add one protected key register to this writer's common document; every other field is carried over unchanged. */
  protectedKeyPublication(id: string, kind: ProtectedKind, register: ProtectedRegister): Snapshot {
    if (this.paused) throw new Error('sync_reset');
    this.profile(id);
    const records = { ...this.own.records }, recordKey = key(id, COMMON);
    const existing = records[recordKey]?.value;
    const prior = existing ? object(decode(existing)) : undefined;
    const fields = { ...(prior && (prior.deletionEpoch ?? undefined) === this.epoch ? object(object(decode(prior.data)).fields) : {}) };
    fields[protectedField(kind)] = { value: register.value, revision: register.revision, deviceID: register.deviceID };
    records[recordKey] = this.record(id, COMMON, { fields }, this.maximum + 1);
    return { ...this.own, records };
  }
  private candidates(profile: string, domain: string): Envelope[] {
    const group = this.groups.get(key(profile, domain)) ?? [];
    const barrier = group.findLastIndex(item => item.value === undefined);
    return group.slice(barrier + 1).flatMap(item => item.envelope &&
      (domain === EPOCH || domain === RESET || item.envelope.deletionEpoch === this.epoch) ? [item.envelope] : []);
  }
  private commonRegisters(id: string) {
    const winners = new Map<string, { value?: unknown; revision: number; deviceID: string }>();
    let maximum = 0;
    for (const candidate of this.candidates(id, COMMON)) {
      const fields = object(object(decode(candidate.data)).fields);
      for (const [name, raw] of Object.entries(fields)) {
        const field = object(raw);
        requireSync(int(field.revision) && typeof field.deviceID === 'string' && field.deviceID.length <= 128);
        maximum = Math.max(maximum, field.revision);
        const winner = winners.get(name);
        if (!winner || field.revision > winner.revision ||
          field.revision === winner.revision && compare(field.deviceID, winner.deviceID) > 0) {
          winners.set(name, { revision: field.revision, deviceID: field.deviceID, value: field.value ?? undefined });
        }
      }
    }
    return { winners, maximum };
  }
  private formatter(id: string): FormatterPack[] | null {
    try {
      const value = this.commonRegisters(id).winners.get(FORMATTER_FIELD)?.value;
      return value === undefined ? [] : readFormatter(value);
    } catch { return null; } // Unsupported settings cannot prevent editing Home or add-ons.
  }
  private preferences(id: string): { preferences: PreferenceSettings | null; unavailablePreferences: string[] } {
    try {
      const preferences: PreferenceSettings = {}, unavailablePreferences: string[] = [];
      const { winners } = this.commonRegisters(id), version = winners.get(skipSchemaField)?.value;
      const newerSkip = version !== undefined && version !== 1;
      for (const [name, field] of winners) {
        if (!isPreferenceField(name) || field.value === undefined || newerSkip && isSkipField(name)) continue;
        if (validPreferenceValue(name, field.value)) preferences[name] = field.value;
        else unavailablePreferences.push(name);
      }
      if (newerSkip) unavailablePreferences.push(...skipFields.map(field => field.id));
      return { preferences, unavailablePreferences };
    } catch { return { preferences: null, unavailablePreferences: [] }; }
  }
  private profile(id: string) {
    const profile = this.profiles.find(item => item.id === id);
    requireSync(profile); return profile;
  }
  async unlockConfiguredAddons(master: Bytes) {
    const cipher = new ConfiguredAddonCipher(master, this.realmID, this.epoch);
    await Promise.all(this.profiles.filter(profile => !profile.inheritsAddons).map(async ({ id }) => {
      try {
        const fields = [...this.commonRegisters(id).winners].filter(([name]) => name.startsWith(configuredPrefix));
        requireSync(fields.length <= configuredMaxRecords);
        const rows = (await Promise.all(fields.map(([name, register]) => {
          const hash = name.slice(configuredPrefix.length);
          requireSync(/^[a-f0-9]{64}$/.test(hash));
          return register.value === undefined ? undefined : cipher.open(id, hash, register);
        }))).filter((row): row is ConfiguredAddon => !!row);
        requireSync(rows.length <= 100);
        this.configured.set(id, rows.sort((a, b) => a.order - b.order || compare(a.id, b.id)));
      } catch { this.configured.set(id, null); }
    }));
  }
  private addonSlot(profile: SyncProfile) {
    return profile.inheritsAddons ? this.profiles.find(row => Number(row.id) === 1)?.id : profile.id;
  }
  private addonDraft(profile: SyncProfile): Pick<SyncProfileDraft, 'addons' | 'addonStatus'> {
    const slot = this.addonSlot(profile);
    const record = slot ? this.candidates(slot, ADDONS).at(-1) : undefined;
    if (!record) return { addons: [], addonStatus: 'missing' };
    try {
      const { addons, complete } = projectSyncAddons(decode(record.data));
      return { addons, addonStatus: complete ? 'ready' : 'incomplete' };
    } catch {
      return { addons: [], addonStatus: 'incomplete' };
    }
  }
  get unusedProfileSlot() {
    // Native deletion can leave a device with pending cleanup of that slot.
    // Leave reuse to Luma, and never attach a new profile to orphaned data.
    const used = new Set([...this.roster.keys()].filter(isProfileSlot).map(Number));
    for (const record of this.groups.keys()) {
      const id = record.slice(PREFIX.length + 1).split('.')[0];
      if (isProfileSlot(id)) used.add(Number(id));
    }
    if (!this.profiles.some(row => Number(row.id) === 1)) return this.profiles.length === 0 && !used.has(1) ? '1' : undefined;
    return profileSlots.find(slot => !used.has(Number(slot)));
  }
  publicAddonCount(id: string) { return this.addonDraft(this.profile(id)).addons.length; }
  profilePublication(edit: ProfileEdit): { id: string; snapshot: Snapshot | null } {
    if (this.paused) throw new Error('sync_reset');
    const existing = 'id' in edit ? this.profile(edit.id) : undefined;
    const id = existing?.id ?? this.unusedProfileSlot;
    if (!id) throw new Error('profile_no_slot');
    const name = editedProfileName(edit.name, existing?.name);
    const avatar = editedProfileAvatar(edit.avatar, existing?.avatar);
    const roster = new Map(this.roster), fields = new Map(roster.get(id));
    let profileClock = 0, counter = this.maximum;
    for (const entry of roster.values()) for (const field of entry.values()) profileClock = Math.max(profileClock, field.stamp.counter);
    const set = (key: string, value: string | boolean) => fields.set(key, { value, stamp: nextStamp(profileClock + 1, this.device) });
    if (existing && 'id' in edit) {
      if (name !== existing.name) set('name', name);
      if (avatar !== existing.avatar) set('avatar', avatar);
      if (Number(id) !== 1 && edit.inheritsAddons !== existing.inheritsAddons) set('addons', edit.inheritsAddons);
      if ([...fields].every(([key, field]) => this.roster.get(id)?.get(key) === field)) return { id, snapshot: null };
    } else {
      for (const [key, value] of Object.entries(profileValues(newProfile(id, name, avatar)))) set(key, value);
    }
    roster.set(id, fields);
    const records = { ...this.own.records };
    const put = (slot: string, domain: string, data: unknown) => {
      records[key(slot, domain)] = this.record(slot, domain, data, ++counter);
    };
    put(ACCOUNT, PROFILE, { profiles: projectProfiles(roster), revisions: Object.fromEntries([...roster].map(([id, fields]) => [id, { fields: Object.fromEntries(fields) }])) });
    if (!existing) {
      const source = 'copyPublicFrom' in edit && edit.copyPublicFrom;
      const addons = source ? this.addonDraft(this.profile(source)).addons : [];
      if (source && !addons.length) throw new Error('profile_template_unavailable');
      // Only fields in the portable public reference are eligible for a copy.
      put(id, ADDONS, addons.map(({ id, manifestURL, name, enabled }, order) => ({ id, manifestURL, name, enabled, order })));
    }
    return { id, snapshot: { ...this.own, records } };
  }
  /**
   * Delete a synced secondary profile exactly as a native client publishes it: the slot's "exists"
   * register becomes false with the next list-wide logical stamp (AppleProfileSyncMerge.reconcile),
   * and each profile domain that holds a value is cleared with a value-less record carrying the next
   * snapshot counter (AppleNativeCloudSync.deleteProfileDomains, ConfigurationSyncBackend.stage).
   * Other fields of the slot stay as they are. Grants returned here must be revoked after publishing.
   */
  profileDeletion(id: string): { snapshot: Snapshot; grants: { provider: ManagedProvider; id: string }[] } {
    if (this.paused) throw new Error('sync_reset');
    this.profile(id);
    // ProfileSlotPolicy.permitsDeletion: never the primary slot, never the last profile.
    requireSync(Number(id) !== 1 && this.profiles.length > 1 && this.profiles.some(row => Number(row.id) === 1));
    const grants: { provider: ManagedProvider; id: string }[] = [];
    for (const provider of managedProviders) {
      try {
        const grant = connectionID(this.managedConnection(id, provider), this.realmID);
        if (grant) grants.push({ provider, id: grant });
      } catch { /* A binding for another server or an unreadable value is not ours to revoke. */ }
    }
    const roster = new Map(this.roster), fields = new Map(roster.get(id));
    let profileClock = 0, counter = this.maximum;
    for (const entry of roster.values()) for (const field of entry.values()) profileClock = Math.max(profileClock, field.stamp.counter);
    fields.set('exists', { value: false, stamp: nextStamp(profileClock + 1, this.device) });
    roster.set(id, fields);
    const records = { ...this.own.records };
    records[key(ACCOUNT, PROFILE)] = this.record(ACCOUNT, PROFILE, {
      profiles: projectProfiles(roster), revisions: Object.fromEntries([...roster].map(([slot, row]) => [slot, { fields: Object.fromEntries(row) }])),
    }, ++counter);
    for (const domain of profileDomains) {
      if (this.candidates(id, domain).length) records[key(id, domain)] = { stamp: nextStamp(++counter, this.device) };
    }
    return { snapshot: { ...this.own, records }, grants };
  }
  private record(id: string, domain: string, data: unknown, counter: number): RecordEntry {
    return { stamp: nextStamp(counter, this.device), value: encode({
      schemaVersion: 2, profileID: id, domain, modifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), deviceID: this.device,
      data: encode(data), deletionEpoch: this.epoch,
    }) };
  }
  draft(id: string): SyncProfileDraft {
    const profile = this.profile(id);
    const collections = [...readRows(this.candidates(id, COLLECTIONS)).entries.values()].flatMap(entry => entry.row ? [object(decode(entry.row)) as Hub] : []);
    validateDocument({ collections });
    const home: SyncHomeRow[] = [...readContent(this.candidates(id, HOME))].map(([id, entry]) => ({
      id: `${entry.source.collectionID ? 'collection' : 'catalog'}:${id}`, kind: entry.source.collectionID ? 'collection' : 'catalog',
      source: entry.source, title: entry.title.value, enabled: entry.enabled.value, position: entry.position.value,
    }));
    const widgets = this.candidates(id, WIDGETS);
    for (const entry of readRows(widgets).entries.values()) if (entry.row) {
      const widget = readWidget(decode(entry.row));
      home.push({ id: `widget:${widget.id}`, kind: 'widget', source: widget.source, title: widget.title, enabled: widget.enabled, position: widget.position, widget });
    }
    requireSync(home.filter(row => row.kind === 'widget').length <= MAX_SYNC_HOME_WIDGETS);
    const configured = this.configured.get(this.addonSlot(profile) ?? '');
    return { home: home.sort((a, b) => a.position - b.position || compare(a.id, b.id)), collections: collections.sort((a, b) => compare(a.id, b.id)), ...this.addonDraft(profile),
      configuredAddons: configured?.map(row => ({ ...row })), configuredUnavailable: configured === null, formatter: this.formatter(id), ...this.preferences(id) };
  }
  private rosterInputs() {
    return [...new Set(this.candidates(ACCOUNT, PROFILE).map(entry => entry.data))].sort(compare);
  }
  draftBaseline(id: string): DraftBaseline {
    let settings: DraftBaseline['settings'] = null;
    try { settings = Object.fromEntries([...this.commonRegisters(id).winners].filter(([name]) => name === FORMATTER_FIELD || isPreferenceField(name))); }
    catch { /* Other sections can still be edited and restored. */ }
    return {
      realm: this.realmID, epoch: this.epoch, roster: this.rosterInputs(), draft: this.draft(id), settings,
    };
  }
  canReviewDraft(id: string, base: DraftBaseline) {
    return !this.paused && this.epoch === base.epoch && this.realmID === base.realm && this.profiles.some(row => row.id === id);
  }
  matchesDraft(id: string, draft: SyncProfileDraft) { return equal(this.draft(id), draft); }
  /** Use the same conflict checks after reauthentication and a concurrent save. */
  rebaseDraft(id: string, draft: SyncProfileDraft, latest: SyncDocuments): SyncProfileDraft | null {
    return this.paused ? null : latest.restoreDraft(id, this.draftBaseline(id), draft);
  }
  restoreDraft(id: string, base: DraftBaseline, draft: SyncProfileDraft): SyncProfileDraft | null {
    if (!this.canReviewDraft(id, base) || !equal(base.roster, this.rosterInputs())) return null;
    const before = base.draft, current = this.draft(id);
    const editsHome = !equal(before.home, draft.home) || !equal(before.collections, draft.collections);
    const editsAddons = !equal(before.addons, draft.addons);
    const editsConfigured = !equal(before.configuredAddons, draft.configuredAddons);
    const editsFormatter = !equal(before.formatter, draft.formatter);
    // Home references collections. Do not separate them during conflict checks.
    if (editsHome && (!equal(before.home, current.home) || !equal(before.collections, current.collections))) return null;
    if (editsAddons && (before.addonStatus !== current.addonStatus || current.addonStatus === 'incomplete' || !equal(before.addons, current.addons))) return null;
    if (editsConfigured && (current.configuredUnavailable || !equal(before.configuredAddons, current.configuredAddons))) return null;
    const preferenceEdits = Object.keys(draft.preferences ?? {}).filter(name => isPreferenceField(name) && draft.preferences?.[name] !== before.preferences?.[name]);
    if (preferenceEdits.length && !current.preferences || preferenceEdits.some(name => current.unavailablePreferences.includes(name))) return null;
    if (editsFormatter || preferenceEdits.length) {
      if (!base.settings || editsFormatter && !current.formatter) return null;
      const settings = base.settings;
      const remote = this.commonRegisters(id).winners;
      if ((editsFormatter && !equal(settings[FORMATTER_FIELD], remote.get(FORMATTER_FIELD))) ||
          preferenceEdits.some(name => !equal(settings[name], remote.get(name)))) return null;
    }
    const preferences = preferenceEdits.length ? { ...current.preferences, ...Object.fromEntries(
      preferenceEdits.map(name => [name, draft.preferences?.[name]])) } : current.preferences;
    return { ...current, home: editsHome ? draft.home : current.home, collections: editsHome ? draft.collections : current.collections,
      addons: editsAddons ? draft.addons : current.addons, configuredAddons: editsConfigured ? draft.configuredAddons : current.configuredAddons,
      formatter: editsFormatter ? draft.formatter : current.formatter, preferences };
  }
  async encryptedPublication(id: string, draft: SyncProfileDraft, master: Bytes): Promise<Snapshot | null> {
    const before = this.draft(id), entries = draft.configuredAddons;
    if (equal(before.configuredAddons, entries)) return this.publication(id, draft);
    requireSync(!this.profile(id).inheritsAddons && before.configuredAddons && entries && entries.length <= 100);
    const ids = new Set(entries.map(row => row.id));
    requireSync(ids.size === entries.length);
    const { winners, maximum } = this.commonRegisters(id), revision = maximum + 1;
    requireSync(int(revision) && new Set([...ids, ...[...winners.keys()].filter(key => key.startsWith(configuredPrefix))
      .map(key => key.slice(configuredPrefix.length))]).size <= configuredMaxRecords);
    const previous = new Map(before.configuredAddons.map(row => [row.id, row]));
    const changes = new Map<string, string | undefined>();
    const cipher = new ConfiguredAddonCipher(master, this.realmID, this.epoch);
    await Promise.all(entries.map(async (row, order) => {
      const entry = { ...row, order };
      if (!equal(previous.get(row.id), entry)) changes.set(configuredPrefix + row.id, await cipher.seal(id, entry, revision, this.device));
    }));
    for (const key of previous.keys()) if (!ids.has(key)) changes.set(configuredPrefix + key, undefined);
    return this.publication(id, draft, changes);
  }
  publication(id: string, draft: SyncProfileDraft, configured?: ReadonlyMap<string, string | undefined>): Snapshot | null {
    if (this.paused) throw new Error('sync_reset');
    const profile = this.profile(id), before = this.draft(id);
    requireSync(equal(before.configuredAddons, draft.configuredAddons) || configured);
    const records = { ...this.own.records };
    let maximum = this.maximum, changed = false;
    const put = (domain: string, data: unknown) => {
      records[key(id, domain)] = this.record(id, domain, data, ++maximum);
      changed = true;
    };
    const editsFormatter = !equal(before.formatter, draft.formatter), editsPreferences = !equal(before.preferences, draft.preferences);
    if (editsFormatter || editsPreferences || configured?.size) {
      const { maximum } = this.commonRegisters(id);
      requireSync(int(maximum + 1));
      const existing = records[key(id, COMMON)]?.value;
      // Retain previous editor fields. Native-only registers stay with their writers.
      const prior = existing ? object(decode(existing)) : undefined;
      const fields = { ...(prior && (prior.deletionEpoch ?? undefined) === this.epoch ? object(object(decode(prior.data)).fields) : {}) };
      const set = (name: string, value: unknown) => { fields[name] = { value, revision: maximum + 1, deviceID: this.device }; };
      if (editsFormatter) {
        requireSync(before.formatter && draft.formatter);
        set(FORMATTER_FIELD, formatterValue(draft.formatter));
      }
      if (editsPreferences) {
        requireSync(before.preferences && draft.preferences);
        for (const [name, value] of Object.entries(draft.preferences)) {
          requireSync(validPreferenceValue(name, value) && !before.unavailablePreferences.includes(name));
          if (before.preferences[name] !== value) set(name, value ?? undefined);
        }
      }
      if (configured) for (const [name, value] of configured) set(name, value);
      put(COMMON, { fields });
    }
    if (!equal(before.addons, draft.addons)) {
      requireSync(!profile.inheritsAddons);
      if (before.addonStatus === 'incomplete') throw new Error('addons_incomplete');
      const addons = readSyncAddons(draft.addons.map((entry, order) => ({ ...entry, order })));
      requireSync(addons.length === draft.addons.length);
      put(ADDONS, addons);
    }
    const oldHome = new Map(before.home.map(row => [row.id, row]));
    const newHome = new Map(draft.home.map(row => [row.id, row]));
    requireSync(newHome.size === draft.home.length && draft.home.filter(row => row.kind === 'widget').length <= MAX_SYNC_HOME_WIDGETS);
    const content = readContent(this.candidates(id, HOME));
    let contentClock = [...content.values()].reduce((max, entry) => Math.max(max, entry.title.stamp.counter, entry.enabled.stamp.counter, entry.position.stamp.counter), 0);
    let homeChanged = false;
    for (const row of draft.home.filter(row => row.kind !== 'widget')) {
      const source = readSource(row.source), identity = sourceID(source);
      const old = oldHome.get(row.id), entry = content.get(identity);
      requireSync(row.kind === (source.collectionID ? 'collection' : 'catalog') && row.id === `${row.kind}:${identity}` && int(row.position));
      if (source.addonID !== old?.source.addonID) verifyAddonRoute(source.addonID);
      if (old && equal(row, old)) continue;
      const stamp = nextStamp(++contentClock, this.device);
      content.set(identity, { ...entry, source,
        title: entry && old?.title === row.title ? entry.title : { value: row.title, stamp },
        enabled: entry && old?.enabled === row.enabled ? entry.enabled : { value: row.enabled, stamp },
        position: entry && old?.position === row.position ? entry.position : { value: row.position, stamp },
      });
      homeChanged = true;
    }
    for (const row of before.home) if (row.kind !== 'widget' && !newHome.has(row.id)) {
      const identity = sourceID(row.source), entry = content.get(identity)!;
      if (!entry.enabled.value) continue;
      content.set(identity, { ...entry, enabled: { value: false, stamp: nextStamp(++contentClock, this.device) } }); homeChanged = true;
    }
    if (homeChanged) put(HOME, { version: 1, entries: Object.fromEntries(content) });
    const widgets = draft.home.filter(row => row.kind === 'widget').map(row => {
      const id = row.id.slice('widget:'.length);
      requireSync(row.id.startsWith('widget:'));
      if (![row.source.addonID, row.source.mediaType, row.source.catalogID].every(value => value.trim())) throw new Error('widget_source_missing');
      if (row.source.addonID !== oldHome.get(row.id)?.source.addonID) verifyAddonRoute(row.source.addonID);
      return readWidget({ ...row.widget, id, source: row.source, title: row.title, enabled: row.enabled, position: row.position });
    });
    const oldWidgets = before.home.filter(row => row.kind === 'widget').map(row => row.widget!);
    this.patchRows(id, WIDGETS, oldWidgets, widgets, put);
    validateDocument({ collections: draft.collections });
    const previousRoutes = addonRoutes(before.collections);
    for (const route of addonRoutes(draft.collections)) if (!previousRoutes.has(route)) verifyAddonRoute(route);
    this.patchRows(id, COLLECTIONS, before.collections, draft.collections, put);
    return changed ? { ...this.own, records } : null;
  }
  private patchRows(profile: string, domain: string, baseline: JSONObject[], draft: JSONObject[], put: (domain: string, value: unknown) => void) {
    const before = new Map(baseline.map(row => [String(row.id), row]));
    const after = new Map(draft.map(row => [String(row.id), row]));
    const current = readRows(this.candidates(profile, domain));
    let maximum = [...current.entries.values()].reduce((max, entry) => Math.max(max, entry.stamp.counter), 0), changed = false;
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id), row = after.get(id);
      if (equal(old, row)) continue;
      const existing = current.entries.get(id);
      // A new instance may not silently revive a retained deletion.
      requireSync(!row || !existing || existing.row);
      current.entries.set(id, { ...existing, row: row ? encode(row) : undefined, seeds: undefined, stamp: nextStamp(++maximum, this.device) });
      changed = true;
    }
    if (changed) put(domain, { version: 2, entries: Object.fromEntries(current.entries), migratedPlatforms: [...current.migratedPlatforms].sort(compare) });
  }
}
