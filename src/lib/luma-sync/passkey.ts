import { base64, derive, object, open, parse, requireSync, seal, unbase64, utf8, uuid, type Bytes } from './wire';

export class SyncHTTPError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  constructor(status: number, retryAfter?: number) { super('sync_http'); this.status = status; this.retryAfter = retryAfter; }
}
export type RequestSync = (path: string, options?: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; max?: number }) => Promise<Record<string, unknown>>;
export const syncRequest: RequestSync = async (path, { method = 'GET', body, token, signal, max = 65_536 } = {}) => {
  requireSync(/^\/v[12]\/[a-z0-9/-]+$/.test(path));
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Accept: 'application/json', 'X-Luma-Sync-Transport': '2', 'X-Luma-Sync-History': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'origin',
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const retry = Number(response.headers.get('Retry-After'));
    throw new SyncHTTPError(response.status, Number.isFinite(retry) && retry > 0 ? Math.min(600, Math.ceil(retry)) : undefined);
  }
  const reader = response.body?.getReader();
  requireSync(reader && response.headers.get('Content-Type')?.startsWith('application/json'));
  const chunks: Bytes[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error('invalid_sync_data'); }
    chunks.push(new Uint8Array(value));
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return object(parse(bytes));
};

export interface SyncSession { deviceID: string; spaceID: string; token: string; origin: string; master: Bytes }
export interface EditorSession extends SyncSession { expiresAt: number }
// Match the server's fixed editor grant. Start at the request to avoid counting
// network or local key-unwrapping time as additional session time.
const EDITOR_SESSION_MS = 60 * 60_000;
export async function unwrapPasskeyMaster(payload: unknown, prf: Bytes, salt: Bytes, origin: string, space: string, credential: string) {
  const scope = utf8.encode(`luma-sync-passkey-wrap-v1:${origin}:${space}:${credential}`);
  const raw = await open(unbase64(payload, 92, 92, true), await derive(prf, salt, scope), scope);
  try {
    requireSync(raw.length === 64 && raw.subarray(0, 32).some((b, i) => raw[i + 32] !== b));
    return raw.slice(0, 32);
  } finally { raw.fill(0); }
}

export async function signIn(browserID: string, signal: AbortSignal, request: RequestSync = syncRequest): Promise<EditorSession> {
  const { origin, hostname, protocol } = location;
  if (protocol !== 'https:' || !window.isSecureContext || !navigator.credentials || window.top !== window) throw new Error('unsupported_browser');
  const options = await request('/v1/passkeys/editor/options', { method: 'POST', body: {
    browserID, deviceID: crypto.randomUUID(), deviceName: 'Luma Widget Manager',
  }, signal });
  const key = object(options.publicKey);
  requireSync(uuid(options.flowID) && key.rpId === hostname && key.userVerification === 'required' &&
    (key.allowCredentials === undefined || (Array.isArray(key.allowCredentials) && !key.allowCredentials.length)));
  const salt = unbase64(options.prfSalt, 32, 32, true);
  const challenge = unbase64(key.challenge, 64, 32, true);
  const credential = await navigator.credentials.get({ publicKey: {
    rpId: hostname, challenge, userVerification: 'required', timeout: 120_000,
    extensions: { prf: { eval: { first: salt } } },
  }, signal }) as PublicKeyCredential | null;
  signal.throwIfAborted();
  requireSync(credential?.type === 'public-key' && credential.id === base64(new Uint8Array(credential.rawId), true));
  const response = credential.response as AuthenticatorAssertionResponse;
  const data = object(parse(new Uint8Array(response.clientDataJSON)));
  requireSync(data.origin === origin && data.type === 'webauthn.get' && data.challenge === key.challenge &&
    (data.crossOrigin === undefined || data.crossOrigin === false) && data.topOrigin === undefined && response.userHandle);
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength !== 32) throw new Error('missing_prf');
  const prf = new Uint8Array(first);
  let token: string | undefined, master: Bytes | undefined;
  try {
    // Explicit wire shape: WebAuthn's toJSON() could include the private PRF result.
    const expiresAt = Date.now() + EDITOR_SESSION_MS;
    const grant = await request('/v1/passkeys/editor/verify', { method: 'POST', signal, body: { flowID: options.flowID,
      credential: { id: credential.id, rawId: credential.id, type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: base64(new Uint8Array(response.clientDataJSON), true),
        authenticatorData: base64(new Uint8Array(response.authenticatorData), true),
        signature: base64(new Uint8Array(response.signature), true), userHandle: base64(new Uint8Array(response.userHandle), true),
      } },
    } });
    unbase64(grant.deviceToken, 32, 32, true).fill(0);
    token = grant.deviceToken as string;
    requireSync(uuid(grant.deviceID) && uuid(grant.spaceID) && grant.prfSalt === options.prfSalt &&
      base64(new Uint8Array(response.userHandle), true) === base64(utf8.encode(grant.spaceID), true));
    master = await unwrapPasskeyMaster(grant.sealedSecrets, prf, salt, origin, grant.spaceID, credential.id);
    signal.throwIfAborted();
    return { deviceID: grant.deviceID, spaceID: grant.spaceID, token, master, origin, expiresAt };
  } catch (error) {
    master?.fill(0);
    if (token) void request('/v1/editor/session', { token, method: 'DELETE' }).catch(() => undefined);
    throw error;
  } finally { prf.fill(0); }
}

const encoded = (value: ArrayBuffer) => base64(new Uint8Array(value), true);
const registrationPath = '/v1/passkeys/editor/register';
export interface PendingRegistration {
  deviceID: string;
  spaceID: string;
  credentialID: string;
  flowID: string;
  challenge: Bytes;
  salt: Bytes;
  origin: string;
  hostname: string;
}
export async function beginRegistration(browserID: string, invite: string, signal: AbortSignal, request: RequestSync = syncRequest): Promise<PendingRegistration> {
  const { origin, hostname, protocol } = location;
  if (protocol !== 'https:' || !window.isSecureContext || !navigator.credentials || window.top !== window) throw new Error('unsupported_browser');
  const deviceID = crypto.randomUUID(), spaceID = crypto.randomUUID();
  const start = await request(registrationPath + '/options', { method: 'POST', signal,
    body: { browserID, deviceID, spaceID, deviceName: 'Luma Web', invite } });
  const key = object(start.publicKey), rp = object(key.rp), user = object(key.user);
  requireSync(uuid(start.flowID) && rp.id === hostname && typeof rp.name === 'string' && rp.name.length <= 128 &&
    user.id === base64(utf8.encode(spaceID), true) && user.name === spaceID);
  const credential = await navigator.credentials.create({ signal, publicKey: {
    rp: { id: hostname, name: rp.name }, user: { id: utf8.encode(spaceID), name: spaceID, displayName: 'Luma Sync' },
    challenge: unbase64(key.challenge, 64, 32, true), pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none', timeout: 120_000, extensions: { prf: {}, credProps: true },
  } }) as PublicKeyCredential | null;
  signal.throwIfAborted();
  requireSync(credential?.type === 'public-key' && credential.id === encoded(credential.rawId));
  if (credential.getClientExtensionResults().prf?.enabled === false) throw new Error('missing_prf');
  const response = credential.response as AuthenticatorAttestationResponse;
  const checked = await request(registrationPath + '/verify', { method: 'POST', signal, body: {
    flowID: start.flowID, credential: { id: credential.id, rawId: credential.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: encoded(response.clientDataJSON), attestationObject: encoded(response.attestationObject),
        transports: response.getTransports?.().filter(item => ['usb', 'nfc', 'ble', 'smart-card', 'hybrid', 'internal'].includes(item)) ?? [] } },
  } });
  const options = object(checked.publicKey);
  requireSync(uuid(checked.flowID) && options.rpId === hostname && options.userVerification === 'required' &&
    checked.prfSalt === start.prfSalt && Array.isArray(options.allowCredentials) && options.allowCredentials.length === 1 &&
    object(options.allowCredentials[0]).id === credential.id);
  return { deviceID, spaceID, credentialID: credential.id, flowID: checked.flowID, origin, hostname,
    challenge: unbase64(options.challenge, 64, 32, true), salt: unbase64(checked.prfSalt, 32, 32, true) };
}
export async function finishRegistration(flow: PendingRegistration, signal: AbortSignal, request: RequestSync = syncRequest): Promise<EditorSession> {
  const { origin, hostname, credentialID, challenge, salt, deviceID, spaceID, flowID } = flow;
  const credential = await navigator.credentials.get({ signal, publicKey: {
    rpId: hostname, challenge, userVerification: 'required', timeout: 120_000,
    allowCredentials: [{ id: unbase64(credentialID, 1024, 1, true), type: 'public-key' }],
    extensions: { prf: { eval: { first: salt } } },
  } }) as PublicKeyCredential | null;
  signal.throwIfAborted();
  requireSync(credential?.type === 'public-key' && credential.id === credentialID && encoded(credential.rawId) === credentialID);
  const response = credential.response as AuthenticatorAssertionResponse;
  const data = object(parse(new Uint8Array(response.clientDataJSON)));
  requireSync(data.origin === origin && data.type === 'webauthn.get' && data.challenge === base64(challenge, true) &&
    (data.crossOrigin === undefined || data.crossOrigin === false) && data.topOrigin === undefined &&
    (!response.userHandle || encoded(response.userHandle) === base64(utf8.encode(spaceID), true)));
  const first = credential.getClientExtensionResults().prf?.results?.first;
  if (!(first instanceof ArrayBuffer) || first.byteLength !== 32) throw new Error('missing_prf');
  const prf = new Uint8Array(first), secret = crypto.getRandomValues(new Uint8Array(64));
  let proof: Bytes | undefined, token: string | undefined;
  try {
    const scope = utf8.encode(`luma-sync-passkey-wrap-v1:${origin}:${spaceID}:${credentialID}`);
    const owner = await crypto.subtle.importKey('raw', secret.subarray(32), 'HKDF', false, ['deriveBits']);
    proof = new Uint8Array(await crypto.subtle.deriveBits({
      name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(spaceID), info: utf8.encode('luma-sync-recovery-v1'),
    }, owner, 256));
    const wrapped = await seal(secret, await derive(prf, salt, scope), scope);
    const expiresAt = Date.now() + EDITOR_SESSION_MS;
    const grant = await request(registrationPath + '/complete', { method: 'POST', signal, body: {
      flowID, sealedSecrets: base64(wrapped, true), recoveryToken: base64(proof, true),
      credential: { id: credentialID, rawId: credentialID, type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: encoded(response.clientDataJSON), authenticatorData: encoded(response.authenticatorData),
        signature: encoded(response.signature), userHandle: response.userHandle ? encoded(response.userHandle) : undefined,
      } },
    } });
    unbase64(grant.deviceToken, 32, 32, true).fill(0);
    token = grant.deviceToken as string;
    requireSync(grant.deviceID === deviceID && grant.spaceID === spaceID);
    signal.throwIfAborted();
    return { deviceID, spaceID, token, master: secret.slice(0, 32), origin, expiresAt };
  } catch (error) {
    if (token) void request('/v1/editor/session', { token, method: 'DELETE' }).catch(() => undefined);
    throw error;
  } finally { prf.fill(0); secret.fill(0); proof?.fill(0); }
}
