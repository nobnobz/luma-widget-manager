// One disposable account on an explicitly selected Sync origin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { unwrapPasskeyMaster } from '../../src/lib/luma-sync/passkey.ts';
import { SyncTransport } from '../../src/lib/luma-sync/transport.ts';
import { SyncDocuments } from '../../src/lib/luma-sync/documents.ts';

const { LUMA_LIVE_ORIGIN: origin, LUMA_SOURCE, LUMA_TEST_OPERATOR } = process.env;
assert(origin && new URL(origin).origin === origin && origin.startsWith('https:') && LUMA_SOURCE && LUMA_TEST_OPERATOR);
const { authenticator } = await import(pathToFileURL(path.join(LUMA_SOURCE, 'sync-service/test/passkey-authenticator.js')));
const operator = input => JSON.parse(execFileSync(LUMA_TEST_OPERATOR, { input: JSON.stringify(input), timeout: 20_000, stdio: ['pipe', 'pipe', 'ignore'] }));
const prf = randomBytes(32);
const manifest = 'https://v3-cinemeta.strem.io/manifest.json';
const secondManifest = 'https://opensubtitles-v3.strem.io/manifest.json';
const testConfigured = process.env.LUMA_TEST_CONFIGURED_ADDONS === '1';
const testLocalDrafts = process.env.LUMA_TEST_LOCAL_DRAFTS === '1';
const personalHost = 'https://configured.luma-example.org';
const personalURL = variant => `${personalHost}/stremio/disposable-${variant}/manifest.json`;
const firstProfileName = 'Portal release smoke';
const copyProfileName = 'Copied public add-ons';
const blankProfileName = 'Blank test profile';
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
async function api(route, { method = 'GET', body, token } = {}) {
  const response = await fetch(origin + route, { method, headers: { 'User-Agent': ua, 'X-Luma-Sync-Transport': '2', 'X-Luma-Sync-History': '1',
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000) }).catch(error => { throw Error(`${method} ${route}: ${error.name}`); });
  if (!response.ok) throw Error(`${method} ${route}: HTTP ${response.status}`);
  return response.json();
}
const nativeDevice = randomUUID();
let browser, auth, spaceID, recovery, created = false, count = 0, nativeGrant, invitation;
async function nativeLogin() {
  const login = await api('/v1/passkeys/login/options', { method: 'POST', body: { deviceID: nativeDevice, deviceName: 'Portal release smoke' } });
  return api('/v1/passkeys/login/verify', { method: 'POST', body: { flowID: login.flowID, credential: auth.assertion(login.publicKey, { count: ++count }) } });
}

scenario: try {
  const info = await api('/v1/server');
  assert(info.widgetRegistration === 1 && info.widgetCatalogs === 1 && info.widgetEditor === 1 && info.widgetCatalogPreview === 1);
  assert(['open','invite'].includes(info.registration), 'Registration policy prevents creating a disposable smoke account.');
  if (info.registration === 'invite') invitation = operator({ action: 'invite' });
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, locale: 'en-US' });
  page.setDefaultTimeout(20_000);
  const personalRequests = new Set();
  let leakedLink = false;
  if (testConfigured) {
    await page.route(`${personalHost}/**`, async route => {
      const request = route.request(), headers = await request.allHeaders();
      assert.equal(headers.origin, 'null');
      for (const header of ['cookie', 'referer', 'authorization']) assert.equal(headers[header], undefined);
      personalRequests.add(request.url());
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { id: 'org.example.configured', name: 'Disposable configured add-on',
        catalogs: [{ id: 'private-films', type: 'movie', name: 'Private films' }] } });
    });
    page.on('request', request => {
      if (new URL(request.url()).origin === origin && request.postData()?.includes('/stremio/disposable-')) leakedLink = true;
    });
  }
  await page.exposeFunction('makeCredential', (challenge, id) => {
    spaceID = id; auth = authenticator(origin, id);
    return auth.registration({ challenge });
  });
  await page.exposeFunction('assertCredential', challenge => ({
    assertion: auth.assertion({ challenge }, { count: ++count }), prf: [...prf],
  }));
  await page.addInitScript(() => {
    const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0)).buffer;
    const convert = ({ response, ...raw }, prf) => ({ ...raw, rawId: decode(raw.rawId), getClientExtensionResults: () => ({ prf }),
      response: Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'transports').map(([key, value]) => [key, decode(value)])) });
    Object.defineProperty(navigator.credentials, 'create', { value: async ({ publicKey }) => {
      const raw = await window.makeCredential(encode(publicKey.challenge), new TextDecoder().decode(publicKey.user.id));
      return convert(raw, { enabled: true });
    } });
    Object.defineProperty(navigator.credentials, 'get', { value: async ({ publicKey }) => {
      const { assertion, prf } = await window.assertCredential(encode(publicKey.challenge));
      return convert(assertion, { results: { first: Uint8Array.from(prf).buffer } });
    } });
  });
  page.on('request', request => {
    if (request.url() === origin + '/v1/passkeys/editor/register/complete') recovery = request.postDataJSON()?.recoveryToken;
  });
  page.on('response', response => {
    if (response.url() === origin + '/v1/passkeys/editor/register/complete' && response.status() === 201) created = true;
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/widgets/sync/');
  assert.equal(await page.getByRole('link', { name: /admin/i }).count(), 0);
  await page.getByRole('button', { name: 'Create account' }).click();
  if (invitation) await page.getByLabel('Invitation code').fill(invitation.code);
  await page.getByLabel('First profile name').fill(firstProfileName);
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.getByRole('button', { name: 'Confirm passkey' }).click();
  const profilePicker = page.getByRole('combobox', { name: 'Profile', exact: true });
  await profilePicker.getByRole('option', { name: firstProfileName, exact: true }).waitFor({ state: 'attached' });
  assert(created && recovery && spaceID);
  console.log('Live test account created and signed in.');
  if (testLocalDrafts) {
    nativeGrant = await nativeLogin();
    assert.equal(nativeGrant.spaceID, spaceID);
    const master = await unwrapPasskeyMaster(nativeGrant.sealedSecrets, new Uint8Array(prf),
      new Uint8Array(Buffer.from(nativeGrant.prfSalt, 'base64url')), origin, spaceID, auth.id);
    const reader = new SyncTransport({ origin, spaceID, deviceID: nativeDevice, token: nativeGrant.deviceToken, master },
      () => assert.fail('Uncompressed fixture'), api);
    try {
      const read = () => reader.load(AbortSignal.timeout(45_000));
      const realm = await reader.realm();
      const before = await read();
      const current = baseline => new SyncDocuments(baseline, realm, nativeDevice).draft('1');
      const background = page.getByRole('combobox', { name: 'App background' });
      const save = page.getByRole('button', { name: 'Save to Luma Sync', exact: true });
      const openPreferences = () => page.getByRole('button', { name: 'Preferences', exact: true }).click();
      const signIn = async () => {
        await page.getByRole('button', { name: 'Sign in with passkey' }).click();
        await profilePicker.getByRole('option', { name: firstProfileName, exact: true }).waitFor({ state: 'attached' });
      };
      let writes = 0;
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === origin && ((request.method() === 'POST' && (/\/prepare$/.test(url.pathname) || url.pathname === '/v1/snapshots')) ||
            (request.method() === 'PUT' && url.pathname.startsWith('/v2/snapshots/')))) writes++;
      });
      await openPreferences();
      assert.equal(await background.inputValue(), 'Charcoal');
      await background.selectOption('Forest');
      await page.getByText('Draft secured on this browser', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(writes, 0);
      assert.equal((await read()).cursor, before.cursor);

      await page.clock.setFixedTime(new Date(Date.now() + 56 * 60_000));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.locator('.sync-expiry-desktop').filter({ hasText: 'Session ends in less than 5 minutes.' }).waitFor();
      await page.setViewportSize({ width: 390, height: 780 });
      await page.locator('.sync-expiry-mobile').filter({ hasText: 'Session ends in less than 5 minutes.' }).waitFor();
      await page.setViewportSize({ width: 1100, height: 850 });
      await page.clock.setFixedTime(new Date());
      console.log('Live session warning appeared at desktop and mobile widths with a simulated client clock.');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await signIn();
      await page.getByText('Draft restored. Review it and save when ready.', { exact: true }).waitFor();
      await openPreferences();
      assert.equal(await background.inputValue(), 'Forest');
      const restored = await read();
      assert.equal(restored.cursor, before.cursor);
      assert.equal(current(restored).preferences['appearance.background'], current(before).preferences['appearance.background']);
      assert.equal(writes, 0);
      console.log('Live browser reload and passkey sign-in restored the draft. No upload requests and no change to the Sync cursor.');

      await save.click();
      await page.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
      await page.getByRole('button', { name: 'Reload', exact: true }).isEnabled().then(async enabled => {
        if (!enabled) await page.locator('button:not([disabled])').filter({ hasText: /^Reload$/ }).waitFor();
      });
      const after = await read();
      assert(writes > 0);
      assert.notEqual(after.cursor, before.cursor);
      assert.equal(current(after).preferences['appearance.background'], 'Forest');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await signIn();
      await openPreferences();
      assert.equal(await background.inputValue(), 'Forest');
      assert(await save.isDisabled());
      assert.equal(await page.getByText('Draft restored. Review it and save when ready.', { exact: true }).count(), 0);
      console.log('Live explicit Save published the setting, verified by the independent native-format reader. The saved draft did not return on another reload.');
    } finally { reader.close(); }
    break scenario;
  }
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await page.getByRole('button', { name: 'Add public add-on' }).click();
  await page.getByLabel('Public manifest URL').fill(manifest);
  const catalogResponse = page.waitForResponse(r => r.url() === origin + '/v1/editor/catalogs');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const catalogReply = await (await catalogResponse).json();
  assert.equal(catalogReply.manifests[0].status, 'ok');
  assert(catalogReply.manifests[0].catalogs.some(c => c.name === 'Popular'));
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Add here', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add to Home' });
  await add.getByRole('button', { name: 'Widget', exact: true }).click();
  await add.getByRole('button', { name: 'Choose catalog', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search catalogs' }).fill('Cinemeta movie Popular');
  await page.getByRole('button', { name: /Popular.*movie.*Cinemeta/i }).click();
  await page.getByRole('button', { name: 'Preview Popular', exact: true }).click();
  const posters = page.locator('#home-selection .home-poster-grid');
  await posters.waitFor();
  assert(await posters.locator('img').first().evaluate(async image => {
    try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
  }), 'The live catalog poster should decode');
  await page.getByRole('button', { name: 'Actions for Popular', exact: true }).click();
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Ranking numbers' }).check();
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  const draftDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  const discard = draftDialog.getByRole('button', { name: 'Discard and reload' });
  await discard.waitFor();
  assert.deepEqual(await discard.evaluate(el => {
    const css = getComputedStyle(el);
    return [css.borderTopWidth, el.getBoundingClientRect().height];
  }), ['1px', 44]);
  await draftDialog.getByRole('button', { name: 'Keep editing' }).click();
  await draftDialog.waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Tracking', exact: true }).click();
  await page.getByText('Library', { exact: true }).click();
  const layout = page.getByRole('region', { name: 'Library rows' });
  await layout.getByRole('button', { name: 'Reorder Watchlist', exact: true }).press('ArrowUp');
  await layout.getByRole('checkbox', { name: 'Show More Libraries', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Choose catalog', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search catalogs' }).fill('Cinemeta movie Popular');
  await page.getByRole('button', { name: /Popular.*movie.*Cinemeta/i }).click();
  await page.getByRole('button', { name: "Remove catalog" }).waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const dark = page.getByRole('button', { name: 'Dark', exact: true });
  await dark.click();
  await dark.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const settingsSearch = page.getByRole('searchbox', { name: 'Search settings' });
  await settingsSearch.fill('tmdb language');
  await page.keyboard.press('Tab');
  await settingsSearch.focus();
  assert.deepEqual(await settingsSearch.evaluate(el => {
    const css = getComputedStyle(el);
    return [el.matches(':focus-visible'), css.outlineWidth, css.outlineOffset, css.boxShadow, css.borderTopColor];
  }), [true, '2px', '-2px', 'none', 'rgba(0, 0, 0, 0)']);
  await page.screenshot({ path: 'build/evidence/luma-portal-focus-live-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.getByRole('combobox', { name: 'TMDB language' }).selectOption('de');
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show Stream Details' }).uncheck();
  const badgeSize = page.getByRole('combobox', { name: 'Badge Size' });
  assert.notEqual(await badgeSize.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
  await badgeSize.selectOption('LARGE');
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  const sample = page.getByLabel('Pack preview').getByRole('img').first();
  await sample.waitFor();
  await sample.scrollIntoViewIfNeeded();
  await sample.evaluate(img => img.decode());
  console.log('Live UME badge image loaded in the preview.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Import formatter pack').setInputFiles({ name: 'release-test.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ filters: [{ name: 'HDR', pattern: 'HDR', tagColor: '#336699', tagStyle: 'outline' }] })) });
  await page.getByLabel('Pack preview').getByText('HDR', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add pack' }).click();
  await page.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await page.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
  console.log('Live browser draft saved.');
  const saveSetup = async () => {
    await page.getByRole('button', { name: 'Save to Luma Sync' }).click();
    await page.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
  };
  const addonCard = label => page.locator('.sync-addon').filter({ has: page.getByText(label, { exact: true }) });
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await page.getByRole('button', { name: 'Add public add-on' }).click();
  await page.getByLabel('Public manifest URL').fill(secondManifest);
  await page.getByLabel('Add-on name').fill('OpenSubtitles');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await addonCard('OpenSubtitles').getByRole('checkbox', { name: 'Enabled' }).uncheck();
  await saveSetup();
  async function createProfile(name, source) {
    await page.getByRole('button', { name: 'Manage profiles' }).click();
    await page.getByRole('button', { name: 'Create profile', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create profile', exact: true });
    await dialog.getByLabel('Profile name').fill(name);
    await dialog.getByLabel('Copy public add-ons from').selectOption(source);
    if (source) await dialog.getByLabel('Avatar', { exact: true }).selectOption('artwork:finn');
    await dialog.getByRole('button', { name: 'Create profile', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Profile saved to Luma Sync.' }).waitFor();
    assert.equal(await profilePicker.locator('option:checked').textContent(), name);
  }
  await createProfile(copyProfileName, '1');
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  assert.equal(await addonCard(new URL(manifest).hostname).getByRole('checkbox', { name: 'Enabled' }).isChecked(), true);
  assert.equal(await addonCard('OpenSubtitles').getByRole('checkbox', { name: 'Enabled' }).isChecked(), false);
  // Change only the copy, then verify both lists independently after sign-in.
  await addonCard('OpenSubtitles').getByRole('checkbox', { name: 'Enabled' }).check();
  await saveSetup();
  await createProfile(blankProfileName, '');
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await page.getByText('No public add-ons in this profile.', { exact: true }).waitFor();
  console.log('Live profile creation: named first profile, copy with two ordered public add-ons and their enabled state, independent edit, and blank profile passed.');
  if (testConfigured) {
    const panel = page.getByRole('region', { name: 'Configured add-ons', exact: true });
    await panel.getByRole('button', { name: 'Add configured add-on', exact: true }).click();
    await panel.getByLabel('Configured add-on name').fill('Disposable configured add-on');
    await panel.getByLabel('Personal manifest URL').fill(personalURL('original'));
    await panel.getByRole('button', { name: 'Add to profile', exact: true }).click();
    await panel.getByText('1 catalog available', { exact: true }).waitFor();
    await saveSetup();
    await panel.getByRole('button', { name: 'Edit Disposable configured add-on', exact: true }).click();
    await panel.getByLabel('Personal manifest URL').fill(personalURL('replacement'));
    await panel.getByRole('button', { name: 'Apply add-on changes', exact: true }).click();
    await panel.getByText('1 catalog available', { exact: true }).waitFor();
    await saveSetup();
    assert.deepEqual([...personalRequests].sort(), [personalURL('original'), personalURL('replacement')].sort());
    assert.equal(leakedLink, false);
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await profilePicker.getByRole('option', { name: copyProfileName, exact: true }).waitFor({ state: 'attached' });
  await profilePicker.getByRole('option', { name: blankProfileName, exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Sign out' }).click();
  nativeGrant = await nativeLogin();
  assert.equal(nativeGrant.spaceID, spaceID);
  const master = await unwrapPasskeyMaster(nativeGrant.sealedSecrets, new Uint8Array(prf),
    new Uint8Array(Buffer.from(nativeGrant.prfSalt, 'base64url')), origin, spaceID, auth.id);
  const reader = new SyncTransport({ origin, spaceID, deviceID: nativeDevice, token: nativeGrant.deviceToken, master }, () => assert.fail('Uncompressed fixture'), api);
  const setup = new SyncDocuments(await reader.load(AbortSignal.timeout(45_000)), await reader.realm(), nativeDevice);
  if (testConfigured) {
    await setup.unlockConfiguredAddons(master);
    assert.deepEqual(setup.draft('1').configuredAddons, []);
    assert.deepEqual(setup.draft('2').configuredAddons, []);
    assert.deepEqual(setup.draft('3').configuredAddons?.map(row => row.manifestURL), [personalURL('replacement')]);
    console.log('Live configured add-ons: direct sandboxed fetch, add and replace, encrypted readback and profile isolation passed.');
  }
  const native = setup.draft('1');
  reader.close();
  assert.deepEqual(setup.profiles.map(({ name, avatar, inheritsAddons }) => [name, avatar, inheritsAddons]),
    [[firstProfileName, '', false], [copyProfileName, 'artwork:finn', false], [blankProfileName, '', false]]);
  const addonState = draft => draft.addons.map(({ manifestURL, enabled, order }) => [manifestURL, enabled, order]);
  assert.deepEqual(addonState(native), [[manifest, true, 0], [secondManifest, false, 1]]);
  assert.deepEqual(addonState(setup.draft('2')), [[manifest, true, 0], [secondManifest, true, 1]]);
  assert.deepEqual(addonState(setup.draft('3')), []);
  assert.equal(native.home[0].source.catalogID, 'top');
  assert.equal(native.home[0].widget.showRanking, true);
  assert.equal(native.preferences['library.shelf.sources'], false);
  assert.equal(native.preferences['library.shelf.order'], 'watchlist,calendar,recentlyWatched,forYou,becauseYouWatched,pinned,sources');
  assert.equal(native.home[0].source.addonID, 'com.linvo.cinemeta');
  assert.equal(native.formatter[0].filters[0].name, 'HDR');
  assert.equal(native.preferences['playback.formatter.showDetails'], false);
  assert.equal(native.preferences['playback.formatter.size'], 'LARGE');
  assert.equal(native.preferences['metadata.language'], 'de');
  assert.deepEqual(JSON.parse(native.preferences['library.shelf.pinnedList']).source.addon, {
    manifestURL: manifest, type: 'movie', catalogID: 'top', paginated: false,
  });
  console.log('Live HTTPS: browser passkey registration, returning sign-in, Cinemeta catalog discovery and search, live catalog posters, Home ranking, Library order and visibility, custom Library row, UME images, formatter presentation, TMDB language, publication and native-format readback passed.');
} finally {
  await browser?.close();
  try {
    if (created && recovery && auth) {
      nativeGrant ??= await nativeLogin();
      assert.equal(nativeGrant.spaceID, spaceID);
      await api('/v1/space', { method: 'DELETE', body: { recoveryToken: recovery }, token: nativeGrant.deviceToken });
      console.log('Disposable account removed.');
    }
  } finally {
    if (invitation) {
      operator({ action: 'remove', id: invitation.id });
      console.log('Disposable invitation removed.');
    }
  }
}
