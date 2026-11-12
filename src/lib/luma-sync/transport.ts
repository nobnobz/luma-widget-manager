import { SyncHTTPError, syncRequest, type RequestSync, type SyncSession } from './passkey';
import { base64, derive, digest, hashID, int, join, json, MAX_CHUNK, MAX_PLAIN, object, open, packChunk, parse,
  requireSync, seal, unbase64, unpackChunk, unwrapSnapshot, utf8, uuid, wrapSnapshot, type Bytes, type Decompress } from './wire';

interface Metadata { deviceID: string; size: number; version: number; format: 1 | 2 }
interface Ref { id: string; size: number }
interface Part { ref: Ref; rawHash: string; encodedHash: string; rawBytes: number; nonce: string }
const BATCH = 1_800_000;
const MAX_WIRE = 32_000_000;
const MAX_ACCOUNT = 128_000_000;
const MAX_CIPHER = MAX_CHUNK + 41;
export interface LoadedSync { cursor: string; ownVersion: number; modern: boolean; bootstrap?: boolean; snapshots: Map<string, unknown> }

function readRef(value: unknown): Ref {
  const { id, size } = object(value);
  requireSync(hashID(id) && int(size, 28, MAX_CIPHER));
  return { id, size };
}
function batches<T extends Ref>(items: T[]): T[][] {
  const result: T[][] = [];
  let next: T[] = [], size = 0;
  for (const item of items) {
    if (next.length === 256 || size + item.size > BATCH) { result.push(next); next = []; size = 0; }
    next.push(item); size += item.size;
  }
  if (next.length) result.push(next);
  return result;
}

/** A browser is a separate writer. The server checks the space cursor atomically at commit. */
export class SyncTransport {
  private cache = new Map<string, { version: number; size: number; format: 1 | 2; plain: number; snapshot: unknown }>();
  private keys = new Map<string, Promise<CryptoKey>>();
  readonly session: SyncSession;
  private decode: Decompress;
  private request: RequestSync;
  constructor(session: SyncSession, decode: Decompress, request: RequestSync = syncRequest) {
    this.session = session; this.decode = decode; this.request = request;
  }

  close() { this.cache.clear(); this.keys.clear(); this.session.master.fill(0); this.session.token = ''; }
  async realm() { return `luma-sync-v1.${await digest(utf8.encode(`${this.session.origin}:${this.session.spaceID}`))}`; }
  private aad(role: string, deviceID: string) { return utf8.encode(`${role}:${this.session.spaceID}:${deviceID}`); }
  private key(role: string) {
    let key = this.keys.get(role);
    if (!key) {
      key = derive(this.session.master, utf8.encode(this.session.spaceID), utf8.encode(role));
      this.keys.set(role, key);
    }
    return key;
  }
  private call(path: string, signal: AbortSignal, options: Parameters<RequestSync>[1] = {}) {
    signal.throwIfAborted();
    return this.request(path, { ...options, token: this.session.token, signal });
  }
  private async listing(signal: AbortSignal) {
    const listing = await this.call('/v1/snapshots', signal);
    requireSync(listing.transport === 2 && typeof listing.cursor === 'string' && /^[\w-]{43}$/.test(listing.cursor) &&
      Array.isArray(listing.snapshots) && listing.snapshots.length <= (listing.snapshotHistory === 1 ? 256 : 32));
    const seen = new Set<string>();
    const snapshots = listing.snapshots.map((item: unknown): Metadata => {
      const { deviceID, size, version, format } = object(item);
      requireSync(uuid(deviceID) && !seen.has(deviceID) && int(version, 1) && (format === 1 || format === 2) &&
        int(size, 28, format === 1 ? 2_000_000 : MAX_WIRE));
      seen.add(deviceID); return { deviceID, size, version, format };
    });
    return { cursor: listing.cursor, snapshots, bootstrap: !snapshots.length && listing.editorBootstrap === true };
  }
  async load(signal: AbortSignal): Promise<LoadedSync> {
    const before = await this.listing(signal);
    const snapshots = new Map<string, unknown>();
    let remaining = MAX_ACCOUNT;
    for (const metadata of before.snapshots) {
      const { deviceID, version, size, format } = metadata;
      const old = this.cache.get(deviceID);
      requireSync(!old || version >= old.version && (version > old.version || (size === old.size && format === old.format)));
      const next = old?.version === version ? old : { version, size, format, ...await this.fetchSnapshot(metadata, signal, remaining) };
      requireSync(next.plain <= remaining); remaining -= next.plain;
      this.cache.set(deviceID, next);
      snapshots.set(deviceID, next.snapshot);
    }
    requireSync([...this.cache.keys()].every(id => snapshots.has(id)));
    if ((await this.listing(signal)).cursor !== before.cursor) throw new SyncHTTPError(409);
    return { cursor: before.cursor, ownVersion: this.cache.get(this.session.deviceID)?.version ?? 0,
      modern: before.snapshots.some(item => item.format === 2), bootstrap: before.bootstrap, snapshots };
  }
  private async fetchSnapshot(meta: Metadata, signal: AbortSignal, budget: number) {
    const path = `/v2/snapshots/${meta.deviceID}`;
    const result = await this.call(path, signal, { max: 3_000_000 });
    if (result.version !== meta.version) throw new SyncHTTPError(409);
    requireSync(result.deviceID === meta.deviceID && result.format === meta.format);
    if (meta.format === 1) {
      const bytes = unbase64(result.payload, meta.size, meta.size, true);
      requireSync(bytes.length - 28 <= budget);
      const restored = await open(bytes, await this.key('luma-sync-content-v1'), this.aad('luma-sync-v1', meta.deviceID));
      return { plain: restored.length, snapshot: parse(restored) };
    }
    requireSync(Array.isArray(result.chunks) && result.chunks.length > 0 && result.chunks.length <= 4096);
    const refs: Ref[] = result.chunks.map(readRef);
    const wire = unbase64(result.payload, 1_000_000, 28, true);
    requireSync(refs.reduce((sum, ref) => sum + ref.size, wire.length) === meta.size);
    const manifest = object(parse(await open(wire, await this.key('luma-sync-manifest-v2'), this.aad('luma-sync-manifest-v2', meta.deviceID))));
    requireSync(manifest.schema === 2 && int(manifest.rawBytes, 1, Math.min(MAX_PLAIN, budget)) && hashID(manifest.rawHash) &&
      Array.isArray(manifest.parts) && manifest.parts.length === refs.length);
    const unique = new Map<string, Part>();
    const parts = manifest.parts.map((value: unknown, i: number): Part => {
      const { ref: rawRef, rawHash, rawBytes, encodedHash, nonce } = object(value);
      const ref = readRef(rawRef);
      requireSync(ref.id === refs[i].id && ref.size === refs[i].size && hashID(rawHash) && hashID(encodedHash) &&
        int(rawBytes, 1, MAX_CHUNK) && typeof nonce === 'string');
      unbase64(nonce, 12, 12);
      const part = { ref, rawHash, rawBytes, encodedHash, nonce };
      const previous = unique.get(ref.id);
      requireSync(!previous || JSON.stringify(previous) === JSON.stringify(part));
      unique.set(ref.id, part);
      return part;
    });
    requireSync(parts.reduce((sum, part) => sum + part.rawBytes, 0) === manifest.rawBytes);
    const decoded = new Map<string, Bytes>();
    for (const batch of batches([...unique.values()].map(part => part.ref))) {
      const reply = await this.call(`${path}/read`, signal, { method: 'POST', body: { version: meta.version, ids: batch.map(ref => ref.id) }, max: 2_600_000 });
      requireSync(Array.isArray(reply.chunks) && reply.chunks.length === batch.length);
      const needed = new Set(batch.map(ref => ref.id));
      for (const raw of reply.chunks) {
        const { id, payload } = object(raw);
        requireSync(hashID(id) && needed.delete(id));
        const part = unique.get(id)!;
        const cipher = unbase64(payload, part.ref.size, part.ref.size, true);
        requireSync(await digest(cipher) === id && base64(cipher.subarray(0, 12)) === part.nonce);
        const frame = await open(cipher, await this.key('luma-sync-chunk-v2'), this.aad('luma-sync-chunk-v2', meta.deviceID));
        requireSync(await digest(frame) === part.encodedHash);
        const plain = unpackChunk(frame, part.rawBytes, this.decode);
        requireSync(await digest(plain) === part.rawHash);
        decoded.set(id, plain);
      }
    }
    const expanded = join(parts.map(part => decoded.get(part.ref.id)!), manifest.rawBytes);
    requireSync(await digest(expanded) === manifest.rawHash);
    const restored = unwrapSnapshot(expanded, Math.min(budget, MAX_PLAIN));
    return { plain: Math.max(expanded.length, restored.length), snapshot: parse(restored) };
  }
  async publish(snapshot: unknown, baseline: LoadedSync, signal: AbortSignal) {
    if (!baseline.modern && !baseline.bootstrap) throw new SyncHTTPError(426);
    if ((await this.listing(signal)).cursor !== baseline.cursor) throw new SyncHTTPError(409);
    const raw = wrapSnapshot(json(snapshot));
    if (raw.length > MAX_WIRE - 100_000) throw new Error('sync_size');
    const device = this.session.deviceID;
    const path = `/v2/snapshots/${device}`;
    const parts: Part[] = [], chunks = new Map<string, { id: string; payload: string; size: number }>();
    for (let at = 0; at < raw.length; at += MAX_CHUNK) {
      signal.throwIfAborted();
      const bytes = raw.subarray(at, at + MAX_CHUNK), frame = packChunk(bytes);
      const cipher = await seal(frame, await this.key('luma-sync-chunk-v2'), this.aad('luma-sync-chunk-v2', device));
      const id = await digest(cipher);
      parts.push({ ref: { id, size: cipher.length }, rawHash: await digest(bytes), encodedHash: await digest(frame), rawBytes: bytes.length, nonce: base64(cipher.subarray(0, 12)) });
      chunks.set(id, { id, size: cipher.length, payload: base64(cipher, true) });
    }
    const manifest = json({ schema: 2, rawHash: await digest(raw), rawBytes: raw.length, parts });
    const payload = base64(await seal(manifest, await this.key('luma-sync-manifest-v2'), this.aad('luma-sync-manifest-v2', device)), true);
    const expectedVersion = baseline.ownVersion;
    const prepared = await this.call(`${path}/prepare`, signal, { method: 'POST', body: { expectedVersion, expectedCursor: baseline.cursor, payload, chunks: parts.map(part => part.ref) } });
    requireSync(hashID(prepared.publication) && Array.isArray(prepared.missing) && new Set(prepared.missing).size === prepared.missing.length);
    const needed = prepared.missing.map((id: unknown) => { requireSync(hashID(id) && chunks.has(id)); return chunks.get(id)!; });
    for (const batch of batches(needed)) {
      await this.call(`${path}/chunks`, signal, { method: 'PUT', body: { publication: prepared.publication, chunks: batch.map(({ id, payload }) => ({ id, payload })) } });
    }
    const commit = { method: 'PUT', body: { expectedVersion, publication: prepared.publication, expectedCursor: baseline.cursor } };
    // Retrying the identical commit also recovers a lost response without re-authoring the edit.
    let accepted;
    try { accepted = await this.call(path, signal, commit); }
    catch (error) {
      if (error instanceof SyncHTTPError && error.status < 500) throw error;
      accepted = await this.call(path, signal, commit);
    }
    requireSync(accepted.version === expectedVersion + 1);
  }
}
