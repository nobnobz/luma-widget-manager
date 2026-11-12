import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDevices, SyncDevices } from './devices';
import { SyncHTTPError } from './passkey';

const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const row = { id: a, name: 'iPhone', createdAt: '2026-01-02T03:04:05.000Z', revokedAt: null };
test('device lists keep the server fields and mark browser slots', () => {
  assert.deepEqual(parseDevices({ devices: [row, { ...row, id: b, name: ' Web ', revokedAt: '2026-02-01T00:00:00.000Z', browser: true }] }), [
    { id: a, name: 'iPhone', createdAt: Date.parse(row.createdAt), revokedAt: null, browser: false },
    { id: b, name: 'Web', createdAt: Date.parse(row.createdAt), revokedAt: Date.parse('2026-02-01T00:00:00.000Z'), browser: true },
  ]);
  assert.deepEqual(parseDevices({ devices: [] }), []);
});
test('malformed device lists are rejected', () => {
  const bad: unknown[] = [undefined, {}, 'x', [null], [{ ...row, id: 'nope' }], [{ ...row, name: 5 }], [{ ...row, createdAt: 'yesterday' }],
    [{ ...row, createdAt: 12 }], [{ ...row, revokedAt: undefined }], [{ ...row, revokedAt: 'x' }], [{ ...row, browser: false }],
    [{ ...row, browser: 'true' }], [row, row], [{ ...row, name: 'x'.repeat(1025) }]];
  for (const devices of bad) assert.throws(() => parseDevices({ devices }));
});
test('listing and removing use the bearer-authenticated device routes', async () => {
  const calls: string[] = [];
  const client = new SyncDevices('session', async (path, options) => {
    assert.equal(options?.token, 'session');
    calls.push(`${options?.method ?? 'GET'} ${path}`);
    return options?.method === 'DELETE' ? { ok: true } : { devices: [row] };
  });
  assert.equal((await client.list()).length, 1);
  await client.remove(a);
  assert.deepEqual(calls, ['GET /v1/devices', `DELETE /v1/devices/${a}`]);
  await assert.rejects(client.remove('../x'));
});
test('removal treats unknown devices as done and surfaces other failures', async () => {
  await new SyncDevices('t', async () => { throw new SyncHTTPError(404); }).remove(a);
  for (const status of [401, 403, 500]) {
    await assert.rejects(new SyncDevices('t', async () => { throw new SyncHTTPError(status); }).remove(a), (e: unknown) => e instanceof SyncHTTPError && e.status === status);
  }
  await assert.rejects(new SyncDevices('t', async () => ({})).remove(a));
});
