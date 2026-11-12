import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { publicManifestURL, readSyncAddons } from './addons';
import { collectionHomeID, collectionSource, SyncDocuments } from './documents';
import { readHomeFile, writeVisibleHome } from './home-files';
import { MAX_HOME_FILE_ROWS, MAX_SYNC_HOME_WIDGETS } from '../luma-home-limits';
import { libraryOrderField, libraryShelfOrder, writeLibraryOrder } from './library-layout';
import { libraryRowField, makeLibraryRow, readLibraryRow } from './library-row';
import { unwrapPasskeyMaster } from './passkey';
import { base64, derive, join, json, lzfseDecoder, open, packChunk, parse, seal, unbase64, unpackChunk, unwrapSnapshot, utf8, wrapSnapshot } from './wire';

const device = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const browser = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const realm = 'fixture-realm';
const prefix = 'apple.kvs.sync.v2';
const wire = (value: unknown) => base64(json(value));
const data = (value: string) => parse(unbase64(value, 2_000_000));
const stamp = (counter: number, deviceID = device) => ({ counter, device: deviceID });
const env = (profileID: string, domain: string, payload: unknown, count: number, writer = device, deletionEpoch?: string) => ({
  stamp: stamp(count, writer), value: wire({ profileID, domain, schemaVersion: 2, modifiedAt: '2026-01-01T00:00:00Z', deviceID: writer, data: wire(payload), deletionEpoch }),
});
const profile = (id: string, name: string, usesPrimaryAddons = false) => ({ id, name, usesPrimaryAddons,
  avatar: '', isAdmin: id === '1', isPinProtected: false, usesPrimaryPlugins: true });
const profiles = { profiles: [profile('1', 'Primary', true), profile('2', 'Shared', true)] };
const addon = { id: 'old-identity', name: 'Catalogs', manifestURL: 'https://catalog.example.org/manifest.json', enabled: true, order: 5, future: { x: true } };
const widget = { id: 'widget-one', title: 'Movies', source: { addonID: 'org.movies', mediaType: 'movie', catalogID: 'catalog-a', collectionID: '' }, enabled: true, position: 0, extras: {}, future: { preserved: true } };
const hub = { id: 'hub-one', title: 'Genres', folders: [{ id: 'folder', title: 'Action', sections: [{ id: 'section', title: 'Browse', folders: [{ id: 'nested', title: 'Deep', unknown: true }] }] }] };
const profileKey = `${prefix}.__account__.profile`;
const widgetKey = `${prefix}.1.homeWidgets.v1`;
const collectionsKey = `${prefix}.1.collections.v2`;
const addonKey = `${prefix}.1.addons`;
const unrelated = `${prefix}.1.local-library.v1`;
const rows = (entries: object) => ({ version: 2, entries, migratedPlatforms: ['ios', 'tvos'] });

test('account changes publish only a native-compatible profile reference and preserve other writers', () => {
  const space = `luma-sync-v1.${'a'.repeat(64)}`, common = `${prefix}.1.commonSettings.v1`;
  const register = (value: unknown, revision: number, deviceID = device) => ({ value, revision, deviceID });
  const source = { ...snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [common]: env('1', 'commonSettings.v1', { fields: {
      'integrations.traktConnection': register(`${space}:${device}`, 20),
      'integrations.simklConnection': register(`${space}:${second}`, 21),
      'nativeProtected.metadata.v1.tmdb': register('opaque private key', 22),
      'library.row': register('opaque private list', 23),
    } }, 2),
  }), realm: space };
  const own = { ...snapshot(browser, { [common]: env('1', 'commonSettings.v1', { fields: {
    'appearance.oled': register(true, 24, browser), futureField: register('keep me', 25, browser),
  } }, 5, browser) }), realm: space };
  const docs = new SyncDocuments(loaded([[device, source], [browser, own]]), space, browser);
  assert.equal(docs.managedConnection('1', 'trakt'), `${space}:${device}`);
  const saved = docs.connectionPublication('1', 'trakt', `${space}:${second}`, `${space}:${device}`)!;
  const fields = (payload(saved.records, common) as { fields: Record<string, unknown> }).fields;
  assert.deepEqual(fields, {
    'appearance.oled': register(true, 24, browser), futureField: register('keep me', 25, browser),
    'integrations.traktConnection': register(`${space}:${second}`, 26, browser),
  });
  const merged = new SyncDocuments(loaded([[device, source], [browser, saved]]), space, browser);
  assert.equal(merged.managedConnection('1', 'trakt'), `${space}:${second}`);
  assert.equal(merged.managedConnection('1', 'simkl'), `${space}:${second}`);
  assert.equal(merged.connectionPublication('1', 'trakt', `${space}:${second}`, `${space}:${device}`), null);
  const barrier = merged.connectionBarrier('1', 'trakt');
  assert.equal(new SyncDocuments(loaded([[device, source], [browser, barrier]]), space, browser).managedConnection('1', 'trakt'), `${space}:${second}`);
  assert((payload(barrier.records, common) as { fields: Record<string, { revision: number }> }).fields['integrations.traktConnection'].revision > 26);
  assert.throws(() => merged.connectionPublication('1', 'trakt', 'disconnected', `${space}:${device}`), /connection_changed/);
  const removed = merged.connectionPublication('1', 'trakt', 'disconnected', `${space}:${second}`)!;
  assert.equal(new SyncDocuments(loaded([[device, source], [browser, removed]]), space, browser).managedConnection('1', 'trakt'), 'disconnected');
  assert.throws(() => docs.connectionPublication('1', 'trakt', `luma-sync-v1.${'b'.repeat(64)}:${device}`, undefined));
  assert.throws(() => docs.connectionPublication('6', 'trakt', `${space}:${device}`, undefined));
});
function snapshot(device: string, records: Record<string, unknown>) { return { schema: 1, realm, device, platform: 'ios', records }; }
function loaded(snapshots: [string, unknown][]) { return { cursor: 'fixture', ownVersion: 0, modern: true, snapshots: new Map(snapshots) }; }
function payload(records: Record<string, { value?: string }>, key: string) {
  return data((data(records[key].value!) as { data: string }).data);
}

test('profile creation publishes a native roster and copies only the effective public add-on list', () => {
  const privateAddon = { ...addon, id: 'configured', manifestURL: 'https://catalog.example.org/my-private-key/manifest.json' };
  const disabled = { ...addon, id: 'off', enabled: false, order: 6, manifestURL: 'https://off.example.org/manifest.json' };
  const source = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1),
    [addonKey]: env('1', 'addons', [disabled, privateAddon, addon], 2),
    [`${prefix}.3.local-library.v1`]: env('3', 'local-library.v1', { opaque: true }, 3) });
  const before = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const { id, snapshot: saved } = before.profilePublication({ name: '  Family 👩🏻‍🚀  ', avatar: 'artwork:finn', copyPublicFrom: '2' });
  assert.equal(id, '4'); // An orphaned library must never be assigned to a new profile.
  assert(saved);
  assert.deepEqual(Object.keys(saved.records), [profileKey, `${prefix}.4.addons`]);
  const roster = payload(saved.records, profileKey) as { profiles: unknown[]; revisions: Record<string, { fields: Record<string, unknown> }> };
  assert.deepEqual(roster.profiles[2], { id, name: 'Family 👩🏻‍🚀', avatar: 'artwork:finn', isAdmin: false,
    isPinProtected: false, usesPrimaryAddons: false, usesPrimaryPlugins: true });
  assert.deepEqual(roster.revisions['1'].fields.name, { value: 'Primary', stamp: stamp(0, '') });
  const after = new SyncDocuments(loaded([[device, source], [browser, saved]]), realm, browser);
  assert.deepEqual(after.draft(id).addons.map(({ id, enabled, order, future }) => [id, enabled, order, future]),
    [['old-identity', true, 0, undefined], ['off', false, 1, undefined]]);
  assert.throws(() => before.profilePublication({ name: '👩🏻‍🚀'.repeat(81), avatar: '' }), /profile_name_length/);
  assert.doesNotThrow(() => before.profilePublication({ name: '👩🏻‍🚀'.repeat(80), avatar: '' }));
  assert.throws(() => before.profilePublication({ name: 'New', avatar: 'https://user:pass@example.org/avatar.png' }), /profile_avatar_invalid/);
});

test('editing profile metadata preserves unknown registers, legacy names, local avatar and deletion history', () => {
  const preservedName = '  ' + 'x'.repeat(81), avatar = 'luma-profile-avatar://unavailable-in-web';
  const fields = { exists: true, name: preservedName, avatar, pin: true, admin: false, addons: false, plugins: false, future: 'opaque' };
  const revisions = { '2': { fields: Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, { value, stamp: stamp(15) }])) },
    '3': { fields: { exists: { value: false, stamp: stamp(16) } } } };
  const source = snapshot(device, { [profileKey]: env('__account__', 'profile', { profiles: [profiles.profiles[0],
    { ...profile('2', preservedName), avatar, isPinProtected: true, usesPrimaryPlugins: false }] }, 1) });
  const update = snapshot(second, { [profileKey]: env('__account__', 'profile', { profiles: [], revisions }, 2, second) });
  const documents = new SyncDocuments(loaded([[device, source], [second, update]]), realm, browser);
  assert.equal(documents.unusedProfileSlot, '4');
  assert.equal(documents.profilePublication({ id: '2', name: preservedName, avatar, inheritsAddons: false }).snapshot, null);
  const { snapshot: saved } = documents.profilePublication({ id: '2', name: preservedName, avatar, inheritsAddons: true });
  assert(saved);
  const roster = payload(saved.records, profileKey) as { revisions: Record<string, { fields: Record<string, unknown> }> };
  for (const [field, value] of Object.entries(fields)) assert.deepEqual(roster.revisions['2'].fields[field],
    field === 'addons' ? { value: true, stamp: stamp(17, browser) } : { value, stamp: stamp(15) });
  assert.deepEqual(roster.revisions['3'], revisions['3']);
  const after = new SyncDocuments(loaded([[device, source], [second, update], [browser, saved]]), realm, browser);
  assert.deepEqual(after.profiles[1], { id: '2', name: preservedName, avatar, inheritsAddons: true });
});

test('public add-on policy rejects private URLs and preserves the native reference and unknown fields', () => {
  for (const url of ['https://u:p@a.example.org/manifest.json', 'https://a.example.org/config/manifest.json', 'https://a.example.org/manifest.json?',
    'https://a.example.org/manifest.json#', 'http://a.example.org/manifest.json', 'https://192.168.1.1/manifest.json',
    'https://a.local./manifest.json', 'https://localhost/manifest.json', 'https://a.example.org:8443/manifest.json', 'https://a.example.org/foo/../manifest.json']) {
    assert.equal(publicManifestURL(url), null);
  }
  assert.equal(publicManifestURL('https://a.example.org:443/manifest.json'), 'https://a.example.org/manifest.json');
  assert.deepEqual(readSyncAddons([addon]), [addon]);
  assert.throws(() => readSyncAddons([{ ...addon, manifestURL: 'https://home.local/manifest.json' }]));
});

test('the passkey envelope authenticates the origin, space and credential and returns only the content root', async () => {
  const prf = new Uint8Array(32).fill(1), salt = new Uint8Array(32).fill(2), master = new Uint8Array(32).fill(3), owner = new Uint8Array(32).fill(4);
  const origin = 'https://sync.example.test', credential = 'aWQ';
  const aad = utf8.encode(`luma-sync-passkey-wrap-v1:${origin}:${device}:${credential}`);
  const key = await derive(prf, salt, aad);
  const envelope = base64(await seal(join([master, owner]), key, aad), true);
  assert.deepEqual(await unwrapPasskeyMaster(envelope, prf, salt, origin, device, credential), master);
  await assert.rejects(unwrapPasskeyMaster(envelope, prf, salt, 'https://other.example.test', device, credential));
  await assert.rejects(unwrapPasskeyMaster(envelope, prf, salt, origin, second, credential));
  await assert.rejects(unwrapPasskeyMaster(envelope, prf, salt, origin, device, 'aWQx'));
  assert.deepEqual(await open(unbase64(envelope, 92, 92, true), key, aad), join([master, owner]));
});

test('the browser reads Apple Compression frames and reconstructs nested escaped base64 exactly', async () => {
  const binary = await readFile(new URL('../../../public/sync-assets/lzfse.wasm', import.meta.url));
  const decoder = await lzfseDecoder(new Uint8Array(binary).buffer);
  const compressed = new Uint8Array(await readFile(new URL('../../../test/fixtures/luma-sync/apple-lzfse.bin', import.meta.url)));
  const plain = utf8.encode('Luma Sync · Apple Compression fixture\n'.repeat(2048));
  const frame = new Uint8Array(13 + compressed.length);
  frame.set(utf8.encode('LSC2')); const size = new DataView(frame.buffer);
  size.setUint32(4, plain.length); size.setUint32(8, compressed.length); frame[12] = 1; frame.set(compressed, 13);
  assert.deepEqual(unpackChunk(frame, plain.length, decoder), plain);
  assert.deepEqual(unpackChunk(packChunk(plain), plain.length, decoder), plain);
  assert.throws(() => decoder(join([compressed, Uint8Array.of(0)]), plain.length));
  assert.throws(() => decoder(compressed, plain.length - 1));
  const nested = wrapSnapshot(Uint8Array.of(255, 255, 255));
  const transformed = wrapSnapshot(nested); transformed[4] = 2;
  assert.deepEqual(unwrapSnapshot(transformed, 8), utf8.encode('\\/\\/\\/\\/'));
  assert.throws(() => unwrapSnapshot(transformed, 7));
});

test('browser writes only changed domains, retains nested/unknown fields and does not edit inherited add-ons', () => {
  const source = snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [widgetKey]: env('1', 'homeWidgets.v1', rows({ [widget.id]: { stamp: stamp(1), row: wire(widget) } }), 2),
    [collectionsKey]: env('1', 'collections.v2', rows({ [hub.id]: { stamp: stamp(5), row: wire(hub) } }), 3),
    [addonKey]: env('1', 'addons', [addon], 4),
    [unrelated]: env('1', 'local-library.v1', { opaque: true }, 5),
  });
  const documents = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = documents.draft('1');
  assert.equal(documents.publication('1', draft), null);
  assert.deepEqual(documents.draft('2').addons, [addon]);
  assert.throws(() => documents.publication('2', { ...documents.draft('2'), addons: [] }));
  draft.home[0].title = 'New widget title';
  draft.collections[0].title = 'New hub title';
  draft.addons[0].enabled = false;
  const publication = documents.publication('1', draft)!;
  assert.deepEqual(Object.keys(publication.records).sort(), [widgetKey, collectionsKey, addonKey].sort());
  const applied = new SyncDocuments(loaded([[device, source], [browser, publication]]), realm, browser).draft('1');
  assert.equal(applied.home[0].title, 'New widget title');
  assert.deepEqual(applied.home[0].widget?.future, { preserved: true });
  assert.deepEqual(applied.collections[0].folders, hub.folders);
  assert.deepEqual(applied.addons[0], { ...addon, enabled: false, order: 0 });
});

test('an incompatible add-on cannot hide public references or block Home editing, including in an inheriting profile', () => {
  const incompatible = { ...addon, manifestURL: 'https://media.local./manifest.json' };
  const source = snapshot(device, {
    [profileKey]: env('__account__', 'profile', { profiles: [...profiles.profiles, profile('3', 'Own list'), profile('4', 'New')] }, 1),
    [addonKey]: env('1', 'addons', [incompatible, addon], 2),
    [`${prefix}.3.addons`]: env('3', 'addons', [], 3),
    [widgetKey]: env('1', 'homeWidgets.v1', rows({ [widget.id]: { stamp: stamp(1), row: wire(widget) } }), 4),
  });
  const documents = new SyncDocuments(loaded([[device, source]]), realm, browser);
  for (const id of ['1', '2']) {
    const draft = documents.draft(id);
    assert.equal(draft.addonStatus, 'incomplete');
    assert.deepEqual(draft.addons, [addon]);
  }
  assert.equal(documents.draft('3').addonStatus, 'ready');
  assert.equal(documents.draft('4').addonStatus, 'missing');
  const draft = documents.draft('1');
  draft.home[0].title = 'Public catalogs';
  assert.deepEqual(Object.keys(documents.publication('1', draft)!.records), [widgetKey]);
  assert.throws(() => documents.publication('1', { ...draft, addons: [] }), /addons_incomplete/);
});

test('a Jellyfin widget reference can round-trip through a Home file and sync without a server URL', () => {
  const bridge = 'luma-jellyfin://12de3505-c9bf-4703-9a83-c97aaa5b1034/manifest.json';
  const documents = new SyncDocuments(loaded([[device, snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
  })]]), realm, browser);
  const draft = documents.draft('1');
  draft.home = [{ kind: 'widget', id: 'widget:jellyfin', title: 'Movies', enabled: true, position: 0,
    source: { addonID: bridge, catalogID: 'jf.folder.123', mediaType: 'movie', collectionID: '' } }];
  const file = readHomeFile(JSON.parse(writeVisibleHome(draft)))!;
  assert.deepEqual(file.home[0].source, draft.home[0].source);
  const publication = documents.publication('1', { ...draft, ...file });
  assert.deepEqual(Object.keys(publication!.records), [widgetKey]);
  file.home[0].source.addonID = `${bridge}?token=example`;
  assert.throws(() => documents.publication('1', { ...draft, ...file }), /private_addon_route/);
  file.home[0].source.addonID = 'https://jellyfin.example.org/Users/user/Items';
  assert.throws(() => writeVisibleHome({ ...draft, ...file }), /private or configured/);
});

test('collection additions produce actual Home registers; explicit widget deletion survives old snapshots', () => {
  const initial = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1),
    [widgetKey]: env('1', 'homeWidgets.v1', rows({ [widget.id]: { stamp: stamp(9), row: wire(widget) } }), 2) });
  const documents = new SyncDocuments(loaded([[device, initial]]), realm, browser);
  const draft = documents.draft('1');
  draft.collections.push(hub);
  draft.home = [{ kind: 'collection', id: collectionHomeID(hub.id), source: collectionSource(hub.id), enabled: true, position: 0, title: '' }];
  const publication = documents.publication('1', draft)!;
  const patched = payload(publication.records, widgetKey) as { entries: Record<string, { row?: string; stamp: { counter: number } }> };
  assert.equal(patched.entries[widget.id].row, undefined);
  assert.equal(patched.entries[widget.id].stamp.counter, 10);
  const next = new SyncDocuments(loaded([[device, initial], [browser, publication]]), realm, browser).draft('1');
  assert.deepEqual(next.home, draft.home);
});

test('profile deletions and account reset markers prevent stale publications', () => {
  const a = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1), [addonKey]: env('1', 'addons', [addon], 2) });
  const b = snapshot(second, { [profileKey]: env('__account__', 'profile', { profiles: [], revisions: { '2': { fields: { exists: { value: false, stamp: stamp(1, second) } } } } }, 3, second),
    [`${prefix}.__account__.deletionMarker`]: env('__account__', 'deletionMarker', { reset: true }, 4, second) });
  const documents = new SyncDocuments(loaded([[device, a], [second, b]]), realm, browser);
  assert.deepEqual(documents.profiles.map(profile => profile.id), ['1']);
  assert.throws(() => documents.draft('2'));
  assert.throws(() => documents.publication('1', { ...documents.draft('1'), addons: [] }), /sync_reset/);
});

test('a Home edit preserves an existing private source and refuses to introduce a configured manifest link', () => {
  const privateSource = 'https://catalog.example.org/personal-config/manifest.json';
  const stored = { ...widget, source: { ...widget.source, addonID: privateSource } };
  const source = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1),
    [widgetKey]: env('1', 'homeWidgets.v1', rows({ [widget.id]: { stamp: stamp(1), row: wire(stored) } }), 2) });
  const documents = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = documents.draft('1');
  draft.home[0].title = 'Renamed';
  const publication = documents.publication('1', draft)!;
  assert.equal(new SyncDocuments(loaded([[device, source], [browser, publication]]), realm, browser).draft('1').home[0].source.addonID, privateSource);
  draft.home[0].source.addonID = 'https://another.example.org/personal-config/manifest.json';
  assert.throws(() => documents.publication('1', draft), /private_addon_route/);
});

test('a cursor change outside the edited section can be retried; concurrent edits to it are kept for review', () => {
  const a = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1), [addonKey]: env('1', 'addons', [addon], 2) });
  const original = new SyncDocuments(loaded([[device, a]]), realm, browser);
  const draft = original.draft('1'); draft.addons[0].enabled = false;
  const b = snapshot(second, { [collectionsKey]: env('1', 'collections.v2', rows({ [hub.id]: { stamp: stamp(1, second), row: wire(hub) } }), 3, second) });
  const latest = new SyncDocuments(loaded([[device, a], [second, b]]), realm, browser);
  const rebased = original.rebaseDraft('1', draft, latest)!;
  assert.deepEqual(rebased.collections, [hub]);
  assert.equal(rebased.addons[0].enabled, false);
  assert.deepEqual(Object.keys(latest.publication('1', rebased)!.records), [addonKey]);
  const c = snapshot(second, { [addonKey]: env('1', 'addons', [{ ...addon, name: 'Renamed in Luma' }], 4, second) });
  assert.equal(original.rebaseDraft('1', draft, new SyncDocuments(loaded([[device, a], [second, c]]), realm, browser)), null);
});

test('browser preference edits keep native fields and a formatter reset survives an older pack', () => {
  const common = `${prefix}.1.commonSettings.v1`, tags = 'playback.formatterTags';
  const pack = { sourceUrl: 'file:fixture.json', filters: [{ name: '4K', pattern: '2160p' }], isActive: true };
  const native = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1),
    [common]: env('1', 'commonSettings.v1', { fields: {
      [tags]: { revision: 12, deviceID: device, value: JSON.stringify({ imports: [pack] }) },
      'metadata.language': { revision: 25, deviceID: device, value: 'de' },
    } }, 2) });
  const first = new SyncDocuments(loaded([[device, native]]), realm, browser);
  const changed = first.publication('1', { ...first.draft('1'), preferences: { 'progress.source': 'TRAKT', 'progress.chosen': true }, formatter: [] })!;
  const fields = (payload(changed.records, common) as { fields: Record<string, unknown> }).fields;
  assert.deepEqual(fields, {
    [tags]: { revision: 26, deviceID: browser },
    'progress.source': { revision: 26, deviceID: browser, value: 'TRAKT' },
    'progress.chosen': { revision: 26, deviceID: browser, value: true },
  });
  const updated = new SyncDocuments(loaded([[device, native], [browser, changed]]), realm, browser);
  assert.deepEqual(updated.draft('1').formatter, []);
  assert.equal(updated.draft('1').preferences?.['progress.source'], 'TRAKT');
  const other = snapshot(second, { [common]: env('1', 'commonSettings.v1', { fields: {
    'library.source': { revision: 40, deviceID: second, value: 'SIMKL' },
  } }, 1, second) });
  const latest = new SyncDocuments(loaded([[device, native], [browser, changed], [second, other]]), realm, browser);
  const draft = { ...updated.draft('1'), preferences: { ...updated.draft('1').preferences, 'progress.visible': false } };
  assert.deepEqual(updated.rebaseDraft('1', draft, latest)?.preferences, {
    'progress.source': 'TRAKT', 'progress.chosen': true, 'progress.visible': false, 'library.source': 'SIMKL', 'metadata.language': 'de',
  });
});

test('a portable preference reset leaves other registers and unknown future choices intact', () => {
  const common = `${prefix}.1.commonSettings.v1`;
  const fields = {
    'appearance.background': { revision: 6, deviceID: device, value: 'Midnight' },
    'playback.audioLanguage': { revision: 7, deviceID: device, value: 'New App Language' },
    'playback.subtitleLanguages': { revision: 8, deviceID: device, value: '["German","English"]' },
    'future.shared': { revision: 15, deviceID: device, value: 8 },
  };
  const source = snapshot(device, { [profileKey]: env('__account__', 'profile', profiles, 1), [common]: env('1', 'commonSettings.v1', { fields }, 2) });
  const original = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = original.draft('1');
  assert.deepEqual(draft.unavailablePreferences, ['playback.audioLanguage']);
  const changed = original.publication('1', { ...draft, preferences: { ...draft.preferences, 'appearance.background': null } })!;
  assert.deepEqual(payload(changed.records, common), { fields: { 'appearance.background': { revision: 16, deviceID: browser } } });
  const projected = new SyncDocuments(loaded([[device, source], [browser, changed]]), realm, browser).draft('1');
  assert.equal(projected.preferences?.['appearance.background'], undefined);
  assert.equal(projected.preferences?.['playback.subtitleLanguages'], '["German","English"]');
  assert.deepEqual(projected.unavailablePreferences, ['playback.audioLanguage']);
  const concurrent = snapshot(second, { [common]: env('1', 'commonSettings.v1', { fields: {
    'appearance.background': { revision: 17, deviceID: second, value: 'Slate' },
  } }, 1, second) });
  const latest = new SyncDocuments(loaded([[device, source], [second, concurrent]]), realm, browser);
  assert.equal(original.rebaseDraft('1', { ...draft, preferences: { ...draft.preferences, 'appearance.background': null } }, latest), null);
});

test('a native skip schema upgrade blocks old portal edits without blocking other preferences', () => {
  const common = `${prefix}.1.commonSettings.v1`, schema = 'playback.skip.schema', intro = 'playback.skip.intro.mode';
  const register = (value: unknown, revision: number) => ({ value, revision, deviceID: device });
  const source = (version: number) => snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [common]: env('1', 'commonSettings.v1', { fields: {
      [schema]: register(version, version), [intro]: register('manual', 1),
      'nativeProtected.metadata.v1.tmdb': register('opaque', 40),
    } }, version + 1),
  });
  const old = new SyncDocuments(loaded([[device, source(1)]]), realm, browser);
  const future = new SyncDocuments(loaded([[device, source(2)]]), realm, browser);
  const previous = old.draft('1'), current = future.draft('1');
  assert(current.unavailablePreferences.includes(intro));
  assert.equal(current.preferences?.['nativeProtected.metadata.v1.tmdb'], undefined);
  assert.equal(old.rebaseDraft('1', { ...previous, preferences: { ...previous.preferences, [intro]: 'automatic' } }, future), null);
  const saved = future.publication('1', { ...current, preferences: { ...current.preferences, 'appearance.background': 'Midnight' } })!;
  assert.deepEqual(payload(saved.records, common), {
    fields: { 'appearance.background': { value: 'Midnight', revision: 41, deviceID: browser } },
  });
});

test('visible Home files round-trip collection and catalog rows, and appending does not replace the current setup', async () => {
  const { appendHomeFile, readHomeFile, writeVisibleHome } = await import('./home-files');
  const empty = { home: [], collections: [], addons: [], addonStatus: 'missing' as const, formatter: [], preferences: {}, unavailablePreferences: [] };
  const source = { addonID: 'org.movies', mediaType: 'movie', catalogID: 'catalog-a', collectionID: '' };
  const original = {
    ...empty, collections: [hub], home: [
      { id: collectionHomeID(hub.id), kind: 'collection' as const, title: '', source: collectionSource(hub.id), enabled: true, position: 0 },
      { id: 'widget:example', kind: 'widget' as const, title: 'Movies', source, enabled: true, position: 1, widget: { extras: { genre: 'Action' } } },
      { id: 'widget:hidden', kind: 'widget' as const, title: 'Hidden', source, enabled: false, position: 2 },
    ],
  };
  const imported = readHomeFile(JSON.parse(writeVisibleHome(original)))!;
  assert.equal(imported.collections[0].folders[0].sections?.[0].folders[0].title, 'Deep');
  assert.equal(imported.home.length, 2);
  assert.deepEqual(imported.home[1].widget?.extras, { genre: 'Action' });
  assert.notEqual(imported.home[0].id, original.home[0].id);
  const appended = appendHomeFile(original, imported);
  assert.deepEqual(appended.home.map(row => row.position), [0, 1, 2, 3, 4]);
  assert.equal(appended.collections.length, 2);
});


test('a migrated Home beyond the old browser limit can be edited without rewriting hidden rows or local Library', () => {
  const large = Array.from({ length: 543 }, (_, position) => ({ ...widget,
    id: `migrated-${position}`, position, enabled: position === 542, future: { position } }));
  const source = snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [widgetKey]: env('1', 'homeWidgets.v1', rows(Object.fromEntries(large.map(row => [row.id, { stamp: stamp(2), row: wire(row) }]))), 3),
    [unrelated]: env('1', 'local-library.v1', { opaque: 'owned by Luma' }, 4),
  });
  const docs = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = docs.draft('1');
  assert.equal(draft.home.length, 543);
  assert.equal(draft.home.filter(row => row.enabled).length, 1);
  draft.home[542] = { ...draft.home[542], title: 'Edited in portal' };
  const saved = docs.publication('1', draft)!;
  assert.deepEqual(Object.keys(saved.records), [widgetKey]);
  const merged = new SyncDocuments(loaded([[device, source], [browser, saved]]), realm, browser).draft('1');
  assert.equal(merged.home.length, 543);
  assert.equal(merged.home[542].title, 'Edited in portal');
  assert.deepEqual(merged.home[0].widget?.future, { position: 0 });
  assert.equal(merged.home[541].enabled, false);
  const tooMany = Array.from({ length: MAX_SYNC_HOME_WIDGETS + 1 }, (_, position) => ({ ...draft.home[0], id: `widget:added-${position}`, position }));
  assert.throws(() => docs.publication('1', { ...draft, home: tooMany }));
});

test('Home file round-trip accepts the new native row limit, with further imports bounded by the profile limit', async () => {
  const { appendHomeFile, readHomeFile, writeVisibleHome } = await import('./home-files');
  const home = Array.from({ length: MAX_HOME_FILE_ROWS }, (_, position) => ({
    kind: 'widget' as const, id: `widget:row-${position}`, title: `Movie ${position}`,
    source: { ...widget.source, catalogID: `movies-${position}` }, enabled: true, position, widget: { extras: {} },
  }));
  const draft = { home, collections: [], addons: [], addonStatus: 'missing' as const, formatter: [], preferences: {}, unavailablePreferences: [] };
  const layout = readHomeFile(JSON.parse(writeVisibleHome(draft)))!;
  assert.equal(layout.home.length, MAX_HOME_FILE_ROWS);
  assert.equal(layout.home.at(-1)?.source.catalogID, `movies-${MAX_HOME_FILE_ROWS - 1}`);
  assert.throws(() => writeVisibleHome({ ...draft, home: [...home, { ...home[0], id: 'widget:extra' }] }), /1024/);
  assert.throws(() => appendHomeFile({ ...draft, home: Array.from({ length: MAX_SYNC_HOME_WIDGETS }, () => home[0]) }, layout), /4096/);
});

test('only public catalog pins are projected; tracking changes preserve native connections and private pins', () => {
  const common = `${prefix}.1.commonSettings.v1`;
  const register = (value: unknown, revision: number) => ({ value, revision, deviceID: device });
  const privatePin = '{"source":{"trakt":{"listID":"42"}},"name":"Private list","origin":"Trakt"}';
  const nativePin = '{"source":{"addon":{"manifestURL":"https://catalog.example.org/manifest.json","type":"movie","catalogID":"catalog-a","paginated":true}},"name":"Popular","origin":"Catalogs"}';
  const source = (pin: string) => snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [common]: env('1', 'commonSettings.v1', { fields: {
      [libraryRowField]: register(pin, 2),
      'integrations.mdblistConnection': register('opaque mdb', 3), 'integrations.traktConnection': register('opaque trakt', 4),
      'integrations.simklConnection': register('opaque simkl', 5),
    } }, 6),
  });
  const original = source(privatePin);
  const docs = new SyncDocuments(loaded([[device, original]]), realm, browser);
  const draft = docs.draft('1');
  assert.deepEqual(draft.unavailablePreferences, [libraryRowField]);
  assert.deepEqual(draft.preferences, {});
  const saved = docs.publication('1', { ...draft, preferences: { 'library.shelf.forYou': false } })!;
  assert.deepEqual(payload(saved.records, common), { fields: { 'library.shelf.forYou': { revision: 6, deviceID: browser, value: false } } });
  assert.throws(() => docs.publication('1', { ...draft, preferences: { [libraryRowField]: null } }));
  assert.equal(readLibraryRow(nativePin)?.source.addon.paginated, true);
  assert.equal(readLibraryRow(nativePin.replace('/manifest.json', '/private-key/manifest.json')), null);
  assert.equal(readLibraryRow(nativePin.replace('catalog.example.org', 'catalog.home.arpa')), null);
  const publicDocs = new SyncDocuments(loaded([[device, source(nativePin)]]), realm, browser);
  const publicDraft = publicDocs.draft('1');
  assert.equal(publicDraft.preferences?.[libraryRowField], nativePin);
  const selection = makeLibraryRow({ manifestURL: addon.manifestURL, mediaType: 'movie', catalogID: 'new', title: 'New' })!;
  const written = publicDocs.publication('1', { ...publicDraft, preferences: { [libraryRowField]: selection } })!;
  assert.deepEqual(readLibraryRow(selection)?.source.addon, { manifestURL: addon.manifestURL, type: 'movie', catalogID: 'new', paginated: false });
  assert.deepEqual(payload(written.records, common), { fields: { [libraryRowField]: { revision: 6, deviceID: browser, value: selection } } });
});


test('the Library layout projects native row IDs and keeps newer IDs when known rows move', () => {
  const key = `${prefix}.1.commonSettings.v1`;
  const wireOrder = 'watchlist,future,calendar,watchlist';
  const source = snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [key]: env('1', 'commonSettings.v1', { fields: {
      [libraryOrderField]: { value: wireOrder, revision: 5, deviceID: device },
      'library.shelf.watchlist': { value: false, revision: 4, deviceID: device },
    } }, 6),
  });
  const docs = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = docs.draft('1');
  assert.equal(draft.preferences?.[libraryOrderField], wireOrder);
  assert.equal(draft.preferences?.['library.shelf.watchlist'], false);
  const [watchlist, calendar, ...rest] = libraryShelfOrder(wireOrder);
  assert.deepEqual([watchlist.id, calendar.id, ...rest.map(row => row.id)], [
    'watchlist', 'calendar', 'recentlyWatched', 'forYou', 'becauseYouWatched', 'pinned', 'sources',
  ]);
  const order = writeLibraryOrder(wireOrder, [calendar, ...rest, watchlist]);
  assert.equal(order, 'calendar,future,recentlyWatched,forYou,becauseYouWatched,pinned,sources,watchlist');
  assert.equal(writeLibraryOrder('ä'.repeat(2048), libraryShelfOrder('')), null);
  const publication = docs.publication('1', { ...draft, preferences: { ...draft.preferences,
    [libraryOrderField]: order, 'library.shelf.pinned': false,
  } })!;
  assert.deepEqual(payload(publication.records, key), { fields: {
    [libraryOrderField]: { value: order, revision: 6, deviceID: browser },
    'library.shelf.pinned': { value: false, revision: 6, deviceID: browser },
  } });
  const merged = new SyncDocuments(loaded([[device, source], [browser, publication]]), realm, browser).draft('1');
  assert.equal(merged.preferences?.['library.shelf.watchlist'], false);
  assert.equal(merged.preferences?.[libraryOrderField], order);
});

test('metadata edits round-trip native person roles, future layout fields and the genre-default marker', async () => {
  const { editPersonLayout, personSections, readPersonLayout } = await import('./person-layout');
  const { parseGenrePreference, searchAddonFingerprint } = await import('./metadata-preferences');
  const key = `${prefix}.1.commonSettings.v1`;
  const layout = { version: 1, extra: { future: true }, roles: {
    actor: { order: ['movies', 'futureSection', 'knownFor'], sections: { movies: { extra: 1 } } },
    director: { sections: { directedMovies: { sort: 'oldest' } } },
  } };
  const source = snapshot(device, {
    [profileKey]: env('__account__', 'profile', profiles, 1),
    [key]: env('1', 'commonSettings.v1', { fields: {
      'metadata.personSectionLayout': { value: JSON.stringify(layout), revision: 5, deviceID: device },
      'metadata.language': { value: 'de_AT', revision: 6, deviceID: device },
      'metadata.excludedPersonGenreIDs': { value: '28,424242', revision: 3, deviceID: device },
      'nativeProtected.metadata.v1.tmdb': { value: 'opaque', revision: 8, deviceID: device },
    } }, 9),
  });
  const docs = new SyncDocuments(loaded([[device, source]]), realm, browser);
  const draft = docs.draft('1');
  const raw = readPersonLayout(draft.preferences?.['metadata.personSectionLayout'])!;
  assert.equal(draft.preferences?.['metadata.language'], 'de_AT');
  assert.deepEqual(parseGenrePreference(draft.preferences?.['metadata.excludedPersonGenreIDs'], true), [28, 424242]);
  assert.deepEqual(parseGenrePreference('28|-1 99', false), [-1, 28, 99]);
  const ordered = personSections(raw, 'actor');
  const edit = editPersonLayout(raw, 'actor', { order: [ordered[1], ordered[0], ...ordered.slice(2)].map(row => row.id) })!;
  const next = editPersonLayout(readPersonLayout(edit)!, 'actor', { id: 'movies', field: 'sort', value: 'newest' })!;
  const changed = JSON.parse(next);
  assert.deepEqual(changed.roles.actor.order.slice(0, 3), ['knownFor', 'futureSection', 'movies']);
  assert.deepEqual(changed.roles.actor.sections.movies, { extra: 1, sort: 'newest' });
  assert.deepEqual(changed.roles.director, layout.roles.director);
  assert.deepEqual(changed.extra, layout.extra);
  const selected = await searchAddonFingerprint('https://v3-cinemeta.strem.io/manifest.json');
  assert.equal(selected, 'd29ee8b9d34bfb933b8b8187764d24d3ab4bad47f4bb2ef7a3380fd14b50d52e');
  const preferences = { ...draft.preferences, 'metadata.personSectionLayout': next, 'metadata.excludedPersonGenreIDs': '[424242]',
    'metadata.personGenreDefaultsApplied': true, 'search.excludedGenres': '-1,99', 'search.addon': selected };
  const saved = docs.publication('1', { ...draft, preferences })!;
  const fields = (payload(saved.records, key) as { fields: Record<string, unknown> }).fields;
  assert(!('nativeProtected.metadata.v1.tmdb' in fields));
  assert(!('metadata.language' in fields));
  const roundTrip = new SyncDocuments(loaded([[device, source], [browser, saved]]), realm, browser).draft('1');
  assert.deepEqual(roundTrip.preferences, preferences);
  assert.equal(readPersonLayout('{"version":2,"roles":{}}'), null);
});
