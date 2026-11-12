export type Bytes = Uint8Array<ArrayBuffer>;
export type JSONObject = Record<string, unknown>;
export const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_PLAIN = 64_000_000;
export const MAX_CHUNK = 256_000;
export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export const hashID = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const int = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function requireSync(value: unknown): asserts value { if (!value) throw new Error('invalid_sync_data'); }
export function object(value: unknown): JSONObject {
  requireSync(value && typeof value === 'object' && !Array.isArray(value));
  return value as JSONObject;
}
export const parse = (value: Bytes): unknown => JSON.parse(decoder.decode(value));
export const json = (value: unknown) => utf8.encode(JSON.stringify(value));
export function base64(value: Bytes, url = false): string {
  let binary = '';
  for (let i = 0; i < value.length; i += 8192) binary += String.fromCharCode(...value.subarray(i, i + 8192));
  const encoded = btoa(binary);
  return url ? encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : encoded;
}
export function unbase64(value: unknown, max: number, min = 1, url = false): Bytes {
  requireSync(typeof value === 'string' && value.length <= Math.ceil(max / 3) * 4 &&
    (url ? /^[A-Za-z0-9_-]*$/ : /^[A-Za-z0-9+/]*={0,2}$/).test(value));
  const decoded = Uint8Array.from(atob(url ? value.replaceAll('-', '+').replaceAll('_', '/') : value), c => c.charCodeAt(0));
  requireSync(decoded.length >= min && decoded.length <= max && base64(decoded, url) === value);
  return decoded;
}
export function join(parts: Bytes[], length = parts.reduce((sum, part) => sum + part.length, 0)): Bytes {
  const result = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  requireSync(at === length);
  return result;
}
export const digest = async (bytes: Bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
export async function derive(secret: Bytes, salt: Bytes, info: Bytes) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function open(cipher: Bytes, key: CryptoKey, aad: Bytes): Promise<Bytes> {
  requireSync(cipher.length >= 28);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: cipher.subarray(0, 12), additionalData: aad }, key, cipher.subarray(12)));
}
export async function seal(plain: Bytes, key: CryptoKey, aad: Bytes): Promise<Bytes> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, key, plain);
  return join([nonce, new Uint8Array(cipher)]);
}
function header(magic: string, ...numbers: number[]): Bytes {
  const bytes = new Uint8Array(4 + 4 * numbers.length);
  bytes.set(utf8.encode(magic));
  const view = new DataView(bytes.buffer);
  numbers.forEach((n, i) => view.setUint32(4 + 4 * i, n));
  return bytes;
}
const hasMagic = (bytes: Bytes, magic: string) => utf8.encode(magic).every((n, i) => n === bytes[i]);
export const wrapSnapshot = (bytes: Bytes) => join([header('LSX1'), Uint8Array.of(0), header('LSX1', bytes.length).subarray(4), bytes]);
export function unwrapSnapshot(bytes: Bytes, limit: number, depth = 0): Bytes {
  requireSync(depth <= 8 && bytes.length <= MAX_PLAIN && hasMagic(bytes, 'LSX1'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Bytes[] = [];
  let length = 0;
  for (let at = 4; at < bytes.length;) {
    requireSync(bytes.length - at >= 5);
    const tag = bytes[at]; const count = view.getUint32(at + 1); at += 5;
    requireSync(count <= bytes.length - at && tag <= 2);
    let body = bytes.subarray(at, at + count); at += count;
    if (tag) {
      const raw = unwrapSnapshot(body, Math.floor((limit - length) / 4) * 3, depth + 1);
      const encoded = base64(raw);
      body = utf8.encode(tag === 2 ? encoded.replaceAll('/', '\\/') : encoded);
    }
    length += body.length; requireSync(length <= limit);
    parts.push(body);
  }
  return join(parts, length);
}
export const packChunk = (bytes: Bytes) => join([header('LSC2', bytes.length, bytes.length), Uint8Array.of(0), bytes]);
export type Decompress = (bytes: Bytes, size: number) => Bytes;
export function unpackChunk(frame: Bytes, expected: number, decompress: Decompress): Bytes {
  requireSync(frame.length >= 13 && hasMagic(frame, 'LSC2') && int(expected, 1, MAX_CHUNK));
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const body = frame.subarray(13);
  requireSync(view.getUint32(4) === expected && view.getUint32(8) === body.length && body.length <= MAX_CHUNK);
  const output = frame[12] === 0 ? body : frame[12] === 1 ? decompress(body, expected) : null;
  requireSync(output?.length === expected);
  return output;
}
export async function lzfseDecoder(wasm: ArrayBuffer): Promise<Decompress> {
  const { instance } = await WebAssembly.instantiate(wasm);
  const codec = instance.exports as { memory: WebAssembly.Memory; input: () => number; output: () => number; decode: (length: number, size: number) => number };
  return (bytes, size) => {
    requireSync(int(bytes.length, 1, MAX_CHUNK) && int(size, 1, MAX_CHUNK));
    const memory = new Uint8Array(codec.memory.buffer);
    const input = codec.input(), output = codec.output();
    memory.set(bytes, input);
    try {
      requireSync(codec.decode(bytes.length, size) === 1);
      return memory.slice(output, output + size);
    } finally {
      memory.fill(0, input, input + bytes.length);
      memory.fill(0, output, output + size + 1);
    }
  };
}
