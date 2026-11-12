// Personal TMDB and MDBList API keys. Byte-for-byte counterparts of the native rules:
// LumaSyncCrypto.swift (root copy), ProtectedMetadataSync.swift (key registers) and
// ConfigurationSyncSession.verifiedNativeSecretsCredential() (root flow). The root lives in memory only.
import { syncRequest, type RequestSync } from './passkey';
import { base64, derive, digest, int, join, object, requireSync, unbase64, utf8, uuid, type Bytes } from './wire';

export const protectedKinds = ['tmdb', 'mdbList'] as const;
export type ProtectedKind = typeof protectedKinds[number];
export const protectedKindNames: Record<ProtectedKind, string> = { tmdb: 'TMDB', mdbList: 'MDBList' };
export const protectedField = (kind: ProtectedKind) => `nativeProtected.metadata.v1.${kind}`;
const ROOT_INFO = 'luma-sync-native-root-copy-v1';
const MAX_KEY_BYTES = 4096, MAX_WIRE_CHARS = 5500;

async function aesSeal(plain: Bytes, key: CryptoKey, aad: Bytes, nonce = crypto.getRandomValues(new Uint8Array(12))): Promise<Bytes> {
  requireSync(nonce.length === 12);
  return join([nonce, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, plain))]);
}
async function aesOpen(combined: Bytes, key: CryptoKey, aad: Bytes): Promise<Bytes> {
  requireSync(combined.length >= 28);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.subarray(0, 12), additionalData: aad }, key, combined.subarray(12)));
}

// ---- Root copy: nativeRootCipher / sealNativeRoot / openNativeRoot
export const makeRoot = (): Bytes => crypto.getRandomValues(new Uint8Array(32));
export const rootCommitment = (root: Bytes) => digest(root);
async function rootCipher(master: Bytes, spaceID: string, commitment: string) {
  requireSync(master.length === 32 && uuid(spaceID));
  return { key: await derive(master, utf8.encode(spaceID), utf8.encode(ROOT_INFO)), aad: utf8.encode(`${ROOT_INFO}:${spaceID}:${commitment}`) };
}
export async function sealRoot(root: Bytes, master: Bytes, spaceID: string, nonce?: Bytes): Promise<string> {
  requireSync(root.length === 32);
  const { key, aad } = await rootCipher(master, spaceID, await rootCommitment(root));
  return base64(await aesSeal(root, key, aad, nonce), true);
}
/** undefined when the copy is not this space's committed root. */
export async function openRoot(sealed: string, commitment: string, master: Bytes, spaceID: string): Promise<Bytes | undefined> {
  try {
    const bytes = unbase64(sealed, 60, 60, true);
    const { key, aad } = await rootCipher(master, spaceID, commitment);
    const root = await aesOpen(bytes, key, aad);
    return root.length === 32 && await rootCommitment(root) === commitment ? root : undefined;
  } catch { return undefined; }
}

export interface RootState { commitment: string | null; sealedRoot: string | null }
function rootState(value: Record<string, unknown>): RootState {
  const { commitment, sealedRoot } = value;
  requireSync((commitment === null || typeof commitment === 'string' && /^[0-9a-f]{64}$/.test(commitment)) &&
    (sealedRoot === null || typeof sealedRoot === 'string' && sealedRoot.length <= 128) && value.sealedRootSupported === true);
  return { commitment, sealedRoot };
}
export class NativeRoot {
  private readonly token: string;
  private readonly master: Bytes;
  private readonly spaceID: string;
  private readonly request: RequestSync;
  constructor(token: string, master: Bytes, spaceID: string, request: RequestSync = syncRequest) {
    this.token = token; this.master = master; this.spaceID = spaceID; this.request = request;
  }
  async state(signal?: AbortSignal): Promise<RootState> {
    return rootState(await this.request('/v1/native-secret-root', { token: this.token, signal }));
  }
  private async publish(root: Bytes, signal?: AbortSignal): Promise<RootState> {
    return rootState(await this.request('/v1/native-secret-root', { token: this.token, signal, method: 'PUT',
      body: { commitment: await rootCommitment(root), sealedRoot: await sealRoot(root, this.master, this.spaceID) } }));
  }
  private open(state: RootState) {
    return state.commitment && state.sealedRoot ? openRoot(state.sealedRoot, state.commitment, this.master, this.spaceID) : Promise.resolve(undefined);
  }
  /** Read-only: the root when an openable copy exists, 'none' when nothing is committed yet, 'waiting' otherwise. */
  async existing(signal?: AbortSignal): Promise<{ root: Bytes } | 'none' | 'waiting'> {
    const state = await this.state(signal);
    if (!state.commitment) return 'none';
    const root = await this.open(state);
    return root ? { root } : 'waiting';
  }
  /** The first device creates the root; the reply of the PUT is the space's actual state. */
  async ensure(signal?: AbortSignal): Promise<Bytes | undefined> {
    let state = await this.state(signal);
    if (!state.commitment) state = await this.publish(makeRoot(), signal);
    return this.open(state);
  }
}

// ---- Key registers: ProtectedMetadataSync
export interface ProtectedRegister { value: string; revision: number; deviceID: string }
export function validateKey(value: string) {
  requireSync(utf8.encode(value).length <= MAX_KEY_BYTES && !/[\p{White_Space}\p{Cc}]/u.test(value));
}
/** Foundation trims whitespace and newlines before a key is compared or sealed. */
export const normalizeKey = (value: string) => value.replace(/^[\p{White_Space}]+|[\p{White_Space}]+$/gu, '');
export class ProtectedKeys {
  private readonly root: Bytes;
  readonly realm: string;
  readonly profile: string;
  readonly epoch: string;
  private wire?: Promise<CryptoKey>;
  /** `epoch` is the account's deletion epoch data as written on the wire (standard base64), or undefined. */
  constructor(root: Bytes, realm: string, profile: string, epoch: string | undefined) {
    requireSync(root.length === 32 && profile.length > 0 && utf8.encode(profile).length <= 128 && !profile.includes('|'));
    this.root = root; this.realm = realm; this.profile = profile;
    this.epoch = epoch === undefined ? '' : btoa(atob(epoch));
  }
  context(kind: ProtectedKind) { return `luma-protected-metadata-v1|${this.realm}|${this.profile}|${kind}|${this.epoch}`; }
  private key() {
    return this.wire ??= derive(this.root, new Uint8Array(0), utf8.encode('luma-protected-metadata-v1|wire'));
  }
  private aad(kind: ProtectedKind, revision: number, device: string) { return utf8.encode(`${this.context(kind)}|${revision}|${device}`); }
  async seal(value: string, kind: ProtectedKind, revision: number, device: string, nonce?: Bytes): Promise<ProtectedRegister> {
    validateKey(value);
    requireSync(int(revision, 1) && uuid(device));
    return { value: base64(await aesSeal(utf8.encode(value), await this.key(), this.aad(kind, revision, device), nonce), true), revision, deviceID: device };
  }
  async open(register: unknown, kind: ProtectedKind): Promise<string> {
    const { value, revision, deviceID } = object(register);
    requireSync(int(revision, 1) && uuid(deviceID) && typeof value === 'string' && value.length <= MAX_WIRE_CHARS);
    const plain = await aesOpen(unbase64(value, MAX_WIRE_CHARS, 1, true), await this.key(), this.aad(kind, revision, deviceID));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plain);
    validateKey(text);
    return text;
  }
  /**
   * ProtectedMetadataSync.propose for a device that has observed `remote`: no change when the authenticated
   * value is already the requested one, otherwise the next logical generation (a removal takes the odd one,
   * so it wins over an edit made from the same observed revision). Without a register a first key is
   * revision 2 and a removal writes nothing.
   */
  async propose(local: string, remote: ProtectedRegister | undefined, kind: ProtectedKind, device: string, nonce?: Bytes): Promise<ProtectedRegister | null> {
    validateKey(local);
    if (remote) {
      if (await this.open(remote, kind) === local) return null;
      requireSync(remote.revision <= Number.MAX_SAFE_INTEGER - 3);
      return this.seal(local, kind, (Math.floor(remote.revision / 2) + 1) * 2 + (local === '' ? 1 : 0), device, nonce);
    }
    return local === '' ? null : this.seal(local, kind, 2, device, nonce);
  }
}
