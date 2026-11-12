import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncDocuments } from './documents';
import { NativeRoot, normalizeKey, openRoot, ProtectedKeys, protectedField, rootCommitment, sealRoot, validateKey, type ProtectedRegister } from './protected-keys';
import { base64, json, unbase64 } from './wire';

// Vectors printed by Swift: LumaSyncCrypto.sealNativeRoot and ProtectedMetadataSync.seal, compiled from copies of
// their bodies with CryptoKit and a fixed nonce (see the report; not the package build).
const master = Uint8Array.from({ length: 32 }, (_, i) => i + 1), root = Uint8Array.from({ length: 32 }, (_, i) => 0x40 + i);
const nonce = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const space = '11111111-2222-4333-8444-555555555555', device = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const realm = `luma-sync-v1.${'ab'.repeat(32)}`, epoch = 'ZXBvY2gtYnl0ZXM=';
const swift = {
  commitment: 'ca2a4fe727faaecf16ecd130a86e0885c5540c05375340445071c0657555fd42',
  rootCopy: 'oKGio6SlpqeoqaqrYbtOK9YDR-T7ADVZtjQ1MO2rUXYsIIt2S_mGp-93NsdnwLPTHjRMYDO7dBRQhBMS',
  tmdb2: 'oKGio6SlpqeoqaqrT-adTiO_Y8spH7N-v8_FNNKzerykQjjBdJ-Tt1MYWeMNm7M',
  mdb5empty: 'oKGio6SlpqeoqaqrszZw5j90ImSyw9M9OuwjbQ',
  tmdb4noEpoch: 'oKGio6SlpqeoqaqrU0hQQGK7K9kTViDjmgqS2hFmr6Td6b_zUEM',
};
const keys = (profile = '2', at: string | null = epoch, r = root) => new ProtectedKeys(r, realm, profile, at ?? undefined);
const reg = (value: string, revision: number, deviceID = device): ProtectedRegister => ({ value, revision, deviceID });

test('the root copy matches the native bytes and opens only for its master, space and commitment', async () => {
  assert.equal(await rootCommitment(root), swift.commitment);
  assert.equal(await sealRoot(root, master, space, nonce), swift.rootCopy);
  assert.deepEqual(await openRoot(swift.rootCopy, swift.commitment, master, space), root);
  assert.equal(await openRoot(swift.rootCopy, swift.commitment, master.map(n => n ^ 1), space), undefined);
  assert.equal(await openRoot(swift.rootCopy, swift.commitment, master, '11111111-2222-4333-8444-555555555556'), undefined);
  assert.equal(await openRoot(swift.rootCopy, 'f'.repeat(64), master, space), undefined);
  // A copy of some other root bound to its own commitment never opens as this commitment's root.
  const other = Uint8Array.from({ length: 32 }, (_, i) => i);
  assert.equal(await openRoot(await sealRoot(other, master, space), swift.commitment, master, space), undefined);
  assert.deepEqual(await openRoot(await sealRoot(other, master, space), await rootCommitment(other), master, space), other);
  for (const bad of ['', 'AAAA', swift.rootCopy.slice(0, -4), swift.rootCopy + 'AA', `${swift.rootCopy.slice(0, -1)}=`]) {
    assert.equal(await openRoot(bad, swift.commitment, master, space), undefined);
  }
  await assert.rejects(sealRoot(root.slice(1), master, space));
  await assert.rejects(sealRoot(root, master.slice(1), space));
});
test('key registers reproduce the native seal and the native open accepts only the sealed context', async () => {
  const k = keys();
  assert.deepEqual(await k.seal('tmdb-key_0123456789', 'tmdb', 2, device, nonce), reg(swift.tmdb2, 2));
  assert.equal(await k.open(reg(swift.tmdb2, 2), 'tmdb'), 'tmdb-key_0123456789');
  assert.deepEqual(await k.seal('', 'mdbList', 5, device, nonce), reg(swift.mdb5empty, 5));
  assert.equal(await k.open(reg(swift.mdb5empty, 5), 'mdbList'), ''); // an explicit removal
  assert.deepEqual(await keys('2', null).seal('héllo-key', 'tmdb', 4, device, nonce), reg(swift.tmdb4noEpoch, 4));
  assert.equal(await keys('2', null).open(reg(swift.tmdb4noEpoch, 4), 'tmdb'), 'héllo-key');
  assert.equal(k.context('tmdb'), `luma-protected-metadata-v1|${realm}|2|tmdb|${epoch}`);
  // Round trip with a random nonce.
  const fresh = await k.seal('abc', 'mdbList', 6, device);
  assert.equal(await k.open(fresh, 'mdbList'), 'abc');
});
test('a tampered revision, writer, provider, profile, realm, epoch, root or ciphertext cannot be opened', async () => {
  const good = reg(swift.tmdb2, 2);
  const attempts: [ProtectedKeys, unknown, 'tmdb' | 'mdbList'][] = [
    [keys(), { ...good, revision: 3 }, 'tmdb'], [keys(), { ...good, deviceID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef' }, 'tmdb'],
    [keys(), good, 'mdbList'], [keys('3'), good, 'tmdb'], [new ProtectedKeys(root, `luma-sync-v1.${'cd'.repeat(32)}`, '2', epoch), good, 'tmdb'],
    [keys('2', null), good, 'tmdb'], [keys('2', epoch, root.map(n => n ^ 1)), good, 'tmdb'],
    [keys(), { ...good, value: `${swift.tmdb2.slice(0, -2)}AA` }, 'tmdb'], [keys(), { ...good, revision: 0 }, 'tmdb'],
    [keys(), { ...good, deviceID: 'not-a-uuid' }, 'tmdb'], [keys(), { ...good, value: 5 }, 'tmdb'], [keys(), { ...good, value: '' }, 'tmdb'],
  ];
  for (const [instance, register, kind] of attempts) await assert.rejects(instance.open(register, kind));
  await assert.rejects(keys().seal('has space', 'tmdb', 2, device));
  await assert.rejects(keys().seal('ok', 'tmdb', 0, device));
  await assert.rejects(keys().seal('ok', 'tmdb', 2, 'device'));
  assert.throws(() => keys('a|b'));
  assert.throws(() => keys(''));
});
test('keys are validated like the native store and normalized like Foundation trimming', () => {
  for (const ok of ['', 'abc', 'é'.repeat(2048), 'a'.repeat(4096)]) assert.doesNotThrow(() => validateKey(ok));
  for (const bad of ['a b', 'a\nb', 'a\tb', 'a b', 'a\u0085b', 'a b', 'a\u0000b', 'a\u007fb', 'a\u009fb', 'é'.repeat(2049), 'a'.repeat(4097)]) {
    assert.throws(() => validateKey(bad), /invalid_sync_data/);
  }
  assert.equal(normalizeKey('  \n key\t '), 'key');
  assert.equal(normalizeKey('a b'), 'a b');
});
test('proposals follow the native revision and removal rules', async () => {
  const k = keys();
  const at = async (value: string, revision: number) => k.seal(value, 'tmdb', revision, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const next = async (local: string, remote: ProtectedRegister | undefined) => (await k.propose(local, remote, 'tmdb', device))?.revision ?? null;
  assert.equal(await next('new', undefined), 2); // first contact fills an empty slot
  assert.equal(await next('', undefined), null); // never authors a deletion from nothing
  assert.equal(await next('same', await at('same', 2)), null);
  assert.equal(await next('other', await at('old', 2)), 4);
  assert.equal(await next('', await at('old', 2)), 5); // removal wins the generation of an edit
  assert.equal(await next('again', await at('', 5)), 6);
  assert.equal(await next('again', await at('', 3)), 4);
  assert.equal(await next('', await at('', 5)), null);
  assert.equal(await next('x', await at('old', 7)), 8);
  assert.equal(await next('', await at('old', 8)), 11);
  const written = (await k.propose('other', await at('old', 2), 'tmdb', device))!;
  assert.equal(written.deviceID, device);
  assert.equal(await k.open(written, 'tmdb'), 'other');
  await assert.rejects(k.propose('bad key', undefined, 'tmdb', device));
  // An unreadable remote register is never overwritten.
  await assert.rejects(k.propose('x', { value: swift.tmdb2, revision: 9, deviceID: device }, 'tmdb', device));
});

const answer = (state: object) => ({ sealedRootSupported: true, ...state });
test('the root flow creates, reuses or waits exactly like a native device', async () => {
  const space2 = space;
  const calls: string[] = [];
  let stored: { commitment: string | null; sealedRoot: string | null } = { commitment: null, sealedRoot: null };
  const server = new NativeRoot('token', master, space2, async (path, options) => {
    assert.equal(path, '/v1/native-secret-root'); assert.equal(options?.token, 'token');
    calls.push(options?.method ?? 'GET');
    if (options?.method === 'PUT') {
      const body = options.body as { commitment: string; sealedRoot: string };
      assert.deepEqual(Object.keys(body).sort(), ['commitment', 'sealedRoot']);
      if (!stored.commitment) stored = body;
    }
    return answer(stored);
  });
  assert.equal(await server.existing(), 'none');
  const created = (await server.ensure())!;
  assert.equal(created.length, 32);
  assert.deepEqual(calls, ['GET', 'GET', 'PUT']);
  assert.equal(stored.commitment, await rootCommitment(created));
  assert.deepEqual(await openRoot(stored.sealedRoot!, stored.commitment!, master, space2), created);
  const again = await server.existing();
  assert.deepEqual(again, { root: created });
  assert.deepEqual(await server.ensure(), created); // reuse, no second PUT
  assert.equal(calls.filter(call => call === 'PUT').length, 1);
  // Another root won, or its copy is not openable: nothing is edited.
  const rival = new NativeRoot('t', master, space2, async () => answer({ commitment: 'e'.repeat(64), sealedRoot: swift.rootCopy }));
  assert.equal(await rival.existing(), 'waiting'); assert.equal(await rival.ensure(), undefined);
  const missing = new NativeRoot('t', master, space2, async () => answer({ commitment: swift.commitment, sealedRoot: null }));
  assert.equal(await missing.existing(), 'waiting');
  const wrongMaster = new NativeRoot('t', master.map(n => n ^ 1), space2, async () => answer({ commitment: swift.commitment, sealedRoot: swift.rootCopy }));
  assert.equal(await wrongMaster.existing(), 'waiting');
  // The reply of a first PUT that lost the race is opened, not assumed.
  const lost = new NativeRoot('t', master, space, async (_path, options) => options?.method === 'PUT'
    ? answer({ commitment: swift.commitment, sealedRoot: swift.rootCopy }) : answer({ commitment: null, sealedRoot: null }));
  assert.deepEqual(await lost.ensure(), root);
  for (const bad of [{ commitment: 'ABC', sealedRoot: null }, { commitment: null, sealedRoot: 'x'.repeat(129) }, { commitment: null }, { commitment: 5, sealedRoot: null },
    { commitment: null, sealedRoot: null, sealedRootSupported: false }]) {
    await assert.rejects(new NativeRoot('t', master, space, async () => bad as Record<string, unknown>).state());
  }
});

// A profile document with another writer's registers, a connection reference and one existing key.
const prefix = 'apple.kvs.sync.v2', wire = (value: unknown) => base64(json(value));
const writer = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', browser = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const stampOf = (counter: number, who: string) => ({ counter, device: who });
const envelope = (profileID: string, domain: string, data: unknown, counter: number, who: string, deletionEpoch?: string) => ({
  stamp: stampOf(counter, who), value: wire({ profileID, domain, schemaVersion: 2, modifiedAt: '2026-01-01T00:00:00Z', deviceID: who, data: wire(data), deletionEpoch }),
});
const snap = (who: string, records: object) => ({ schema: 1, realm, device: who, platform: 'ios', records });
const load = (snapshots: [string, unknown][]) => ({ cursor: 'c', ownVersion: 0, modern: true, snapshots: new Map(snapshots) });
const profileOf = (id: string) => ({ id, name: id, avatar: '', isAdmin: id === '1', isPinProtected: false, usesPrimaryAddons: false, usesPrimaryPlugins: true });
test('saving one key adds only that register and leaves every other field and provider untouched', async () => {
  const k = keys('2', epoch);
  const tmdb = await k.seal('tmdb-original', 'tmdb', 2, writer), mdb = await k.seal('mdb-original', 'mdbList', 2, writer);
  const common = { fields: {
    [protectedField('tmdb')]: tmdb, [protectedField('mdbList')]: mdb,
    'appearance.oled': { value: true, revision: 7, deviceID: writer }, futureField: { value: { nested: [1] }, revision: 3, deviceID: writer },
    'integrations.traktConnection': { value: `${realm}:${writer}`, revision: 9, deviceID: writer },
  } };
  const native = snap(writer, {
    [`${prefix}.__account__.profile`]: envelope('__account__', 'profile', { profiles: [profileOf('1'), profileOf('2')] }, 1, writer, epoch),
    [`${prefix}.__account__.deletionEpoch`]: { stamp: stampOf(2, writer), value: wire({ profileID: '__account__', domain: 'deletionEpoch', schemaVersion: 2, modifiedAt: '2026-01-01T00:00:00Z', deviceID: writer, data: epoch }) },
    [`${prefix}.2.commonSettings.v1`]: envelope('2', 'commonSettings.v1', common, 3, writer, epoch),
  });
  // Both the account and profile records carry the epoch the native device used.
  const documents = new SyncDocuments(load([[writer, native]]), realm, browser);
  const portal = documents.protectedKeys('2', root);
  assert.equal(portal.context('tmdb'), k.context('tmdb'));
  const current = documents.protectedRegister('2', 'tmdb');
  assert.deepEqual(current, tmdb);
  assert.equal(await portal.open(current, 'tmdb'), 'tmdb-original');
  const proposal = (await portal.propose('tmdb-replaced', current, 'tmdb', browser))!;
  assert.equal(proposal.revision, 4);
  const published = documents.protectedKeyPublication('2', 'tmdb', proposal);
  const own = JSON.parse(new TextDecoder().decode(unbase64(JSON.parse(new TextDecoder().decode(unbase64(published.records[`${prefix}.2.commonSettings.v1`].value, 1e6))).data, 1e6)));
  assert.deepEqual(Object.keys(own.fields), [protectedField('tmdb')]); // this writer only adds its own register
  assert.deepEqual(own.fields[protectedField('tmdb')], proposal);
  const after = new SyncDocuments(load([[writer, native], [browser, published]]), realm, browser);
  assert.deepEqual(after.protectedRegister('2', 'tmdb'), proposal); // the higher revision wins
  assert.equal(await after.protectedKeys('2', root).open(after.protectedRegister('2', 'tmdb'), 'tmdb'), 'tmdb-replaced');
  assert.deepEqual(after.protectedRegister('2', 'mdbList'), mdb); // the other provider is untouched
  assert.equal(after.managedConnection('2', 'trakt'), `${realm}:${writer}`);
  assert.deepEqual(after.profiles.map(row => row.id), ['1', '2']);
  // Removal advances the generation with the odd revision; a second save of the other provider keeps the first.
  const removal = (await after.protectedKeys('2', root).propose('', after.protectedRegister('2', 'tmdb'), 'tmdb', browser))!;
  assert.equal(removal.revision, 7); // from observed revision 4: (4/2+1)*2 + 1
  const afterRemoval = new SyncDocuments(load([[writer, native], [browser, after.protectedKeyPublication('2', 'tmdb', removal)]]), realm, browser);
  assert.equal(await afterRemoval.protectedKeys('2', root).open(afterRemoval.protectedRegister('2', 'tmdb'), 'tmdb'), '');
  const second = (await afterRemoval.protectedKeys('2', root).propose('mdb-new', afterRemoval.protectedRegister('2', 'mdbList'), 'mdbList', browser))!;
  const both = new SyncDocuments(load([[writer, native], [browser, afterRemoval.protectedKeyPublication('2', 'mdbList', second)]]), realm, browser);
  assert.deepEqual(Object.keys(both.protectedKeyPublication('2', 'tmdb', removal).records), [`${prefix}.2.commonSettings.v1`]);
  assert.equal(both.protectedRegister('2', 'mdbList')!.revision, 4);
  assert.throws(() => documents.protectedRegister('5', 'tmdb'));
  // Equal revisions are decided by the larger device ID, as in SharedPreferenceRegister.wins.
  const tie = { fields: { [protectedField('tmdb')]: { value: tmdb.value, revision: 2, deviceID: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } } };
  const tied = new SyncDocuments(load([[writer, native], [browser, snap(browser, { [`${prefix}.2.commonSettings.v1`]: envelope('2', 'commonSettings.v1', tie, 9, browser, epoch) })]]), realm, browser);
  assert.equal(tied.protectedRegister('2', 'tmdb')!.deviceID, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
});
