import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfiguredAddonCipher, configuredID, configuredManifestURL, configuredPrefix } from './configured-addons';
import { initialProfileSnapshot, SyncDocuments } from './documents';
import { base64, json, parse, unbase64 } from './wire';

const realm = 'test-realm', device = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const master = new Uint8Array(32).fill(7);
const manifestURL = 'https://addons.example.org/stremio/synthetic/manifest.json';
const snapshot = initialProfileSnapshot(realm, device);
const load = (entries: [string, unknown][]) => ({ cursor: 'fixture', modern: true, ownVersion: 1, snapshots: new Map(entries) });

test('configured manifests accept personal HTTPS links without admitting local, public, or credential-in-authority URLs', () => {
  assert.equal(configuredManifestURL(manifestURL), manifestURL);
  assert.equal(configuredManifestURL('stremio://addons.example.org/manifest.json?fixture=1'), 'https://addons.example.org/manifest.json?fixture=1');
  for (const url of ['https://addons.example.org/manifest.json', 'https://192.168.1.2/user/manifest.json',
    'https://server.local/manifest.json?fixture=1', 'https://user:pass@addons.example.org/user/manifest.json',
    'https://addons.example.org/user/manifest.json#fragment', 'http://addons.example.org/user/manifest.json',
    'https://addons.example.org/%ZZ/manifest.json', 'https://0x7f.1/user/manifest.json']) {
    assert.equal(configuredManifestURL(url), null);
  }
});

test('the Swift/TypeScript fixture is bound to the account, profile, epoch, installation and revision', async () => {
  const id = 'fd91438738ad2d6784194282d978f5037a07dc1b0d357746a452259ce54b251f';
  const register = { revision: 4, deviceID: device, value: 'mBNv+AOl+ysSnaEDcDC1K/57FKRjNtS87J01Xm4D8pr+gjHtyRvm5am+oZ9HcThu9raZ/ZG2jl68Mq/Tho0aG5SEzx8eCxeEYGEVNOyNMhGn7a7dqKR8hPFbyqwSASB+zTIeic0Cryhwy3W+Pvyfsi5x6BUOUmVqTiAgVZYjtkxJk8dsPOt/yNB7uYadRp7fLMI=' };
  const cipher = new ConfiguredAddonCipher(master, realm, 'AQID');
  assert.equal((await cipher.open('1', id, register)).manifestURL, manifestURL);
  for (const [other, profile, hash, revision] of [
    [cipher, '2', id, 4], [cipher, '1', id, 5], [cipher, '1', '0'.repeat(64), 4],
    [new ConfiguredAddonCipher(master, realm, 'AQIE'), '1', id, 4],
    [new ConfiguredAddonCipher(master, 'other-realm', 'AQID'), '1', id, 4],
  ] as const) await assert.rejects(other.open(profile, hash, { ...register, revision }));
});

test('manager stores only encrypted fields and produces a tombstone on removal', async () => {
  const id = await configuredID(manifestURL);
  const docs = new SyncDocuments(load([[device, snapshot]]), realm, second);
  await docs.unlockConfiguredAddons(master);
  const draft = docs.draft('1');
  draft.configuredAddons = [{ id, manifestURL, name: 'Fixture', enabled: true, order: 0 }];
  const publication = (await docs.encryptedPublication('1', draft, master))!;
  const key = 'apple.kvs.sync.v2.1.commonSettings.v1';
  function fields(value: string) {
    const envelope = parse(unbase64(value, 10_000)) as { data: string };
    return parse(unbase64(envelope.data, 10_000)) as { fields: Record<string, { value?: string; revision: number }> };
  }
  const record = fields(publication.records[key].value!);
  assert.deepEqual(Object.keys(publication.records), [key]);
  assert.equal(JSON.stringify(record).includes(manifestURL), false);
  assert.equal(JSON.stringify(record).includes(base64(json(draft.configuredAddons))), false);
  const readBack = new SyncDocuments(load([[device, snapshot], [second, publication]]), realm, second);
  await readBack.unlockConfiguredAddons(master);
  assert.deepEqual(readBack.draft('1').configuredAddons, draft.configuredAddons);
  const removed = (await readBack.encryptedPublication('1', { ...readBack.draft('1'), configuredAddons: [] }, master))!;
  const tombstone = fields(removed.records[key].value!).fields[configuredPrefix + id];
  assert.equal(tombstone.value, undefined);
  assert(tombstone.revision > record.fields[configuredPrefix + id].revision);
});
