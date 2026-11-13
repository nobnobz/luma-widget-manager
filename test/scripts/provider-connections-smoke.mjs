// Runs inside the real HTTPS/passkey/native-format harness in sync-editor-smoke.
import assert from 'node:assert/strict';
import path from 'node:path';
import { SyncDocuments } from '../../src/lib/luma-sync/documents.ts';
import { connectionID } from '../../src/lib/luma-sync/connections.ts';

export function providerFixture() {
  const starts = { trakt: 0, simkl: 0, mdblist: 0 }, revoked = [];
  return { starts, revoked, fetch: async (raw, options) => {
    const url = new URL(raw), kind = url.hostname.includes('trakt') ? 'trakt' : url.hostname.includes('simkl') ? 'simkl' : 'mdblist';
    const body = options.body instanceof URLSearchParams ? Object.fromEntries(options.body) : options.body ? JSON.parse(options.body) : {};
    if (/\/(?:code|device|device-authorization\/)\/?$/.test(url.pathname)) {
      const number = ++starts[kind];
      return Response.json({ device_code: `${kind}-${number}`, user_code: `ABCD-${String(number).padStart(4, '0')}`, expires_in: 300, interval: 1 });
    }
    if (/revoke/.test(url.pathname)) { revoked.push({ kind, token: body.token }); return Response.json({}); }
    if (/token/.test(url.pathname)) {
      const code = body.code ?? body.device_code;
      return Response.json({ access_token: `fixture-private-access-${code}`, refresh_token: `fixture-private-refresh-${code}`,
        token_type: 'Bearer', expires_in: 3600, scope: kind === 'simkl' ? 'media:read media:write' : 'write' });
    }
    const code = options.headers.Authorization?.replace('Bearer fixture-private-access-', '');
    const username = `Personal ${code}`;
    if (url.pathname === '/user') return Response.json({ username, user_id: 123 });
    assert.equal(url.pathname, '/users/settings');
    return Response.json(kind === 'trakt' ? { user: { username, ids: { slug: code } } } : { account: { id: 123 }, user: { name: username } });
  } };
}

export async function providerConnectionsSmoke({ page, native, evidence, fixture, writeNativePreference, expireSession, advanceWindow }) {
  const read = async () => new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), crypto.randomUUID());
  const original = (await read()).draft('1');
  const region = page.getByRole('region', { name: 'Connected accounts', exact: true });
  const realm = await native.realm();
  await page.getByRole('button', { name: 'Tracking', exact: true }).click();
  await region.waitFor();
  const connect = async (name, action = 'Connect') => {
    await region.getByRole('button', { name: `${action} ${name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Connect ${name}`, exact: true });
    await dialog.getByLabel(`${name} device code`).waitFor();
    const link = dialog.getByRole('link', { name: `Open ${name}`, exact: true });
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    return dialog;
  };
  for (const [kind, name] of [['trakt', 'Trakt'], ['simkl', 'Simkl'], ['mdblist', 'MDBList']]) {
    const dialog = await connect(name);
    await dialog.waitFor({ state: 'hidden', timeout: 20_000 });
    await region.getByText(`Connected as Personal ${kind}-1`, { exact: true }).waitFor();
    assert(connectionID((await read()).managedConnection('1', kind), realm));
  }
  assert.equal(await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).isDisabled(), true);
  const activity = page.locator('[aria-labelledby="sync-watch-title"]');
  await activity.getByRole('button', { name: 'Turn on', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sync watch activity for this profile?' })
    .getByRole('button', { name: 'Turn on', exact: true }).click();
  await activity.getByRole('button', { name: 'Turn off', exact: true }).waitFor();
  const enabled = await read();
  const consent = await enabled.watchActivity('1');
  for (const provider of ['trakt', 'simkl', 'mdblist']) {
    assert.equal(consent?.accounts[provider]?.binding, enabled.managedConnection('1', provider));
  }
  assert.equal(enabled.draft('1').preferences['progress.source'], 'LOCAL');
  assert.equal(enabled.draft('1').preferences['library.source'], 'LOCAL');
  await activity.getByRole('button', { name: 'Turn off', exact: true }).click();
  await activity.getByRole('button', { name: 'Turn on', exact: true }).waitFor();
  assert.equal(await (await read()).watchActivity('1'), null);
  console.log('Watch activity consent reached the native-format reader and could be turned off.');
  advanceWindow(); // Keep separate user journeys within the real production quotas.
  const before = (await read()).managedConnection('1', 'trakt');
  const cancel = await connect('Trakt', 'Switch account');
  await cancel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await cancel.waitFor({ state: 'hidden' });
  assert.equal((await read()).managedConnection('1', 'trakt'), before);
  await region.getByText('Connected as Personal trakt-1', { exact: true }).waitFor();

  // Commit on the server, then lose its reply. Retrying must reuse the grant.
  let dropped = 0;
  const loseReply = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    dropped++; await route.fetch(); await route.abort('failed');
  };
  await page.route('**/v2/snapshots/*', loseReply);
  const replacement = await connect('Trakt', 'Switch account');
  await replacement.getByRole('alert').waitFor();
  await page.unroute('**/v2/snapshots/*', loseReply);
  assert.equal(dropped, 2); // The transport also retries an identical commit once.
  await replacement.getByRole('button', { name: 'Retry save', exact: true }).click();
  await replacement.waitFor({ state: 'hidden' });
  await region.getByText('Connected as Personal trakt-3', { exact: true }).waitFor();
  assert.equal(fixture.starts.trakt, 3);
  assert(fixture.revoked.some(item => item.token === 'fixture-private-access-trakt-1'));
  assert.notEqual((await read()).managedConnection('1', 'trakt'), before);

  // A concurrent native account edit must not be overwritten by the browser.
  const concurrent = await connect('Trakt', 'Switch account');
  await writeNativePreference('integrations.traktConnection', 'disconnected', 5000);
  await concurrent.getByText('This account was changed on another device. Close and reload before trying again.', { exact: true }).waitFor();
  await concurrent.getByRole('button', { name: 'Close', exact: true }).click();
  await concurrent.waitFor({ state: 'hidden' });
  assert.equal((await read()).managedConnection('1', 'trakt'), 'disconnected');
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await region.getByRole('button', { name: 'Connect Trakt', exact: true }).waitFor();
  assert(fixture.revoked.some(item => item.token === 'fixture-private-access-trakt-4'));

  // If neither commit reached the server, Close preserves the current choice
  // and advances its cursor before removing the unused authorization.
  const blockCommit = route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue();
  await page.route('**/v2/snapshots/*', blockCommit);
  const abandoned = await connect('Trakt');
  await abandoned.getByRole('alert').waitFor();
  await page.unroute('**/v2/snapshots/*', blockCommit);
  await abandoned.getByRole('button', { name: 'Close', exact: true }).click();
  await abandoned.waitFor({ state: 'hidden' });
  assert.equal((await read()).managedConnection('1', 'trakt'), 'disconnected');
  assert(fixture.revoked.some(item => item.token === 'fixture-private-access-trakt-5'));
  advanceWindow();

  const progress = page.getByRole('combobox', { name: 'Watch progress', exact: true });
  await progress.selectOption('SIMKL');
  assert(await region.getByRole('button', { name: 'Connect Trakt', exact: true }).isDisabled());
  await region.getByText('Save or discard your setup changes before changing an account.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).click();
  await region.getByRole('button', { name: 'Connect Trakt', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Connect Trakt')?.disabled === false);

  await page.screenshot({ path: path.join(evidence, 'provider-accounts-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await region.screenshot({ path: path.join(evidence, 'provider-accounts-mobile.png') });
  await region.getByRole('button', { name: 'Disconnect Simkl', exact: true }).click();
  const disconnect = page.getByRole('dialog', { name: 'Disconnect Simkl?', exact: true });
  await disconnect.getByRole('button', { name: 'Disconnect on all devices', exact: true }).click();
  await disconnect.waitFor({ state: 'hidden' });
  assert.equal((await read()).managedConnection('1', 'simkl'), 'disconnected');
  await region.getByRole('button', { name: 'Connect Simkl', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Profile', exact: true }).selectOption('2');
  await region.getByRole('button', { name: 'Connect MDBList', exact: true }).waitFor();
  assert.equal((await read()).managedConnection('2', 'mdblist'), undefined);
  const final = (await read()).draft('1');
  assert.deepEqual(final.home, original.home); assert.deepEqual(final.addons, original.addons);
  assert.deepEqual(final.collections, original.collections);
  assert(!(await page.content()).includes('fixture-private-'));
  expireSession();
  await region.getByRole('button', { name: 'Connect MDBList', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with passkey', exact: true }).waitFor();
  assert.equal(await region.count(), 0);
  console.log('Provider accounts: all three logins, native readback, cancellation, replacement, lost commit reply, concurrent edit, dirty draft, profile isolation, disconnect and session expiry passed over HTTPS. Desktop/mobile checked.');
}
