import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncDocuments } from './documents';
import { base64, json, unbase64 } from './wire';

// Vectors printed by Swift from verbatim copies of LumaLibraryBridge.Consent/Window, libraryCopyTag and digest
// (see the report: standalone CryptoKit/Foundation script, not the package build).
const swift = {
  tag2: '083b3cf3fe6eb95325e09d7979f0838e95570cf43fa05165d1cc3d67ceaea806',
  tagNil: '21adca8bd6562c10b1fd3260d9c7fe1c6a19de78bfb6677d40cc2c3c62815cc5',
  consent: '{"accounts":{"mdblist":{"after":784000000.25,"binding":"luma-sync-v1.abababababababababababababababababababababababababababababababab:22222222-2222-4222-8222-222222222222","counter":42,"id":"CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC"},"trakt":{"after":784000000.25,"binding":"luma-sync-v1.abababababababababababababababababababababababababababababababab:11111111-1111-4111-8111-111111111111","counter":42,"id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}},"profileTag":"tag"}',
  whole: '{"accounts":{"simkl":{"after":784000000,"binding":"luma-sync-v1.abababababababababababababababababababababababababababababababab:33333333-3333-4333-8333-333333333333","counter":0,"id":"F7B328AA-01FD-433B-B782-E4E6AA5AD5AE"}},"profileTag":"t"}',
};
const realm = `luma-sync-v1.${'ab'.repeat(32)}`, prefix = 'apple.kvs.sync.v2';
const native = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', second = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', browser = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const trakt = `${realm}:11111111-1111-4111-8111-111111111111`, mdb = `${realm}:22222222-2222-4222-8222-222222222222`;
const simkl = `${realm}:33333333-3333-4333-8333-333333333333`;
const wire = (value: unknown) => base64(json(value));
const data = (value: string) => JSON.parse(new TextDecoder().decode(unbase64(value, 4_000_000)));
const envelope = (profileID: string, domain: string, payload: unknown, counter: number, who: string) => ({
  stamp: { counter, device: who }, value: wire({ profileID, domain, schemaVersion: 2, modifiedAt: '2026-01-01T00:00:00Z', deviceID: who, data: wire(payload) }),
});
const profile = (id: string) => ({ id, name: id, avatar: '', isAdmin: id === '1', isPinProtected: false, usesPrimaryAddons: false, usesPrimaryPlugins: true });
const fields = (name: string, count: number, who: string) => Object.fromEntries(Object.entries({ exists: true, name, avatar: '', pin: false, admin: false, addons: false, plugins: true })
  .map(([key, value]) => [key, { value, stamp: { counter: count, device: who } }]));
const reg = (value: unknown, revision: number, deviceID = native) => ({ value, revision, deviceID });
const entry = (counter: number, who: string, key: string) => ({ stamp: { counter, device: who }, modifiedAt: 1000 + counter, row: { key } });
const snapshot = (who: string, records: object) => ({ schema: 1, realm, device: who, platform: 'ios', records });
const load = (snapshots: [string, unknown][]) => ({ cursor: 'c', ownVersion: 0, modern: true, snapshots: new Map(snapshots) });
const common = { fields: {
  'integrations.traktConnection': reg(trakt, 9), 'integrations.mdblistConnection': reg(mdb, 11), 'integrations.simklConnection': reg(simkl, 3),
  'appearance.oled': reg(true, 17), futureField: reg({ nested: [1] }, 4), 'progress.source': reg('TRAKT', 5), 'library.source': reg('TRAKT', 6),
} };
function fixture(extra: Record<string, unknown> = {}, roster = true) {
  const list = roster ? { profiles: [profile('1'), profile('2'), profile('3')], revisions: { '1': { fields: fields('1', 1, native) }, '2': { fields: fields('2', 8, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') }, '3': { fields: fields('3', 2, native) } } }
    : { profiles: [profile('1'), profile('2'), profile('3')] };
  const first = snapshot(native, {
    [`${prefix}.__account__.profile`]: envelope('__account__', 'profile', list, 1, native),
    [`${prefix}.2.commonSettings.v1`]: envelope('2', 'commonSettings.v1', common, 2, native),
    [`${prefix}.3.commonSettings.v1`]: envelope('3', 'commonSettings.v1', { fields: { 'integrations.traktConnection': reg(trakt, 1) } }, 3, native),
    ...extra,
  });
  return { first, documents: new SyncDocuments(load([[native, first]]), realm, browser) };
}
const valueOf = (snapshotValue: { records: Record<string, { value?: string }> }, id = '2') => {
  const document = data(snapshotValue.records[`${prefix}.${id}.commonSettings.v1`].value!);
  return data(document.data).fields as Record<string, { value?: string; revision: number; deviceID: string }>;
};

test('the library tag binds consent to the slot generation exactly like libraryCopyTag', async () => {
  const { documents } = fixture();
  assert.equal(await documents.libraryCopyTag('2'), swift.tag2);
  const legacy = fixture({}, false).documents; // A roster without revisions has no existence stamp.
  assert.equal(await legacy.libraryCopyTag('3'), swift.tagNil);
  assert.throws(() => documents.libraryCopyTag('6'));
});
test('the library counter is the highest non-seed clock across writers, 0 without a library', () => {
  assert.equal(fixture().documents.libraryCounter('2'), 0);
  const seeds = { version: 1, entries: { a: entry(1, 'copy:tag', 'a') } };
  const mine = { version: 1, entries: { b: entry(5, native, 'b'), c: entry(9, native, 'c') } };
  const theirs = { version: 1, entries: { b: entry(7, second, 'b') } };
  const withLibrary = (docs: [string, unknown][]) => fixture(Object.fromEntries(docs.map(([, doc], i) => [`${prefix}.2.local-library.v1`, envelope('2', 'local-library.v1', doc, 10 + i, native)])));
  assert.equal(withLibrary([[native, seeds]]).documents.libraryCounter('2'), 0);
  assert.equal(withLibrary([[native, mine]]).documents.libraryCounter('2'), 9);
  const first = snapshot(native, { [`${prefix}.__account__.profile`]: envelope('__account__', 'profile', { profiles: [profile('1'), profile('2')] }, 1, native),
    [`${prefix}.2.local-library.v1`]: envelope('2', 'local-library.v1', mine, 2, native) });
  const other = snapshot(second, { [`${prefix}.2.local-library.v1`]: envelope('2', 'local-library.v1', { version: 1, entries: { ...theirs.entries, seed: entry(1, 'copy:x', 'seed') } }, 3, second) });
  assert.equal(new SyncDocuments(load([[native, first], [second, other]]), realm, browser).libraryCounter('2'), 9);
  const bad = snapshot(native, { [`${prefix}.__account__.profile`]: envelope('__account__', 'profile', { profiles: [profile('1'), profile('2')] }, 1, native),
    [`${prefix}.2.local-library.v1`]: envelope('2', 'local-library.v1', { version: 2, entries: {} }, 2, native) });
  assert.throws(() => new SyncDocuments(load([[native, bad]]), realm, browser).libraryCounter('2'));
});
test('consent matches the native encoding, revision and source choice, and leaves other fields alone', async () => {
  const library = { version: 1, entries: { x: entry(42, native, 'x'), y: entry(3, second, 'y') } };
  const { first, documents } = fixture({ [`${prefix}.2.local-library.v1`]: envelope('2', 'local-library.v1', library, 12, native) });
  const now = (784_000_000.25 + 978_307_200) * 1000;
  const published = await documents.watchActivityPublication('2', { trakt, mdblist: mdb }, now);
  const written = valueOf(published);
  assert.deepEqual(Object.keys(written).sort(), ['library.source', 'progress.chosen', 'progress.connectedAccounts', 'progress.source']); // only this writer's fields
  for (const field of Object.values(written)) { assert.equal(field.revision, 18); assert.equal(field.deviceID, browser); } // above every register (17)
  assert.equal(written['progress.source'].value, 'LOCAL'); assert.equal(written['library.source'].value, 'LOCAL'); assert.equal(written['progress.chosen'].value, true);
  const consent = JSON.parse(written['progress.connectedAccounts'].value!);
  assert.equal(consent.profileTag, swift.tag2);
  assert.equal(consent.accounts.trakt.counter, 42); assert.equal(consent.accounts.mdblist.after, 784_000_000.25);
  assert.match(consent.accounts.trakt.id, /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/);
  // Byte-for-byte against Swift's sortedKeys output once the random IDs, tag and counter are the vector's.
  const swiftShape = structuredClone(consent);
  swiftShape.profileTag = 'tag'; swiftShape.accounts.trakt.id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; swiftShape.accounts.mdblist.id = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
  assert.equal(JSON.stringify(swiftShape), swift.consent);
  assert.equal(JSON.stringify(JSON.parse(swift.whole)), swift.whole);
  assert.equal(new TextEncoder().encode(written['progress.connectedAccounts'].value!).length < 4096, true);
  // Another writer's view: native merge by revision shows the consent and keeps its own other registers.
  const after = new SyncDocuments(load([[native, first], [browser, published]]), realm, browser);
  const read = (await after.watchActivity('2'))!;
  assert.deepEqual(Object.keys(read.accounts).sort(), ['mdblist', 'trakt']);
  assert.equal(after.managedConnection('2', 'trakt'), trakt);
  assert.equal(after.draft('2').preferences?.['appearance.oled'], true);
  assert.equal(after.draft('2').preferences?.['progress.source'], 'LOCAL');
  // Re-enabling keeps the windows of unchanged accounts and opens a new one for a replaced or added account.
  const again = await after.watchActivityPublication('2', { trakt, mdblist: mdb, simkl }, now + 60_000);
  const next = JSON.parse(valueOf(again)['progress.connectedAccounts'].value!);
  assert.deepEqual(next.accounts.trakt, consent.accounts.trakt);
  assert.deepEqual(next.accounts.mdblist, consent.accounts.mdblist);
  assert.equal(next.accounts.simkl.after, 784_000_060.25);
  assert.notEqual(next.accounts.simkl.id, consent.accounts.trakt.id);
  assert.equal(valueOf(again)['progress.connectedAccounts'].revision, 19);
});
test('turning it off writes a value-less register above the consent and nothing else', async () => {
  const { first, documents } = fixture();
  const on = await documents.watchActivityPublication('2', { trakt }, 1_700_000_000_000);
  const enabled = new SyncDocuments(load([[native, first], [browser, on]]), realm, browser);
  assert.deepEqual(Object.keys((await enabled.watchActivity('2'))!.accounts), ['trakt']);
  const off = await enabled.watchActivityPublication('2', {}, 1_700_000_100_000);
  const written = valueOf(off);
  assert.deepEqual(Object.keys(written), ['progress.connectedAccounts', ...Object.keys(valueOf(on)).filter(key => key !== 'progress.connectedAccounts')]);
  assert.equal(Object.hasOwn(written['progress.connectedAccounts'], 'value'), false);
  assert.equal(written['progress.connectedAccounts'].revision, 19);
  const disabled = new SyncDocuments(load([[native, first], [browser, off]]), realm, browser);
  assert.equal(await disabled.watchActivity('2'), null);
  assert.equal(disabled.draft('2').preferences?.['progress.source'], 'LOCAL'); // Native leaves the chosen source in place.
});
test('consent is refused for accounts that are not the profile\'s connection and ignored for another slot generation', async () => {
  const { first, documents } = fixture();
  await assert.rejects(documents.watchActivityPublication('2', { trakt: `${realm}:99999999-9999-4999-8999-999999999999` }));
  await assert.rejects(documents.watchActivityPublication('2', { trakt: `luma-sync-v1.${'cd'.repeat(32)}:11111111-1111-4111-8111-111111111111` }));
  await assert.rejects(documents.watchActivityPublication('3', { simkl }));
  await assert.rejects(documents.watchActivityPublication('9', { trakt }));
  const on = await documents.watchActivityPublication('2', { trakt });
  // The same slot recreated later has a new existence stamp, so the old consent no longer applies.
  const recreated = structuredClone(first) as { records: Record<string, unknown> };
  const list = { profiles: [profile('1'), profile('2')], revisions: { '1': { fields: fields('1', 1, native) }, '2': { fields: fields('2', 30, native) } } };
  recreated.records[`${prefix}.__account__.profile`] = envelope('__account__', 'profile', list, 4, native);
  const later = new SyncDocuments(load([[native, recreated], [browser, on]]), realm, browser);
  assert.equal(await later.watchActivity('2'), null);
});
