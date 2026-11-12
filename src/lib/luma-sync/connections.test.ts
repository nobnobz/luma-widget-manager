import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionID, ManagedConnections, waitForConnection } from './connections';
import { SyncHTTPError } from './passkey';

const realm = `luma-sync-v1.${'a'.repeat(64)}`;
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', attempt = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('connection references accept only the active space and canonical native IDs', () => {
  assert.equal(connectionID(`${realm}:${id}`, realm), id);
  assert.equal(connectionID('disconnected', realm), undefined);
  assert.equal(connectionID(undefined, realm), undefined);
  for (const value of [`${realm.replaceAll('a', 'b')}:${id}`, `${realm}:${id.toUpperCase()}`, `${realm}:${id}:extra`, '', null, 12]) {
    assert.throws(() => connectionID(value, realm));
  }
});
test('each provider uses its profile lifecycle without exposing private relay requests', async () => {
  for (const provider of ['trakt', 'simkl', 'mdblist'] as const) {
    const url = { trakt: 'https://auth.trakt.tv/activate', simkl: 'https://simkl.com/pin?user_code=ABCD', mdblist: 'https://mdblist.com/oauth/device/?user_code=ABCD' }[provider];
    const calls: string[] = [];
    const client = new ManagedConnections(provider, '2', 'session', async (path, options) => {
      assert.equal(options?.token, 'session');
      assert(path.startsWith(`/v1/connections/${provider}/2/`));
      calls.push(`${options?.method} ${path.split('/').slice(5).join('/')}`);
      if (path.endsWith('/start')) {
        assert.deepEqual(options?.body, { attempt });
        return { id, userCode: 'ABCD', verificationURL: url, expiresIn: 300, interval: 5 };
      }
      if (path.endsWith('/poll')) return { state: 'connected', id, username: 'Personal account' };
      if (options?.method === 'DELETE' || path.endsWith('/cancel')) throw new SyncHTTPError(404);
      return { id, username: 'Personal account', needsReconnect: true };
    });
    assert.equal((await client.start(attempt, new AbortController().signal)).verificationURL, url);
    assert.deepEqual(await client.poll(id, new AbortController().signal), { state: 'connected', account: { id, username: 'Personal account', needsReconnect: undefined } });
    assert.equal((await client.status(id, new AbortController().signal)).needsReconnect, true);
    await client.cancel(id); await client.disconnect(id);
    assert.equal(calls.length, 6);
    assert(!calls.some(path => path.includes('/request')));
  }
});
test('provider links and response identities are validated before use', async () => {
  for (const verificationURL of ['javascript:alert(1)', 'https://evil.example/activate', 'https://auth.trakt.tv/activate/other',
    'https://user:password@auth.trakt.tv/activate', 'https://auth.trakt.tv/activate?redirect=https://evil.example', 'https://auth.trakt.tv/activate#fragment']) {
    const client = new ManagedConnections('trakt', '1', 'session', async () => ({ id, userCode: 'ABCD', verificationURL, expiresIn: 300, interval: 5 }));
    await assert.rejects(client.start(attempt, new AbortController().signal));
  }
  for (const reply of [{ state: 'pending', interval: 0 }, { state: 'connected', id: attempt, username: 'Other flow' }, { state: 'connected', id, username: '' }]) {
    await assert.rejects(new ManagedConnections('trakt', '1', 'session', async () => reply).poll(id, new AbortController().signal));
  }
  assert.throws(() => new ManagedConnections('trakt', '../2', 'session'));
});
test('cancellation stops the polling wait immediately and propagates authorization failures', async () => {
  const control = new AbortController();
  const waiting = waitForConnection(60_000, control.signal);
  control.abort(); await assert.rejects(waiting, { name: 'AbortError' });
  const client = new ManagedConnections('simkl', '1', 'session', async () => { throw new SyncHTTPError(401); });
  await assert.rejects(client.disconnect(id), (error: unknown) => error instanceof SyncHTTPError && error.status === 401);
});
