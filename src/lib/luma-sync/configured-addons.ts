import { publicManifestURL } from './addons';
import { base64, derive, digest, int, json, object, open, parse, requireSync, seal, unbase64, utf8, type Bytes } from './wire';

export const configuredPrefix = 'addons.configured.v1.';
export const configuredMaxRecords = 512;
const purpose = 'luma-configured-addons-v1';
export type ConfiguredAddon = { id: string; manifestURL: string; name: string; enabled: boolean; order: number };
export type ConfiguredRegister = { revision: number; deviceID: string; value?: unknown };

export function configuredManifestURL(input: string): string | null {
  const value = input.trim().replace(/^stremio:\/\//i, 'https://');
  if (value.length > 4096 || !/^https:\/\/[a-z\d.-]+(?::443)?\/[^#\\\s]*$/i.test(value) ||
      /[^a-z\d._~:/?@!$&'()*+,;=%-]|%(?![a-f\d]{2})/i.test(value) || publicManifestURL(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.username || url.password || url.port || url.hash || !url.pathname.endsWith('/manifest.json') ||
        host.length > 253 || host.split('.').length < 2 || !/^[a-z]/.test(host.split('.').at(-1) ?? '') ||
        host.split('.').some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) ||
        /\.(?:local|localhost|internal|lan|home\.arpa|test|invalid|example|onion)$/.test(host)) return null;
    return value;
  } catch { return null; }
}

export const configuredID = (url: string) => digest(utf8.encode(url));
export function readConfigured(value: unknown, id: string): ConfiguredAddon {
  const { manifestURL, name, enabled, order } = object(value);
  requireSync(typeof manifestURL === 'string' && configuredManifestURL(manifestURL) === manifestURL &&
    typeof name === 'string' && utf8.encode(name).length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(name) &&
    typeof enabled === 'boolean' && int(order, 0, 99));
  return { id, manifestURL, name, enabled, order };
}

export class ConfiguredAddonCipher {
  private readonly key: Promise<CryptoKey>;
  private readonly realm: string;
  private readonly epoch?: string;
  constructor(master: Bytes, realm: string, epoch?: string) {
    this.realm = realm;
    this.epoch = epoch;
    this.key = derive(master, utf8.encode(realm), utf8.encode(purpose));
  }
  private aad(profile: string, id: string, revision: number, deviceID: string) {
    return utf8.encode([purpose, this.realm, profile, this.epoch ?? '', id, revision, deviceID].join('|'));
  }
  async open(profile: string, id: string, register: ConfiguredRegister) {
    requireSync(int(register.revision, 1) && /^[a-f0-9-]{36}$/.test(register.deviceID));
    const bytes = await open(unbase64(register.value, 6200, 28), await this.key, this.aad(profile, id, register.revision, register.deviceID));
    try {
      const entry = readConfigured(parse(bytes), id);
      requireSync(await configuredID(entry.manifestURL) === id);
      return entry;
    } finally { bytes.fill(0); }
  }
  async seal(profile: string, entry: ConfiguredAddon, revision: number, deviceID: string) {
    const { manifestURL, name, enabled, order } = readConfigured(entry, entry.id);
    requireSync(await configuredID(manifestURL) === entry.id);
    const bytes = json({ manifestURL, name, enabled, order });
    try {
      requireSync(bytes.length <= 6172);
      return base64(await seal(bytes, await this.key, this.aad(profile, entry.id, revision, deviceID)));
    }
    finally { bytes.fill(0); }
  }
}
