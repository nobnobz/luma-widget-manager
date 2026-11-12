// Local cross-repository acceptance with synthetic credentials. The real service,
// HTTPS ingress and Chrome run; only the OS passkey provider is simulated.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { unwrapPasskeyMaster } from '../../src/lib/luma-sync/passkey.ts';
import { SyncTransport } from '../../src/lib/luma-sync/transport.ts';
import { SyncDocuments, collectionHomeID, collectionSource } from '../../src/lib/luma-sync/documents.ts';
import { parseDocument } from '../../src/lib/luma-document.ts';
import { readHomeFile } from '../../src/lib/luma-sync/home-files.ts';
import { base64, derive, join, json, seal, utf8 } from '../../src/lib/luma-sync/wire.ts';
import { ConfiguredAddonCipher, configuredID, configuredPrefix } from '../../src/lib/luma-sync/configured-addons.ts';
import { providerConnectionsSmoke, providerFixture } from './provider-connections-smoke.mjs';

assert(process.env.LUMA_SOURCE && process.env.LUMA_CADDY && process.env.TMPDIR,
  'Run via with-external-cache.sh with LUMA_SOURCE and LUMA_CADDY set');
const fromLuma = file => import(pathToFileURL(path.join(process.env.LUMA_SOURCE, file)).href);
const { createService } = await fromLuma('sync-service/src/service.js');
const { authenticator } = await fromLuma('sync-service/test/passkey-authenticator.js');
const { fetchCatalogJSON } = await fromLuma('sync-service/src/editor-catalogs.js');
const root = path.resolve(process.env.LUMA_TEST_PACKAGE_DIR ?? 'build/sync-editor');
const configuredTools = process.env.NEXT_PUBLIC_LUMA_CONFIGURED_ADDONS !== 'off';
const evidenceRoot = path.resolve('build/evidence');
const evidence = path.resolve(evidenceRoot, process.env.LUMA_TEST_EVIDENCE_DIR ?? '.');
assert(evidence === evidenceRoot || evidence.startsWith(evidenceRoot + path.sep));
await fs.mkdir(evidence, { recursive: true });
const workspace = await fs.mkdtemp(path.join(process.env.TMPDIR, 'widget-editor-smoke-'));
const port = Number(process.env.LUMA_WIDGET_TEST_PORT || 18443);
const origin = `https://localhost:${port}`;
const spaceID = randomUUID(), deviceID = randomUUID(), master = randomBytes(32), owner = randomBytes(32), prf = randomBytes(32);
const adminToken = randomBytes(32).toString('base64url');
let serviceClockOffset = 0;
const testConnections = process.env.LUMA_TEST_CONNECTIONS_ONLY === '1';
const connectionFixture = providerFixture();
const service = createService({ origin, browserEditor: true, trustedProxyCIDRs: ['127.0.0.1/32'], port: 0, dataDir: path.join(workspace, 'data'),
  adminToken, adminPasswordLogin: true, serverSecret: randomBytes(32), inviteSecret: randomBytes(32).toString('base64url'),
  ...(testConnections ? { traktClientID: 'fixture-client', traktClientSecret: 'fixture-secret', simklClientID: 'fixture-client', mdbListClientID: 'fixture-client' } : {}) }, {
  ...(testConnections ? { fetchTracker: connectionFixture.fetch, fetchMdbList: connectionFixture.fetch } : {}),
  now: () => Date.now() + serviceClockOffset, fetchPublicManifest: async url => {
    if (url === 'https://v3-cinemeta.strem.io/manifest.json') return fetchCatalogJSON(url, AbortSignal.timeout(5000));
    assert.equal(url, 'https://catalog.luma-example.org/manifest.json');
    return { id: 'org.example.catalog', name: 'Sample Catalogs', catalogs: [
      { id: 'discovered', type: 'movie', name: 'Automatically discovered' },
      { id: 'trending', type: 'movie', name: 'Trending now' },
    ] };
  }, fetchPublicCatalog: async url => {
    if (url === 'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json') return fetchCatalogJSON(url, AbortSignal.timeout(5000));
    assert.equal(url, 'https://catalog.luma-example.org/catalog/movie/trending.json');
    return { metas: [{ name: 'The acceptance test movie', poster: 'https://images.metahub.space/poster/small/tt0133093/img' }] };
  } });
let caddy, browser, page, account;
const signInTrace = [];
scenario: try {
  const { port } = await service.listen();
  const backend = `http://127.0.0.1:${port}`;
  async function api(route, { method = 'GET', body, token } = {}) {
    const headers = { 'X-Luma-Client-IP': '198.51.100.20', 'X-Luma-Sync-Transport': '2', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch(backend + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await response.json();
    assert(response.ok, `${method} ${route}: ${response.status} ${json.error || ''}`);
    return json;
  }
  const invite = await api('/v1/admin/invitations', { method: 'POST', token: adminToken, body: { label: 'Synthetic smoke test', expiresIn: 3600, maxUses: 1 } });
  const auth = authenticator(origin, spaceID);
  const setup = await api('/v1/passkeys/register/options', { method: 'POST', body: { invite: invite.code, spaceID, deviceID, deviceName: 'Test Mac' } });
  const registration = await api('/v1/passkeys/register/verify', { method: 'POST', body: { flowID: setup.flowID, credential: auth.registration(setup.publicKey) } });
  const aad = utf8.encode(`luma-sync-passkey-wrap-v1:${origin}:${spaceID}:${auth.id}`);
  const sealedSecrets = base64(await seal(join([new Uint8Array(master), new Uint8Array(owner)]),
    await derive(new Uint8Array(prf), new Uint8Array(Buffer.from(setup.prfSalt, 'base64url')), aad), aad), true);
  const { deviceToken } = await api('/v1/passkeys/register/complete', { method: 'POST', body: { flowID: registration.flowID,
    credential: auth.assertion(registration.publicKey), sealedSecrets, recoveryToken: randomBytes(32).toString('base64url') } });

  // Seed a regular native-writer publication. Native prepare/commit has no
  // browser cursor, and the native reader verifies the saved browser document.
  const native = new SyncTransport({ origin, spaceID, deviceID, token: deviceToken, master: new Uint8Array(master) },
    () => assert.fail('Synthetic fixture is not compressed'), (route, options) => {
      const body = options?.body && { ...options.body };
      if (body) delete body.expectedCursor;
      return api(route, { ...options, body });
    });
  const wire = value => base64(json(value));
  function envelope(profileID, domain, data, counter) {
    return { stamp: { counter, device: deviceID }, value: wire({ schemaVersion: 2, profileID, domain,
      modifiedAt: '2026-01-01T00:00:00Z', deviceID, data: wire(data) }) };
  }
  const prefix = 'apple.kvs.sync.v2', addonKey = `${prefix}.1.addons`;
  const settingsKey = `${prefix}.1.commonSettings.v1`;
  const nativeFields = { 'library.shelf.order': { revision: 1, deviceID, value: 'watchlist,future,calendar' } };
  const personalOrigin = 'https://configured.luma-example.org';
  const personalURL = variant => `${personalOrigin}/stremio/fixture-${variant}/manifest.json`;
  const seeded = { id: await configuredID(personalURL('native')), manifestURL: personalURL('native'), name: 'Native AIOMetadata', enabled: true, order: 0 };
  const configuredCipher = new ConfiguredAddonCipher(new Uint8Array(master), await native.realm());
  nativeFields[configuredPrefix + seeded.id] = { revision: 1, deviceID, value: await configuredCipher.seal('1', seeded, 1, deviceID) };
  const addon = { id: 'https://catalog.luma-example.org/manifest.json', manifestURL: 'https://catalog.luma-example.org/manifest.json', name: 'Sample Catalogs', enabled: true, order: 0 };
  const migrated = Array.from({ length: 543 }, (_, position) => {
    const id = `migrated-${position}`, title = `Migrated row ${position + 1}`;
    return [id, { stamp: { counter: 1, device: deviceID }, row: wire({ id, title, position, enabled: position % 25 === 0,
      source: { addonID: 'org.example.catalog', mediaType: 'movie', catalogID: `row-${position + 1}`, collectionID: '' }, extras: {} }) }];
  });
  const umeInputs = [
    ['lists', 'Lists'], ['collections', 'Collections'], ['people', 'Actors'], ['people', 'Directors'],
  ].map(([group, name]) => path.join(evidenceRoot, `ume-v4-${group}`, `UME-v4-${name}-Luma.json`));
  const verifyUME = process.env.LUMA_TEST_UME === '1';
  const ume = verifyUME ? { id: 'ume-discover-copy', title: 'Discover', folders: (await Promise.all(umeInputs.map(file => fs.readFile(file, 'utf8'))))
    .flatMap(text => parseDocument(text).document.collections.flatMap(hub => hub.folders)) } : null;
  const coverBoard = { id: 'cover-board', title: 'Cover board', folders: [
    'Watchlist', 'Trending Movies', 'Trending Shows', 'Latest Movies', 'Latest Shows', 'Airing Soon', 'Upcoming',
  ].map((title, index) => ({ id: `cover-${index}`, title, tileShape: 'LANDSCAPE',
    coverImageUrl: `https://i.postimg.cc/luma-ux-fixture/${index}.svg`, sources: [
      { id: 'catalog-' + index, title, provider: 'addon', addonId: 'com.linvo.cinemeta', type: 'movie', catalogId: 'top' },
    ],
  })) };
  const stamp = { counter: 1, device: deviceID };
  const profile = (id, name, usesPrimaryAddons = false) => ({ id, name, usesPrimaryAddons,
    avatar: '', isPinProtected: false, isAdmin: id === '1', usesPrimaryPlugins: true });
  const reg = value => ({ value, stamp });
  const cine = { addonID: 'com.linvo.cinemeta', mediaType: 'movie', catalogID: 'top', collectionID: '' };
  const legacyID = ['catalog', cine.addonID, cine.mediaType, cine.catalogID, ''].map(value => `${Buffer.byteLength(value)}:${value}`).join('');
  const nativeSnapshot = { schema: 1, platform: 'macos', realm: await native.realm(), device: deviceID, records: {
    [`${prefix}.__account__.profile`]: envelope('__account__', 'profile', { profiles: [
      profile('1', 'Test profile', true), profile('2', 'Empty profile'), profile('3', 'Migrated profile'),
      ...(ume ? [profile('4', 'UME acceptance copy')] : []), profile('5', 'Inherited add-ons', true), profile('6', 'Mixed add-ons'),
    ] }, 1),
    [addonKey]: envelope('1', 'addons', [addon], 2),
    [`${prefix}.6.addons`]: envelope('6', 'addons', [addon, { ...addon, manifestURL: 'https://media.local./manifest.json' }], 2),
    ...(ume ? {
      [`${prefix}.6.collections.v2`]: envelope('6', 'collections.v2', { version: 2, migratedPlatforms: ['macos'], entries: {
        [coverBoard.id]: { stamp, row: wire(coverBoard) },
      } }, 8),
      [`${prefix}.6.homeContent.v1`]: envelope('6', 'homeContent.v1', { version: 1, entries: {
        [collectionHomeID(coverBoard.id).slice('collection:'.length)]: { source: collectionSource(coverBoard.id), title: reg(''), enabled: reg(true), position: reg(0) },
      } }, 9),
      [`${prefix}.4.addons`]: envelope('4', 'addons', [{
        id: cine.addonID, manifestURL: 'https://v3-cinemeta.strem.io/manifest.json', name: 'Cinemeta', enabled: true, order: 0,
      }], 4),
      [`${prefix}.4.collections.v2`]: envelope('4', 'collections.v2', { version: 2, migratedPlatforms: ['macos'], entries: {
        [ume.id]: { stamp, row: wire(ume) },
      } }, 5),
      [`${prefix}.4.homeContent.v1`]: envelope('4', 'homeContent.v1', { version: 1, entries: {
        [collectionHomeID(ume.id).slice('collection:'.length)]: { source: collectionSource(ume.id), title: reg(''), enabled: reg(true), position: reg(0) },
        [legacyID]: { source: cine, title: reg(''), enabled: reg(true), position: reg(1) },
      } }, 6),
      [`${prefix}.4.homeWidgets.v1`]: envelope('4', 'homeWidgets.v1', { version: 2, migratedPlatforms: ['macos'], entries: Object.fromEntries([
        ['ume-movie-widget', { stamp, row: wire({ id: 'ume-movie-widget', title: '', enabled: true, position: 2, source: cine, extras: {} }) }],
        ['ume-series-widget', { stamp, row: wire({ id: 'ume-series-widget', title: '', enabled: true, position: 3,
          source: { ...cine, mediaType: 'series' }, extras: {} }) }],
      ]) }, 7),
    } : {}),
    [settingsKey]: envelope('1', 'commonSettings.v1', { fields: nativeFields }, 3),
    [`${prefix}.3.homeWidgets.v1`]: envelope('3', 'homeWidgets.v1', { version: 2, entries: Object.fromEntries(migrated), migratedPlatforms: ['macos'] }, 4),
    [`${prefix}.1.collections.v2`]: envelope('1', 'collections.v2', { version: 2, migratedPlatforms: ['macos'], entries: {
      'genres': { stamp: { counter: 1, device: deviceID }, row: wire({ id: 'genres', title: 'Genres', folders: [
        { id: 'films', title: 'Films', tileShape: 'POSTER', coverImageUrl: 'https://art.example.test/cover.png',
          sections: [{ id: 'discover', title: 'Discover', folders: [{ id: 'genres-folder', title: 'Genres folder',
            subfolders: [{ id: 'thriller', title: 'Thriller' }, { id: 'hidden', title: 'Hidden folder', homeEnabled: false }] }] }],
          sources: [{ id: 'trending', provider: 'addon', title: 'Trending now', addonId: 'org.example.catalog', type: 'movie', catalogId: 'trending' }],
          blockOrder: ['section:discover', 'catalog:trending'],
        },
        { id: 'docs', title: 'Documentaries', coverImageUrl: 'https://art.example.test/missing.png' },
      ] }) },
    } }, 3),
  } };
  const signal = AbortSignal.timeout(20_000);
  await native.publish(nativeSnapshot, { ...await native.load(signal), modern: true }, signal);
  const fixture = new SyncDocuments(await native.load(signal), await native.realm(), randomUUID());
  await fixture.unlockConfiguredAddons(new Uint8Array(master));
  assert.equal(fixture.draft('1').addons[0].name, addon.name);
  if (ume) assert.equal(fixture.draft('6').collections[0].folders.length, 7);
  async function writeNativePreference(key, value, revision) {
    nativeFields[key] = { revision, deviceID, value };
    const signal = AbortSignal.timeout(20_000);
    await native.publish({ ...nativeSnapshot, records: {
      ...nativeSnapshot.records, [settingsKey]: envelope('1', 'commonSettings.v1', { fields: nativeFields }, revision + 10),
    } }, await native.load(signal), signal);
  }

  const certificate = path.join(workspace, 'certificate.pem'), privateKey = path.join(workspace, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', privateKey, '-out', certificate], { stdio: 'ignore' });
  const include = (await fs.readFile(path.join(root, 'widgets.caddy'), 'utf8')).replace('/etc/caddy/widget-editor/site', `"${path.join(root, 'site')}"`);
  const caddyfile = path.join(workspace, 'Caddyfile');
  await fs.writeFile(caddyfile, `{\n admin off\n auto_https disable_redirects\n}\n${origin} {\n bind 127.0.0.1\n tls "${certificate}" "${privateKey}"\n${include}\n @admin path /admin /admin/* /v1/admin/*\n reverse_proxy @admin ${backend} {\n  header_up X-Luma-Client-IP 198.51.100.21\n }\n reverse_proxy ${backend} {\n  header_up X-Luma-Client-IP 198.51.100.22\n }\n}\n`);
  const caddyEnv = { ...process.env, LUMA_PUBLIC_ORIGIN: origin, XDG_DATA_HOME: workspace, XDG_CONFIG_HOME: workspace };
  execFileSync(process.env.LUMA_CADDY, ['adapt', '--config', caddyfile], { env: caddyEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  caddy = spawn(process.env.LUMA_CADDY, ['run', '--config', caddyfile], { env: caddyEnv, stdio: 'ignore' });

  browser = await chromium.launch({ channel: 'chrome' });
  page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(12_000);
  page.on('response', response => {
    const { origin: target, pathname } = new URL(response.url());
    if (target === origin && pathname.startsWith('/v1/passkeys/editor/')) signInTrace.push([pathname, response.status()]);
  });
  await page.route('https://i.postimg.cc/luma-ux-fixture/*.svg', route => {
    const index = Number(new URL(route.request().url()).pathname.match(/(\d+)\.svg$/)?.[1]);
    const label = coverBoard.folders[index]?.title ?? 'Folder';
    const colors = ['#7a2b2c', '#224074', '#224074', '#215147', '#215147', '#85600f', '#85600f'];
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="${colors[index]}"/><path d="M0 180 152 36l68 80 100-42v106z" fill="#ffffff" fill-opacity=".1"/><text x="160" y="97" text-anchor="middle" fill="white" font-family="sans-serif" font-size="23" font-weight="700">${label}</text></svg>` });
  });
  const faults = [];
  let artRequests = 0;
  const personalRequests = new Set();
  await page.route(`${personalOrigin}/**`, async route => {
    const request = route.request(), headers = await request.allHeaders();
    assert.equal(headers.origin, 'null');
    for (const header of ['cookie', 'referer', 'authorization']) assert.equal(headers[header], undefined);
    personalRequests.add(request.url());
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { id: 'org.example.configured', name: 'Configured Fixture',
      catalogs: [{ id: 'private-films', type: 'movie', name: 'Private films' }] } });
  });
  page.on('request', request => {
    if (new URL(request.url()).origin === origin) assert(!request.postData()?.includes('/stremio/fixture-'));
  });
  await page.route('https://art.example.test/**', async route => {
    artRequests++;
    assert.equal(route.request().headers().referer, undefined);
    if (route.request().url().endsWith('missing.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: 'not an image' });
    return route.fulfill({ path: 'public/luma-icon-16.png', contentType: 'image/png' });
  });
  page.on('pageerror', error => faults.push(error.name));
  page.on('response', response => {
    if (response.request().isNavigationRequest() && new URL(response.url()).origin === origin && response.status() >= 400)
      console.log('HTTPS fixture navigation:', new URL(response.url()).pathname, response.status());
  });
  let expectedExpiry = false, browserSignCount = 1;
  page.on('console', item => {
    if (item.type() !== 'error') return;
    if (expectedExpiry && item.location().url === origin + '/v1/snapshots' && item.text().includes('401')) {
      expectedExpiry = false;
      return;
    }
    faults.push(`${item.location().url}: ${item.text()}`);
  });
  let browserAssertion = challenge => auth.assertion({ challenge }, { count: ++browserSignCount });
  await page.exposeFunction('testAssertion', challenge => ({ assertion: browserAssertion(challenge), prf: [...prf] }));
  async function expireDuringSave() {
    expectedExpiry = true;
    serviceClockOffset += 3_601_000;
    await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).click();
    await page.getByText('Session ended. Sign in with the same account to recover your draft.', { exact: true }).waitFor();
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator.credentials, 'get', { value: async ({ publicKey }) => {
      const challenge = btoa(String.fromCharCode(...new Uint8Array(publicKey.challenge))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const { assertion, prf } = await window.testAssertion(challenge);
      const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)).buffer;
      return { ...assertion, rawId: decode(assertion.rawId), response: Object.fromEntries(Object.entries(assertion.response).map(([key, value]) => [key, decode(value)])),
        getClientExtensionResults: () => ({ prf: { results: { first: Uint8Array.from(prf).buffer } } }) };
    } });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/widgets/sync/');
  assert.equal(await page.getByRole('link', { name: /admin/i }).count(), 0);
  await page.getByRole('button', { name: 'Sign in with passkey' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-copy-sign-in.png') });
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  const profilePicker = page.getByRole('combobox', { name: 'Profile' });
  if (testConnections) {
    await providerConnectionsSmoke({ page, native, evidence, fixture: connectionFixture, writeNativePreference,
      expireSession: () => { serviceClockOffset += 3_600_000; }, advanceWindow: () => { serviceClockOffset += 61_000; } });
    break scenario;
  }
  const appBackground = page.getByLabel('App background').and(page.locator('select'));
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  const addonPanel = page.getByRole('region', { name: /^(?:public )?add-ons$/i });
  const configuredPanel = page.getByRole('region', { name: 'Configured add-ons', exact: true });
  await profilePicker.selectOption('5');
  await addonPanel.getByText('From the primary profile', { exact: true }).waitFor();
  await addonPanel.getByText(addon.name, { exact: true }).waitFor();
  assert.equal(await addonPanel.getByRole('button', { name: 'Remove' }).count(), 0);
  if (configuredTools) {
    await configuredPanel.getByText(seeded.name, { exact: true }).waitFor();
    await configuredPanel.getByText('1 catalog available', { exact: true }).waitFor();
    assert.equal(await configuredPanel.getByRole('button', { name: 'Edit ' + seeded.name }).count(), 0);
    assert(personalRequests.has(seeded.manifestURL));
    await profilePicker.selectOption('6');
    await addonPanel.getByText('Some synced entries could not be read.', { exact: false }).waitFor();
    await addonPanel.getByText(addon.name, { exact: true }).waitFor();
    assert.equal(await addonPanel.getByText('media.local', { exact: false }).count(), 0);
    assert.equal(await addonPanel.getByRole('button', { name: 'Remove' }).count(), 0);
    assert.equal(await configuredPanel.getByText(seeded.name, { exact: true }).count(), 0);
    await configuredPanel.getByRole('button', { name: 'Add configured add-on' }).click();
    await configuredPanel.getByLabel('Configured add-on name').fill('Web AIOStreams');
    await configuredPanel.getByLabel('Personal manifest URL').fill(personalURL('web'));
    await configuredPanel.getByRole('button', { name: 'Add to profile' }).click();
    await configuredPanel.getByText('1 catalog available', { exact: true }).waitFor();
    const savePersonal = page.getByRole('button', { name: 'Save to Luma Sync', exact: true });
    await savePersonal.click();
    await savePersonal.waitFor({ state: 'visible' });
    await configuredPanel.getByRole('button', { name: 'Edit Web AIOStreams' }).click();
    await configuredPanel.getByLabel('Personal manifest URL').fill(personalURL('replacement'));
    await configuredPanel.getByRole('button', { name: 'Apply add-on changes' }).click();
    await configuredPanel.getByText('1 catalog available', { exact: true }).waitFor();
    await savePersonal.click();
    await page.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
    const personalReadback = new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), randomUUID());
    await personalReadback.unlockConfiguredAddons(new Uint8Array(master));
    assert.deepEqual(personalReadback.draft('6').configuredAddons?.map(row => row.manifestURL), [personalURL('replacement')]);
    assert.deepEqual(personalReadback.draft('1').configuredAddons, [seeded]);
    assert(personalRequests.has(personalURL('replacement')));
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Add here', exact: true }).click();
    const addHome = page.getByRole('dialog', { name: 'Add to Home', exact: true });
    const widgetChoice = addHome.getByRole('button', { name: 'Widget', exact: true });
    if (await widgetChoice.count()) await widgetChoice.click();
    else await addHome.getByLabel('Add', { exact: true }).selectOption('catalog');
    await addHome.getByRole('button', { name: 'Choose catalog', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search catalogs' }).fill('Private films');
    await page.getByText('Private films', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    console.log('Configured add-ons: encrypted profile readback, inherited list, add and replace, and direct browser manifest fetch passed.');
    if (process.env.LUMA_TEST_CONFIGURED_ADDONS_ONLY === '1') {
      assert.deepEqual(faults, []);
      break scenario;
    }
  } else {
    assert.equal(await configuredPanel.count(), 0);
    assert.equal(await page.locator('iframe[src*="configured-manifest-reader"]').count(), 0);
    assert.equal(personalRequests.size, 0);
    await profilePicker.selectOption('6');
    await addonPanel.getByText('Some synced entries could not be read.', { exact: false }).waitFor();
    assert.equal(await addonPanel.getByText('media.local', { exact: false }).count(), 0);
  }
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await profilePicker.selectOption('2');
  await addonPanel.getByText('No add-on list has synced from this profile yet.', { exact: false }).waitFor();
  if (configuredTools) await configuredPanel.getByText('No configured add-ons have synced from this profile yet.', { exact: true }).waitFor();
  assert.equal(await addonPanel.getByText(addon.name, { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  console.log('Profile add-on inheritance, incompatible records and missing lists passed.');
  await page.getByText('Nothing here yet.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Preview Home' }).click();
  await page.getByText('Nothing visible here yet.').waitFor();
  await page.keyboard.press('Escape');
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const homePath = page.getByRole('navigation', { name: 'Home location' });
  const homeLevel = page.getByTestId('home-current-level');
  const homeTask = name => page.getByRole('dialog', { name, exact: true });
  async function action(label, command) {
    await button('Actions for ' + label).click();
    await button(command).click();
  }
  await button('Add here').click();
  await homeTask('Add to Home').getByRole('textbox', { name: 'Name' }).fill('Discarded folder row');
  await button('Create folder row').click();
  await button('Open Discarded folder row').waitFor();
  await profilePicker.selectOption('1');
  const draftDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  const discard = draftDialog.getByRole('button', { name: 'Discard and switch' });
  const keep = draftDialog.getByRole('button', { name: 'Keep editing' });
  const saveAndSwitch = draftDialog.getByRole('button', { name: 'Save and switch' });
  await draftDialog.waitFor();
  assert.equal(await discard.evaluate(el => getComputedStyle(el).borderTopWidth), '1px');
  const actionHeights = await Promise.all([discard, keep, saveAndSwitch].map(item => item.evaluate(el => el.getBoundingClientRect().height)));
  assert(actionHeights.every(height => height >= 44 && height === actionHeights[0]));
  await page.keyboard.press('Tab');
  await discard.focus();
  const draftFocus = await discard.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.outlineWidth, style.outlineOffset, style.boxShadow, style.borderTopColor];
  });
  assert.deepEqual(draftFocus, ['2px', '-2px', 'none', 'rgba(0, 0, 0, 0)']);
  await keep.click();
  await draftDialog.waitFor({ state: 'hidden' });
  assert.equal(await profilePicker.inputValue(), '2');
  await page.waitForFunction(() => document.querySelector('.sync-controls select') === document.activeElement);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await draftDialog.getByText('Reloading replaces this draft', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  await draftDialog.waitFor({ state: 'hidden' });
  await button('Open Discarded folder row').waitFor();
  await profilePicker.selectOption('1');
  await draftDialog.getByRole('button', { name: 'Discard and switch' }).click();
  await profilePicker.locator('option[value="1"]:checked').waitFor({ state: 'attached' });
  await button('Show hidden (1)').click();
  await action('Genres', 'Edit details');
  await homeTask('Edit Genres').getByRole('textbox', { name: 'Name' }).fill('Genres from the browser');
  await button('Apply changes').click();
  await action('Genres from the browser', 'Show here');
  assert.equal(await button('Open Films', homeLevel).count(), 0);
  await button('Open Genres from the browser', homeLevel).click();
  await button('Open Films', homeLevel).click();
  assert.equal(artRequests, 0);
  await button('Load image').click();
  await page.locator('#home-selection img').evaluate(image => image.decode());
  await button('Open Discover', homeLevel).click();
  await button('Open Genres folder', homeLevel).click();
  assert.equal(await button('Open Hidden folder', homeLevel).count(), 0);
  await button('Open Thriller', homeLevel).click();
  await page.getByRole('heading', { name: 'Thriller', exact: true }).waitFor();
  await button('Home', homePath).click();
  await button('Open Genres from the browser', homeLevel).click();
  await button('Open Documentaries', homeLevel).click();
  await button('Load image').click();
  await page.getByText('Image unavailable').waitFor();
  assert.equal(artRequests, 2);
  await button('Home', homePath).click();
  await page.setViewportSize({ width: 360, height: 780 });
  await button('Preview Home').click();
  const preview = page.getByRole('dialog', { name: 'Home preview' });
  await preview.getByRole('heading', { name: 'Genres from the browser' }).waitFor();
  const bounds = await preview.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 361);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'hidden' });
  await button('Add here').click();
  await button('Widget', homeTask('Add to Home')).click();
  const addCatalog = button('Choose catalog', homeTask('Add to Home'));
  const catalogSearch = page.getByRole('textbox', { name: 'Search catalogs' });
  await addCatalog.click();
  await catalogSearch.fill('no matching catalog');
  await page.getByText('No matching catalogs found', { exact: true }).waitFor();
  await catalogSearch.press('Escape');
  await catalogSearch.waitFor({ state: 'hidden' });
  await addCatalog.click();
  assert.equal(await catalogSearch.inputValue(), '');
  await catalogSearch.press('Escape');
  await catalogSearch.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.getByText('Other ways to add a catalog', { exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Import catalog list' }).click();
  const manifestFile = page.getByLabel('Add-on manifest JSON');
  const mandatory = [
    { type: 'movie', id: 'search', name: 'Only search', extra: [{ name: 'search', isRequired: true }] },
    { type: 'movie', id: 'genre', name: 'Needs a genre', extraRequired: ['genre'] },
  ];
  async function importCatalogs(catalogs) {
    await manifestFile.setInputFiles({ name: 'portable.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ id: 'org.example.portable', name: 'Manual add-on', catalogs })) });
  }
  await importCatalogs(mandatory);
  await page.getByRole('alert').filter({ hasText: 'This manifest has no catalogs that can be shown on Home.' }).waitFor();
  await importCatalogs([{ type: 'movie', id: 'browse', name: 'Portable sample' }, ...mandatory]);
  await page.getByText('1 catalog imported.', { exact: true }).waitFor();
  await page.locator('summary').filter({ hasText: 'Import catalog list' }).click();
  await addCatalog.click();
  await catalogSearch.focus();
  await page.waitForFunction(() => {
    const input = document.activeElement;
    return input?.matches('[data-slot="catalog-search-input"]:focus-visible') &&
      getComputedStyle(input.parentElement).outlineWidth === '2px';
  });
  const catalogFocus = await catalogSearch.evaluate(el => {
    const input = getComputedStyle(el), frame = getComputedStyle(el.parentElement);
    return [input.outlineStyle, input.boxShadow, frame.outlineWidth, frame.outlineOffset];
  });
  assert.deepEqual(catalogFocus, ['none', 'none', '2px', '-2px']);
  await catalogSearch.fill('Manual add-on');
  await page.getByRole('button', { name: /Portable sample/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Only search|Needs a genre/ }).count(), 0);
  await catalogSearch.fill('Automatically discovered');
  await page.getByRole('button', { name: /Automatically discovered/ }).waitFor();
  await page.getByRole('textbox', { name: 'Search catalogs' }).fill('Trending');
  await page.getByRole('button', { name: /Trending now/ }).click();
  await page.getByRole('textbox', { name: 'Search catalogs' }).waitFor({ state: 'hidden' });
  const rows = page.locator('#home-title').locator('xpath=ancestor::section[1]').locator('.sync-drag');
  async function dragFirstToLast() {
    const from = await rows.first().boundingBox(), to = await rows.last().boundingBox();
    assert(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    // dnd-kit captures clicks for 50 ms after dropping to suppress the synthetic click.
    await page.waitForTimeout(60);
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  }
  assert.equal(await rows.count(), 0);
  await button('Reorder').click();
  await dragFirstToLast();
  const drag = page.getByRole('button', { name: 'Reorder Trending now' });
  await rows.first().and(drag).waitFor({ timeout: 3000 });
  await drag.press('ArrowDown');
  await rows.last().and(drag).waitFor({ timeout: 3000 });
  await drag.press('ArrowUp');
  await rows.first().and(drag).waitFor({ timeout: 3000 });
  await button('Done reordering').click();
  await action('Trending now', 'Edit details');
  await page.getByRole('checkbox', { name: 'Ranking numbers' }).check();
  await button('Apply changes').click();
  await button('Preview Trending now', homeLevel).click();
  await page.getByText('The acceptance test movie', { exact: true }).waitFor();
  console.log('Home catalog discovery, real hierarchy, artwork, pointer and keyboard reorder passed.');
  assert.equal(await page.getByRole('button', { name: 'Home tools', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Preview Home', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Tracking', exact: true }).click();
  await page.getByLabel('Watch progress').selectOption('TRAKT');
  await page.getByText('Library', { exact: true }).click();
  const libraryRows = page.getByRole('region', { name: 'Library rows' });
  const watchlist = libraryRows.getByRole('button', { name: 'Reorder Watchlist', exact: true });
  await watchlist.press('ArrowDown');
  assert.equal(await libraryRows.locator('.sync-drag').first().getAttribute('aria-label'), 'Reorder Calendar');
  await watchlist.press('ArrowDown');
  assert.equal(await libraryRows.locator('.sync-drag').nth(2).getAttribute('aria-label'), 'Reorder Watchlist');
  await libraryRows.getByRole('checkbox', { name: 'Show Watchlist', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Choose catalog', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search catalogs' }).fill('Automatically discovered');
  await page.getByRole('button', { name: /Automatically discovered.*Sample Catalogs/ }).click();
  await page.getByText('Sample Catalogs · Automatically discovered', { exact: true }).waitFor();
  await libraryRows.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-library-rows-desktop.png') });
  await page.setViewportSize({ width: 320, height: 740 });
  await libraryRows.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'luma-portal-library-rows-mobile.png') });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await appBackground.selectOption('Midnight');
  const preferenceSearch = page.getByRole('searchbox', { name: 'Search settings' });
  await preferenceSearch.fill('home');
  await page.getByRole('checkbox', { name: 'Show titles under posters' }).uncheck();
  const posterYears = page.getByRole('checkbox', { name: 'Show years under posters' });
  assert.equal(await posterYears.isChecked(), false);
  await posterYears.check();
  // Screen, input and performance settings are per device type: Apple TV changes stay on the Apple TV.
  await page.getByRole('button', { name: 'Per device', exact: true }).click();
  await page.getByRole('tab', { name: 'Apple TV' }).click();
  for (const group of ['Home', 'Playback']) await page.locator('summary', { hasText: new RegExp(`^${group}$`) }).click();
  await page.getByRole('combobox', { name: 'Poster card size' }).selectOption('large');
  const seekStep = page.getByRole('combobox', { name: 'Skip forward and back' });
  assert.equal(await seekStep.inputValue(), '15');
  await seekStep.selectOption('30');
  await page.getByRole('combobox', { name: 'Row card orientation' }).selectOption('Landscape');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await preferenceSearch.fill('subtitle');
  await page.getByLabel('Add subtitle language').selectOption('German');
  await page.getByLabel('Add subtitle language').selectOption('English');
  await page.getByRole('button', { name: 'Move English up' }).click();
  await preferenceSearch.fill('countdown');
  const countdown = page.getByRole('spinbutton', { name: /Next episode countdown/ });
  await countdown.fill('900');
  assert.equal(await countdown.getAttribute('aria-invalid'), 'true');
  await countdown.fill('25');
  await countdown.blur();
  assert.equal(await countdown.inputValue(), '25');
  await preferenceSearch.fill('skip scenes');
  await page.getByRole('combobox', { name: /^Intros/ }).selectOption('automatic');
  await preferenceSearch.fill('tmdb language');
  await page.getByRole('combobox', { name: 'TMDB language' }).selectOption('de');
  await preferenceSearch.fill('search');
  await page.getByRole('combobox', { name: 'Search provider' }).selectOption('addons');
  const addonPicker = page.getByRole('combobox', { name: 'Search add-on' });
  await addonPicker.getByRole('option', { name: 'Sample Catalogs' }).waitFor({ state: 'attached' });
  await addonPicker.selectOption({ label: 'Sample Catalogs' });
  await preferenceSearch.fill('excluded genres');
  const personSettings = page.getByText('Person pages', { exact: true }).locator('..');
  await personSettings.getByText('Excluded genres').click();
  await personSettings.getByRole('checkbox', { name: 'Documentary', exact: true }).uncheck();
  await preferenceSearch.fill('filmography sections');
  await page.getByText('Filmography sections', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Role' }).selectOption('director');
  await page.getByText('Films Directed', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Sort by', exact: true }).selectOption('newest');
  await page.setViewportSize({ width: 320, height: 740 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByText('Filmography sections', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-filmography-mobile.png') });
  await page.setViewportSize({ width: 1100, height: 850 });
  await preferenceSearch.fill('background');
  const tabButton = page.getByRole('navigation', { name: 'Setup sections' }).getByRole('button', { name: 'Preferences' });
  const selectedBorder = await tabButton.evaluate(el => getComputedStyle(el).borderTopColor);
  assert.equal(selectedBorder, 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Tab');
  await tabButton.focus();
  assert.deepEqual(await tabButton.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.outlineWidth, style.outlineOffset, style.boxShadow, el.getAttribute('aria-pressed')];
  }), ['2px', '-2px', 'none', 'true']);
  await page.screenshot({ path: path.join(evidence, 'luma-portal-focus-desktop.png'), animations: 'disabled' });
  await preferenceSearch.focus();
  assert.deepEqual(await preferenceSearch.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.outlineWidth, style.outlineOffset, style.boxShadow, style.borderTopColor];
  }), ['2px', '-2px', 'none', 'rgba(0, 0, 0, 0)']);
  await page.screenshot({ path: path.join(evidence, 'luma-portal-preferences-desktop.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  const toolbar = page.getByRole('banner');
  const appearance = toolbar.getByRole('button', { name: 'Appearance', exact: true });
  await appearance.click();
  const darkTheme = page.getByRole('button', { name: 'Dark', exact: true });
  await darkTheme.click();
  await darkTheme.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.keyboard.press('Tab');
  await preferenceSearch.focus();
  await page.waitForFunction(() => document.activeElement?.matches('input[aria-label="Search settings"]:focus-visible'));
  assert.deepEqual(await preferenceSearch.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.outlineWidth, style.outlineOffset, style.boxShadow];
  }), ['2px', '-2px', 'none']);
  await page.screenshot({ path: path.join(evidence, 'luma-portal-focus-mobile.png'), animations: 'disabled' });
  await appearance.scrollIntoViewIfNeeded();
  const brandBounds = await toolbar.locator('.sync-brand').boundingBox(), toolbarBounds = await appearance.boundingBox();
  assert(brandBounds && toolbarBounds && Math.abs(brandBounds.y + brandBounds.height / 2 - toolbarBounds.y - toolbarBounds.height / 2) < 2);
  await page.screenshot({ path: path.join(evidence, 'luma-portal-ux-header-mobile.png'), animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const footerSave = page.getByRole('button', { name: 'Save to Luma Sync', exact: true });
  const saveBounds = await footerSave.boundingBox();
  assert(saveBounds && saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 568);
  assert.equal(await page.locator('.sync-controls').evaluate(el => getComputedStyle(el).position), 'static');
  assert(await page.getByRole('navigation', { name: 'Setup sections' }).locator('.sync-area span').evaluateAll(
    labels => labels.every(label => label.scrollWidth <= label.clientWidth && label.clientHeight < 28)
  ));
  await page.getByRole('heading', { name: 'Preferences' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-preferences-mobile.png') });
  await page.setViewportSize({ width: 1100, height: 850 });
  await appearance.click();
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await page.getByRole('button', { name: 'Tags', exact: true }).click();
  const sourcePreview = page.getByLabel('Source preview', { exact: true });
  const badgeSize = page.getByRole('combobox', { name: 'Badge Size' });
  assert.notEqual(await badgeSize.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
  await badgeSize.selectOption('LARGE');
  await page.getByRole('combobox', { name: 'Badge Placement' }).selectOption('TOP');
  await page.getByRole('checkbox', { name: 'Show Stream Titles' }).uncheck();
  await sourcePreview.getByText('4K Blu-ray').waitFor({ state: 'hidden' });
  const fileControl = page.getByLabel('Import formatter pack');
  await page.keyboard.press('Tab');
  await fileControl.focus();
  assert.equal(await fileControl.evaluate(el => getComputedStyle(el.parentElement).outlineWidth), '2px');
  await fileControl.setInputFiles({ name: 'demo-tags.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ filters: [{ name: '4K', pattern: '2160p', tagColor: '#345678', imageURL: 'https://art.example.test/badge.png' }] })) });
  await page.getByLabel('Pack preview').getByText('4K', { exact: true }).waitFor();
  await page.getByLabel('Pack preview').getByRole('button', { name: 'Load badge images' }).click();
  await page.getByLabel('Pack preview').getByRole('img', { name: '4K' }).evaluate(img => img.decode());
  await page.setViewportSize({ width: 320, height: 740 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByLabel('Pack preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-formatter-mobile.png') });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.getByRole('button', { name: 'Add pack' }).click();
  await page.locator('summary').filter({ hasText: 'demo-tags.json' }).click();
  await page.getByLabel('Tag appearance').getByText('4K', { exact: true }).waitFor();
  await page.route('https://raw.githubusercontent.com/nobnobz/Omni-Template-Bot-Bid-Raiser/main/Other/fusion-tags-ume.json', route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' }, json: { filters: [{ name: 'HDR', pattern: 'HDR' }] },
  }));
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  await page.getByRole('button', { name: 'Add pack' }).click();
  await page.getByText('UME Classic', { exact: true }).click();
  await page.getByRole('button', { name: 'Move UME Classic up', exact: true }).click();
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enabled', exact: true }).uncheck();
  await expireDuringSave();
  await profilePicker.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await page.getByText('Draft restored. Review it and save when ready.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: 'Enabled', exact: true }).isChecked(), false);
  await writeNativePreference('metadata.hidePersonTitlesWithoutPoster', true, 2);
  await page.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await page.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor({ timeout: 12_000 });
  const after = await native.load(AbortSignal.timeout(15_000));
  const docs = new SyncDocuments(after, await native.realm(), randomUUID());
  assert.equal(docs.draft('1').addons[0].enabled, false);
  assert.equal(docs.draft('1').home[0].title, 'Trending now');
  assert.equal(docs.draft('1').home[0].widget.showRanking, true);
  assert.equal(docs.draft('1').preferences['library.shelf.watchlist'], false);
  assert.equal(docs.draft('1').preferences['library.shelf.order'], 'calendar,future,recentlyWatched,watchlist,forYou,becauseYouWatched,pinned,sources');
  assert.equal(docs.draft('1').preferences['progress.source'], 'TRAKT');
  assert.deepEqual(JSON.parse(docs.draft('1').preferences['library.shelf.pinnedList']).source.addon, {
    manifestURL: addon.manifestURL, catalogID: 'discovered', type: 'movie', paginated: false,
  });
  assert.equal(docs.draft('1').preferences['appearance.background'], 'Midnight');
  assert.equal(docs.draft('1').preferences['appearance.cardSize@tvos'], 'large');
  assert.equal(docs.draft('1').preferences['playback.seekStep@tvos'], 30);
  assert.equal(docs.draft('1').preferences['appearance.cardSize@ios'], undefined);
  assert.equal(docs.draft('1').preferences['appearance.cardSize'], undefined);
  assert.equal(docs.draft('1').preferences['home.posterTitles'], false);
  assert.equal(docs.draft('1').preferences['home.posterYears'], true);
  assert.equal(docs.draft('1').preferences['home.rowCardOrientation@tvos'], 'Landscape');
  assert.equal(docs.draft('1').preferences['metadata.language'], 'de');
  assert.equal(docs.draft('1').preferences['metadata.hidePersonTitlesWithoutPoster'], true);
  assert.equal(docs.draft('1').preferences['metadata.searchProvider'], 'addons');
  assert.match(docs.draft('1').preferences['search.addon'], /^[a-f0-9]{64}$/);
  assert.equal(docs.draft('1').preferences['metadata.excludedPersonGenreIDs'], '[10763,10764,10767]');
  assert.equal(docs.draft('1').preferences['metadata.personGenreDefaultsApplied'], true);
  assert.equal(JSON.parse(docs.draft('1').preferences['metadata.personSectionLayout']).roles.director.sections.directedMovies.sort, 'newest');
  assert.equal(docs.draft('1').preferences['playback.nextCountdown'], 25);
  assert.equal(docs.draft('1').preferences['playback.skip.schema'], 1);
  assert.equal(docs.draft('1').preferences['playback.skip.intro.mode'], 'automatic');
  assert.equal(docs.draft('1').preferences['playback.subtitleLanguages'], '["English","German"]');
  assert.equal(docs.draft('1').formatter[0].filters[0].name, 'HDR');
  assert.equal(docs.draft('1').preferences['playback.formatter.showTitles'], false);
  assert.equal(docs.draft('1').preferences['playback.formatter.placement'], 'TOP');
  assert.equal(docs.draft('1').preferences['playback.formatter.size'], 'LARGE');
  assert.equal(docs.draft('1').formatter[1].filters[0].name, '4K');
  assert.equal(docs.draft('1').collections[0].title, 'Genres from the browser');
  assert.equal(docs.draft('1').collections[0].folders[0].title, 'Films');
  assert.equal(docs.draft('1').home.find(row => row.source.collectionID === 'genres')?.enabled, true);
  const storedKeys = await page.evaluate(() => Object.keys(localStorage));
  assert(storedKeys.includes('luma.widget-editor.browser-id.v1'));
  assert(storedKeys.every(key => ['luma.widget-editor.browser-id.v1', 'theme'].includes(key)));
  await page.screenshot({ path: path.join(evidence, 'widget-editor-signed-in.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Reset App background' }).click();
  await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).click();
  await page.locator('.sync-mobile-save').getByText('Saved to Luma Sync', { exact: true }).waitFor();
  assert.equal(await appBackground.inputValue(), 'Charcoal');
  const reset = new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), randomUUID());
  assert.equal(reset.draft('1').preferences['appearance.background'], undefined);
  assert.equal(reset.draft('1').preferences['playback.nextCountdown'], 25);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await appBackground.selectOption('Slate');
  await profilePicker.selectOption('3');
  await draftDialog.getByRole('button', { name: 'Save and switch' }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'luma-portal-ux-draft-mobile.png'), animations: 'disabled' });
  const draftBounds = await draftDialog.boundingBox();
  assert(draftBounds && draftBounds.x >= 0 && draftBounds.x + draftBounds.width <= 321);
  await draftDialog.getByRole('button', { name: 'Save and switch' }).click();
  await page.waitForFunction(() => document.querySelector('.sync-controls select')?.value === '3');
  const switched = new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), randomUUID());
  assert.equal(switched.draft('1').preferences['appearance.background'], 'Slate');
  assert.equal(switched.draft('3').preferences['appearance.background'], undefined);
  await page.locator('.sync-mobile-save').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await button('Show hidden (521)').click();
  const pages = page.getByRole('navigation', { name: 'Page navigation' });
  await pages.getByText('1–48 of 543', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1100, height: 850 });
  await pages.scrollIntoViewIfNeeded();
  const editorBar = page.locator('.sync-editor-bar');
  assert.equal(await editorBar.evaluate(el => getComputedStyle(el).position), 'sticky');
  const sticky = await editorBar.boundingBox();
  assert(sticky && sticky.y >= 0 && sticky.y + sticky.height < 160);
  await pages.getByRole('button', { name: 'Next' }).click();
  await pages.getByText('49–96 of 543', { exact: true }).waitFor();
  const homeHeading = await page.getByRole('heading', { name: 'Home', exact: true }).boundingBox();
  const barAfterPaging = await editorBar.boundingBox();
  assert(homeHeading && barAfterPaging && homeHeading.y >= barAfterPaging.y + barAfterPaging.height && homeHeading.y < 400, JSON.stringify({ homeHeading, barAfterPaging }));
  await page.setViewportSize({ width: 320, height: 568 });
  const homeSearch = page.getByRole('searchbox', { name: 'Search Home' });
  await homeSearch.fill('nonexistent');
  await page.getByText('No matching items.', { exact: true }).waitFor();
  await homeSearch.clear();
  assert.equal(await homeSearch.inputValue(), '');
  await homeSearch.fill('row-543');
  await page.getByText('1 result', { exact: true }).waitFor();
  await action('Migrated row 543', 'Show here');
  await homeSearch.clear();
  await page.getByRole('button', { name: 'Preview Home' }).click();
  const previewPages = page.getByRole('navigation', { name: 'Page navigation' });
  await previewPages.getByRole('button', { name: 'Next' }).click();
  await preview.getByRole('button', { name: 'Migrated row 543' }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'luma-portal-parity-large-home.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await page.locator('.sync-mobile-save').getByText('Saved to Luma Sync', { exact: true }).waitFor();
  const largeReadback = new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), randomUUID()).draft('3').home;
  assert.equal(largeReadback.length, 543);
  assert.equal(largeReadback.at(-1).enabled, true);
  assert.equal(largeReadback.at(-2).enabled, false);
  console.log('Draft confirmation and save-and-switch passed; 543-row Home search, paging, mobile preview and visibility round-trip passed.');
  if (ume) {
    const dest = path.join(evidence, 'luma-home-redesign');
    await fs.mkdir(dest, { recursive: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    await profilePicker.selectOption('4');
    await button('Open Discover', homeLevel).waitFor();
    assert.equal(await homeLevel.locator('.home-card').count(), 3);
    assert.equal(await button('Open Lists', homeLevel).count(), 0);
    assert.equal(await homeLevel.getByText('top', { exact: true }).count(), 0);
    const movieCard = homeLevel.locator('.home-card').filter({ hasText: 'Cinemeta · Movies' });
    const seriesCard = homeLevel.locator('.home-card').filter({ hasText: 'Cinemeta · Series' });
    assert.equal(await movieCard.count(), 1);
    assert.equal(await seriesCard.count(), 1);
    await page.screenshot({ path: path.join(dest, 'ume-home.png'), animations: 'disabled' });
    await button('Preview Popular', movieCard).click();
    const posters = page.locator('#home-selection .home-poster-grid');
    await posters.waitFor();
    assert((await posters.locator('li').count()) >= 3);
    assert(await posters.locator('img').first().evaluate(async image => { try { await image.decode(); return image.naturalWidth > 0; } catch { return false; } }));
    await page.screenshot({ path: path.join(dest, 'ume-real-catalog.png'), animations: 'disabled' });
    await button('Open Discover', homeLevel).focus();
    await page.keyboard.press('Enter');
    assert.equal(await homeLevel.locator('.home-card').count(), 4);
    await button('Open Actors', homeLevel).click();
    await button('Open A', homeLevel).click();
    const actor = button('Open Adam Sandler', homeLevel);
    await actor.waitFor();
    const cover = actor.locator('img');
    assert(await cover.evaluate(async image => { try { await image.decode(); return image.naturalWidth > 0; } catch { return false; } }));
    await page.screenshot({ path: path.join(dest, 'ume-actor-covers.png'), animations: 'disabled' });
    await actor.click();
    await page.getByText('This folder opens a TMDB person page in Luma.').waitFor();
    await button('Home', homePath).click();
    await button('Open Discover', homeLevel).click();
    await button('Open Lists', homeLevel).click();
    await button('Open Top', homeLevel).click();
    await button('Preview IMDb Top Movies', homeLevel).click();
    await page.locator('#home-selection').getByText('AIOMetadata · Movies').waitFor();
    await page.setViewportSize({ width: 320, height: 750 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(dest, 'ume-lists-mobile.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1200, height: 900 });
    await button('Lists', homePath).click();
    await button('Add here').click();
    await homeTask('Add to Lists').getByRole('textbox', { name: 'Name' }).fill('Weekend');
    await button('Create folder').click();
    await button('Open Weekend', homeLevel).click();
    await button('Add here').click();
    await button('Catalog', homeTask('Add to Weekend')).click();
    await button('Choose catalog', homeTask('Add to Weekend')).click();
    await catalogSearch.fill('Cinemeta movie Popular');
    await page.getByRole('button', { name: /Popular.*movie.*Cinemeta/i }).click();
    await button('Preview Popular', homeLevel).waitFor();
    await action('Popular', 'Move to…');
    await homeTask('Move Popular').getByLabel('Destination').selectOption('root');
    await button('Move item').click();
    assert.equal(await homeLevel.locator('.home-card').count(), 4);
    await button('Undo').click();
    await button('Preview Popular', homeLevel).waitFor();
    await button('Save to Luma Sync').click();
    await page.getByText('Saved to Luma Sync.', { exact: true }).waitFor();
    const reread = new SyncDocuments(await native.load(AbortSignal.timeout(15_000)), await native.realm(), randomUUID()).draft('4');
    const stored = reread.collections.find(hub => hub.id === ume.id);
    assert.deepEqual(stored.folders.slice(1), ume.folders.slice(1), 'Unedited UME folders and covers survive publication');
    assert.equal(stored.folders[0].subfolders[0].sources[0].catalogId, 'top');
    assert.equal(stored.folders[0].subfolders[0].title, 'Weekend');
    assert.equal(reread.home.filter(row => row.kind === 'widget').length, 2);
    await button('Reload').click();
    await button('Preview Popular', homeLevel).waitFor();
    await button('Home', homePath).click();
    await button('Home tools').click();
    await button('Home file').click();
    const file = page.waitForEvent('download');
    await button('Export visible Home').click();
    const download = await file;
    const output = readHomeFile(JSON.parse(await fs.readFile(await download.path(), 'utf8')));
    assert.equal(output.home.length, 3);
    assert.equal(output.collections[0].folders.find(folder => folder.title === 'Lists').subfolders[0].title, 'Weekend');
    await page.keyboard.press('Escape');
    console.log('UME acceptance copy: four real exported trees, real covers, real Cinemeta posters, move/undo, encrypted readback and Home JSON round-trip passed.');
    const polish = path.join(evidence, 'luma-portal-ux-polish');
    await fs.mkdir(polish, { recursive: true });
    await profilePicker.selectOption('6');
    await button('Open Cover board', homeLevel).click();
    await page.setViewportSize({ width: 1240, height: 900 });
    await homeLevel.locator('img').last().scrollIntoViewIfNeeded();
    assert.equal(await homeLevel.locator('img').count(), 7);
    await homeLevel.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const coverGeometry = () => homeLevel.locator('.home-card').evaluateAll(cards => cards.map(card => ({
      top: card.getBoundingClientRect().top, art: card.querySelector('.home-cover').getBoundingClientRect().bottom,
      control: card.querySelector('.home-card-actions button')?.getBoundingClientRect().top,
    })));
    const desktop = await coverGeometry();
    assert.equal(desktop.filter(card => card.top === desktop[0].top).length, 4);
    assert(desktop.every(card => card.control >= card.art), 'Menus must not overlap cover artwork');
    assert.equal(await homeLevel.locator('.sync-drag').count(), 0);
    await homeLevel.screenshot({ path: path.join(polish, 'folder-cards-desktop.png'), animations: 'disabled' });
    await button('Reorder').click();
    await button('Reorder Watchlist', homeLevel).waitFor();
    assert((await coverGeometry()).every(card => card.control >= card.art), 'Drag handles must not overlap cover artwork');
    await button('Reorder Watchlist', homeLevel).press('ArrowDown');
    assert.equal(await homeLevel.locator('.home-card-open').first().getAttribute('aria-label'), 'Open Trending Movies');
    await button('Undo').click();
    await button('Done reordering').click();
    assert.equal(await homeLevel.locator('.home-card-open').first().getAttribute('aria-label'), 'Open Watchlist');
    await page.setViewportSize({ width: 320, height: 780 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const mobile = await coverGeometry();
    assert.equal(mobile.filter(card => card.top === mobile[0].top).length, 2);
    assert(mobile.every(card => card.control >= card.art));
    const tabTops = await page.getByRole('navigation', { name: 'Setup sections' }).getByRole('button').evaluateAll(tabs =>
      tabs.map(tab => tab.getBoundingClientRect().top));
    assert.equal(new Set(tabTops).size, 1);
    await homeLevel.screenshot({ path: path.join(polish, 'folder-cards-mobile.png'), animations: 'disabled' });
    await button('Reload').click();
    await draftDialog.getByRole('button', { name: 'Discard and reload' }).click();
    await page.getByRole('button', { name: 'Reload', exact: true }).waitFor();
    console.log('Seven-cover layout: artwork clear at 1240px and 320px, reorder mode and keyboard undo passed.');

  }

  await page.setViewportSize({ width: 1100, height: 850 });
  await profilePicker.selectOption('1');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await appBackground.selectOption('Forest');
  await writeNativePreference('appearance.background', 'Rust', 10000);
  await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Luma changed this setup. Your draft is still here.' }).waitFor();
  assert.equal(await appBackground.inputValue(), 'Forest');
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await draftDialog.getByRole('button', { name: 'Discard and reload' }).click();
  await appBackground.locator('option:checked').filter({ hasText: 'Rust' }).waitFor({ state: 'attached' });
  console.log('Manifest eligibility, expired-session draft recovery, concurrent rebase and same-field conflict passed.');
  const selectedProfileName = await profilePicker.locator('option:checked').textContent();
  await page.getByRole('button', { name: 'Manage profiles' }).click();
  await page.getByRole('button', { name: 'Edit current profile' }).click();
  const conflictingProfile = page.getByRole('dialog', { name: 'Edit profile' });
  await conflictingProfile.getByLabel('Profile name').fill('Stale edit');
  await writeNativePreference('playback.autoNext', false, 60);
  await conflictingProfile.getByRole('button', { name: 'Save profile' }).click();
  await conflictingProfile.getByRole('alert').filter({ hasText: 'Luma changed this setup.' }).waitFor();
  assert.equal(await conflictingProfile.getByLabel('Profile name').inputValue(), 'Stale edit');
  await conflictingProfile.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  assert.equal(await profilePicker.locator('option:checked').textContent(), selectedProfileName);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with passkey' }).waitFor();
  // The existing-account and registration scenarios share an ingress IP in the
  // harness. Give the independent scenario its own one-minute rate window.
  serviceClockOffset += 61_000;
  const invitation = await api('/v1/admin/invitations', { method: 'POST', token: adminToken,
    body: { label: 'Web registration smoke test', expiresIn: 3600, maxUses: 1 } });
  account = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 850 } });
  account.setDefaultTimeout(12_000);
  let newAuth, newSpace, count = 0;
  await account.exposeFunction('createSyntheticPasskey', (challenge, id) => {
    newSpace = id; newAuth = authenticator(origin, id);
    return newAuth.registration({ challenge });
  });
  await account.exposeFunction('getSyntheticPasskey', challenge => ({
    assertion: newAuth.assertion({ challenge }, { count: ++count }), prf: [...prf],
  }));
  await account.addInitScript(() => {
    const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0)).buffer;
    const cast = ({ response, ...raw }, extras) => ({ ...raw, rawId: decode(raw.rawId), ...extras, response: Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'transports').map(([key, value]) => [key, decode(value)])) });
    Object.defineProperty(navigator.credentials, 'create', { value: async ({ publicKey }) => {
      if (!document.permissionsPolicy?.allowsFeature('publickey-credentials-create') && !document.featurePolicy?.allowsFeature('publickey-credentials-create')) throw new Error('Registration disabled by document policy');
      const raw = await window.createSyntheticPasskey(encode(publicKey.challenge), new TextDecoder().decode(publicKey.user.id));
      const credential = cast(raw, { getClientExtensionResults: () => ({ prf: { enabled: true } }) });
      credential.response.getTransports = () => raw.response.transports;
      return credential;
    } });
    Object.defineProperty(navigator.credentials, 'get', { value: async ({ publicKey }) => {
      const { assertion, prf } = await window.getSyntheticPasskey(encode(publicKey.challenge));
      return cast(assertion, { getClientExtensionResults: () => ({ prf: { results: { first: Uint8Array.from(prf).buffer } } }) });
    } });
  });
  console.log('Existing account: tags, tracking and Home edits were read back in the native format.');
  await account.goto(origin, { waitUntil: 'domcontentloaded' });
  const favicon = await account.locator('link[rel="icon"]').getAttribute('href');
  assert.equal(favicon, '/widgets/sync-assets/favicon-white.svg');
  assert.equal((await account.request.get(new URL(favicon, origin).href)).status(), 200);
  await account.getByRole('button', { name: 'Create account' }).click();
  await account.getByLabel('First profile name').fill(' First web profile ');
  await account.getByLabel('Invitation code').fill(invitation.code);
  await account.getByRole('button', { name: 'Create passkey' }).click();
  await account.getByRole('button', { name: 'Confirm passkey' }).click();
  const accountProfile = account.getByRole('combobox', { name: 'Profile', exact: true });
  await accountProfile.getByRole('option', { name: 'First web profile' }).waitFor({ state: 'attached' });
  await account.getByRole('button', { name: 'Home tools' }).click();
  await account.setViewportSize({ width: 320, height: 568 });
  const library = account.getByRole('dialog', { name: 'Home tools' });
  await account.screenshot({ path: path.join(evidence, 'luma-portal-copy-templates-mobile.png'), animations: 'disabled' });
  const libraryBox = await library.boundingBox();
  assert(libraryBox && libraryBox.x >= 8 && libraryBox.x + libraryBox.width <= 312);
  assert(libraryBox.y >= 8 && libraryBox.y + libraryBox.height <= 560);
  assert(await library.evaluate(el => el.scrollWidth <= el.clientWidth));
  await account.setViewportSize({ width: 1100, height: 850 });
  await account.getByRole('button', { name: 'Add starter to Home' }).click();
  await account.route('https://raw.githubusercontent.com/nobnobz/Omni-Template-Bot-Bid-Raiser/main/Other/fusion-animated-covers.json', route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' }, json: [{ title: 'Thriller', videoURL: 'https://art.example.test/animated.mp4' }],
  }));
  await account.getByRole('button', { name: 'Home tools' }).click();
  await account.getByRole('button', { name: 'Covers', exact: true }).click();
  await account.getByRole('button', { name: 'Find matching covers' }).click();
  await account.getByText('1 folder matches.').waitFor();
  await account.getByRole('button', { name: 'Apply covers' }).click();
  await account.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await account.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
  await account.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await account.getByRole('button', { name: 'Add public add-on' }).click();
  await account.getByLabel('Public manifest URL').fill(addon.manifestURL);
  await account.getByLabel('Add-on name').fill(addon.name);
  await account.getByRole('button', { name: 'Add', exact: true }).click();
  await account.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await account.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
  await account.setViewportSize({ width: 320, height: 568 });
  await account.getByRole('button', { name: 'Manage profiles' }).click();
  await account.getByRole('button', { name: 'Create profile', exact: true }).click();
  const createProfile = account.getByRole('dialog', { name: 'Create profile', exact: true });
  await createProfile.getByRole('button', { name: 'Create profile' }).click();
  await createProfile.getByRole('alert').filter({ hasText: 'Enter a profile name.' }).waitFor();
  const profileBox = await createProfile.boundingBox();
  assert(profileBox && profileBox.x >= 8 && profileBox.x + profileBox.width <= 312);
  await createProfile.getByLabel('Profile name').fill('Family');
  await createProfile.getByLabel('Avatar', { exact: true }).selectOption('artwork:finn');
  await createProfile.getByLabel('Copy public add-ons from').selectOption('1');
  await account.screenshot({ path: path.join(evidence, 'luma-portal-profile-create-mobile.png'), animations: 'disabled' });
  await createProfile.getByRole('button', { name: 'Create profile' }).click();
  await account.getByRole('status').filter({ hasText: 'Profile saved to Luma Sync.' }).waitFor();
  assert.equal(await accountProfile.inputValue(), '2');
  await account.getByRole('button', { name: 'Add-ons', exact: true }).click();
  await account.getByText(addon.name, { exact: true }).waitFor();
  await account.setViewportSize({ width: 1100, height: 850 });
  await account.getByRole('button', { name: 'Manage profiles' }).click();
  await account.getByRole('button', { name: 'Edit current profile' }).click();
  const editProfile = account.getByRole('dialog', { name: 'Edit profile' });
  await editProfile.getByLabel('Profile name').fill('Family renamed');
  await editProfile.getByLabel('Use shared add-ons').check();
  await editProfile.getByRole('button', { name: 'Save profile' }).click();
  await account.getByText('From the primary profile', { exact: true }).first().waitFor();
  await account.getByRole('button', { name: 'Manage profiles' }).click();
  await account.getByRole('button', { name: 'Create profile', exact: true }).click();
  await createProfile.getByLabel('Profile name').fill('Blank slate');
  await createProfile.getByLabel('Copy public add-ons from').selectOption('');
  await createProfile.getByRole('button', { name: 'Create profile' }).click();
  await account.getByRole('status').filter({ hasText: 'Profile saved to Luma Sync.' }).waitFor();
  assert.equal(await accountProfile.inputValue(), '3');
  await account.getByRole('button', { name: 'Preferences', exact: true }).click();
  await account.getByRole('searchbox', { name: 'Search settings' }).fill('forced subtitles');
  await account.getByLabel('Only show forced subtitles').check();
  await account.getByRole('button', { name: 'Save to Luma Sync' }).click();
  await account.getByRole('status').filter({ hasText: 'Saved to Luma Sync.' }).waitFor();
  await account.getByRole('button', { name: 'Sign out' }).click();
  await account.getByRole('button', { name: 'Sign in with passkey' }).click();
  await accountProfile.getByRole('option', { name: 'Family renamed' }).waitFor({ state: 'attached' });
  await account.getByRole('button', { name: 'Sign out' }).click();
  const nativeDevice = randomUUID();
  const login = await api('/v1/passkeys/login/options', { method: 'POST', body: { deviceID: nativeDevice, deviceName: 'Second test Mac' } });
  const grant = await api('/v1/passkeys/login/verify', { method: 'POST', body: { flowID: login.flowID,
    credential: newAuth.assertion(login.publicKey, { count: ++count }) } });
  assert.equal(grant.spaceID, newSpace);
  const newMaster = await unwrapPasskeyMaster(grant.sealedSecrets, new Uint8Array(prf), new Uint8Array(Buffer.from(grant.prfSalt, 'base64url')), origin, newSpace, newAuth.id);
  const reader = new SyncTransport({ origin, deviceID: nativeDevice, spaceID: newSpace, token: grant.deviceToken, master: newMaster },
    () => assert.fail('Synthetic fixture is not compressed'), api);
  const firstSetup = new SyncDocuments(await reader.load(AbortSignal.timeout(15_000)), await reader.realm(), nativeDevice);
  const starter = firstSetup.draft('1').collections[0];
  assert.equal(starter.title, 'UME v4.0');
  assert.equal(starter.folders[0].sections[0].folders[0].subfolders[1].focusVideoUrl, 'https://art.example.test/animated.mp4');
  assert.equal(firstSetup.draft('1').home[0].enabled, true);
  assert.deepEqual(firstSetup.profiles.map(({ name, avatar, inheritsAddons }) => [name, avatar, inheritsAddons]),
    [['First web profile', '', false], ['Family renamed', 'artwork:finn', true], ['Blank slate', '', false]]);
  assert.equal(firstSetup.draft('3').addons.length, 0);
  assert.equal(firstSetup.draft('3').preferences['playback.forcedSubtitles'], true);
  const ownAddon = [...(await reader.load(AbortSignal.timeout(15_000))).snapshots.values()].find(snapshot => snapshot.records[`${prefix}.2.addons`]);
  assert(ownAddon, 'The independent copy survives enabling shared add-ons');
  reader.close();
  console.log('Web registration, profile creation with and without public add-ons, rename, avatar, inheritance, stale save, forced subtitles and native enrollment passed.');
  // This independent scenario performs several passkey sign-ins on the same test ingress IP.
  serviceClockOffset += 61_000;
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const savedCursor = (await native.load(AbortSignal.timeout(15_000))).cursor;
  const clockBeforeExpiry = page.getByText('Session ends in less than 5 minutes.', { exact: false });
  assert.equal(await clockBeforeExpiry.filter({ visible: true }).count(), 0);
  await appBackground.selectOption('Forest');
  const secured = page.getByText('Draft secured on this browser', { exact: true }).filter({ visible: true });
  await secured.waitFor();
  assert.equal((await native.load(AbortSignal.timeout(15_000))).cursor, savedCursor, 'A local draft must not publish anything to Sync');
  assert.deepEqual(await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('luma-sync-local-drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const records = db.transaction('drafts').objectStore('drafts').getAll();
      records.onsuccess = () => {
        db.close();
        resolve(records.result.map(record => ({ fields: Object.keys(record).sort(), cipher: record.cipher instanceof Uint8Array })));
      };
      records.onerror = () => { db.close(); reject(records.error); };
    };
  })), [{ fields: ['cipher', 'revision'], cipher: true }]);

  await page.clock.setFixedTime(new Date(Date.now() + 56 * 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.sync-expiry-desktop').filter({ hasText: 'Session ends in less than 5 minutes.' }).waitFor();
  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator('.sync-expiry-mobile').filter({ hasText: 'Session ends in less than 5 minutes.' }).waitFor();
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.clock.setFixedTime(new Date(Date.now() + 61 * 60_000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Session ended. Sign in with the same account to recover your draft.', { exact: true }).waitFor();
  await page.clock.setFixedTime(new Date());
  await page.reload({ waitUntil: 'domcontentloaded' });
  const originalAssertion = browserAssertion;
  browserAssertion = challenge => newAuth.assertion({ challenge }, { count: ++count });
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await profilePicker.getByRole('option', { name: 'First web profile', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  assert.equal(await appBackground.inputValue(), 'Charcoal');
  await page.getByRole('button', { name: 'Sign out' }).click();
  browserAssertion = originalAssertion;
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await profilePicker.getByRole('option', { name: 'Test profile', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByText('Draft restored. Review it and save when ready.', { exact: true }).waitFor();
  assert.equal(await appBackground.inputValue(), 'Forest');
  assert.equal((await native.load(AbortSignal.timeout(15_000))).cursor, savedCursor);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await draftDialog.getByRole('button', { name: 'Keep draft and sign out' }).click();
  await writeNativePreference('appearance.background', 'Ocean', 11000);
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await page.getByText('Your draft is shown for review', { exact: false }).waitFor();
  assert.equal(await appBackground.inputValue(), 'Forest');
  assert(await page.getByRole('button', { name: 'Save to Luma Sync', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Sign out' }).click();
  await draftDialog.getByRole('button', { name: 'Discard and sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await profilePicker.getByRole('option', { name: 'Test profile', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  assert.equal(await appBackground.inputValue(), 'Ocean');
  await page.getByRole('button', { name: 'Sign out' }).click();
  console.log('Encrypted local draft, no automatic publication, desktop/mobile expiry warning, browser reload, account isolation, conflict review and explicit draft discard passed.');
  const admin = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 850 }, locale: 'en-US' });
  await admin.goto(origin + '/admin/', { waitUntil: 'domcontentloaded' });
  await admin.locator('#login-password').fill((await fs.readFile(path.join(workspace, 'data', 'admin-bootstrap-password'), 'utf8')).trim());
  const adminLogin = admin.waitForResponse(response => response.url() === origin + '/v1/admin/session' && response.request().method() === 'POST');
  await admin.locator('#password-login-form button[type="submit"]').click();
  const adminResponse = await adminLogin;
  assert(adminResponse.ok(), `Local Admin login: HTTP ${adminResponse.status()}`);
  const permanent = 'A new long admin password for this local smoke test';
  await admin.locator('#setup-password').fill(permanent);
  await admin.locator('#setup-confirm').fill(permanent);
  await admin.locator('#setup-form button[type="submit"]').click();
  await admin.locator('button[data-page="invitations"]').click();
  await admin.locator('#invitations-title').waitFor();
  await admin.locator('button[data-page="settings"]').click();
  await admin.locator('#settings-title').waitFor();
  assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await admin.screenshot({ path: path.join(evidence, 'luma-admin-mobile.png') });
  await admin.setViewportSize({ width: 320, height: 568 });
  await admin.locator('#language').selectOption('de');
  await admin.locator('button[data-theme-option="dark"]').click();
  await admin.getByRole('heading', { name: 'Registrierung' }).waitFor();
  assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await admin.screenshot({ path: path.join(evidence, 'luma-admin-review-mobile.png') });

  assert.deepEqual(faults, []);
  console.log('HTTPS landing, real signed assertion/PRF envelope, editor save, native-format read, nested preview, web registration, starter, cover sync and Admin navigation passed.');
} catch (error) {
  if (account && !account.isClosed()) {
    const feedback = await account.locator('.sync-banner').allTextContents().catch(() => []);
    if (feedback.length) console.log('New account feedback:', feedback);
    await account.screenshot({ path: path.join(evidence, 'luma-portal-new-account-failure.png'), timeout: 3000 }).catch(() => undefined);
  }
  if (page && !page.isClosed()) {
    const feedback = await page.locator('.sync-banner').allTextContents().catch(() => []);
    if (feedback.length) console.log('Portal feedback:', feedback);
    if (signInTrace.length) console.log('Passkey responses:', signInTrace);
    await page.screenshot({ path: path.join(evidence, 'luma-portal-browser-failure.png'), timeout: 3000 }).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  if (caddy) { caddy.kill(); await new Promise(resolve => caddy.exitCode !== null || caddy.signalCode !== null ? resolve() : caddy.once('exit', resolve)); }
  await service.close();
  await fs.rm(workspace, { recursive: true, force: true });
}
