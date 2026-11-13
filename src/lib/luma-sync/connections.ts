import { syncRequest, SyncHTTPError, type RequestSync } from './passkey';
import { int, requireSync, uuid } from './wire';

export const managedProviders = ['trakt', 'simkl', 'mdblist'] as const;
export type ManagedProvider = typeof managedProviders[number];
export const providerNames = { trakt: 'Trakt', simkl: 'Simkl', mdblist: 'MDBList' };
export const connectionField = (provider: ManagedProvider) => `integrations.${provider}Connection`;
export const disconnected = 'disconnected';
export function connectionID(value: unknown, realm: string): string | undefined {
  if (value === undefined || value === disconnected) return undefined;
  requireSync(/^luma-sync-v1\.[0-9a-f]{64}$/.test(realm) && typeof value === 'string' && value.startsWith(`${realm}:`) && uuid(value.slice(realm.length + 1)));
  return value.slice(realm.length + 1);
}
export interface ConnectionStatus { id: string; username: string; needsReconnect?: boolean }
export interface ConnectionChallenge { id: string; userCode?: string; flow?: "pkce"; verificationURL: string; expiresIn: number; interval: number }
function identity(value: Record<string, unknown>): ConnectionStatus {
  requireSync(uuid(value.id) && typeof value.username === 'string' && !!value.username.trim() && value.username.length <= 1024 &&
    (value.needsReconnect === undefined || typeof value.needsReconnect === 'boolean'));
  return { id: value.id, username: value.username, needsReconnect: value.needsReconnect };
}
export class ManagedConnections {
  private readonly base: string;
  readonly provider: ManagedProvider;
  readonly profile: string;
  private token: string;
  private request: RequestSync;
  constructor(provider: ManagedProvider, profile: string, token: string, request: RequestSync = syncRequest) {
    requireSync(managedProviders.includes(provider) && /^[1-6]$/.test(profile));
    this.provider = provider; this.profile = profile; this.token = token; this.request = request;
    this.base = `/v1/connections/${provider}/${profile}/`;
  }
  private call(path: string, signal?: AbortSignal, method = 'GET', body?: unknown) {
    return this.request(this.base + path, { token: this.token, signal, method, body });
  }
  async start(attempt: string, signal: AbortSignal, traktPKCE = false,
              origin = typeof location === 'undefined' ? '' : location.origin): Promise<ConnectionChallenge> {
    requireSync(uuid(attempt) && (!traktPKCE || this.provider === 'trakt'));
    const value = await this.call('start', signal, 'POST', { attempt, ...(traktPKCE ? { flow: 'pkce' } : {}) });
    requireSync(uuid(value.id) && typeof value.verificationURL === 'string' && int(value.expiresIn, 1, 600) && int(value.interval, 1, 60));
    const url = new URL(value.verificationURL);
    requireSync(!url.username && !url.password && !url.hash);
    if (traktPKCE) {
      const params = url.searchParams;
      const read = (name: string) => params.get(name) ?? '';
      requireSync(value.flow === 'pkce' && value.userCode === undefined &&
        url.origin + url.pathname === 'https://auth.trakt.tv/oauth/authorize' && params.size === 6 &&
        origin.startsWith('https://') && read('redirect_uri') === origin + '/oauth/trakt/callback' &&
        read('response_type') === 'code' && read('code_challenge_method') === 'S256' &&
        /^[A-Za-z0-9_-]{8,256}$/.test(read('client_id')) &&
        /^[A-Za-z0-9_-]{43}$/.test(read('state')) && /^[A-Za-z0-9_-]{43}$/.test(read('code_challenge')));
      return { id: value.id, flow: 'pkce', verificationURL: url.href, expiresIn: value.expiresIn, interval: value.interval };
    }
    const expected = { trakt: 'https://auth.trakt.tv/activate', simkl: 'https://simkl.com/pin', mdblist: 'https://mdblist.com/oauth/device/' }[this.provider];
    requireSync(value.flow === undefined && typeof value.userCode === 'string' && /^[A-Z0-9-]{4,16}$/.test(value.userCode) &&
      url.origin + url.pathname === expected);
    if (this.provider === 'trakt') requireSync(url.searchParams.size === 0);
    else requireSync(url.searchParams.size === 1 && url.searchParams.get('user_code') === value.userCode);
    return { id: value.id, userCode: value.userCode, verificationURL: url.href, expiresIn: value.expiresIn, interval: value.interval };
  }
  async poll(id: string, signal: AbortSignal): Promise<{ state: 'pending'; interval: number } | { state: 'connected'; account: ConnectionStatus }> {
    requireSync(uuid(id));
    const value = await this.call(`${id}/poll`, signal, 'POST', {});
    if (value.state === 'pending') {
      requireSync(int(value.interval, 1, 60)); return { state: 'pending', interval: value.interval };
    }
    requireSync(value.state === 'connected' && value.id === id);
    return { state: 'connected', account: identity(value) };
  }
  async status(id: string, signal: AbortSignal) {
    requireSync(uuid(id));
    const value = identity(await this.call(id, signal));
    requireSync(value.id === id); return value;
  }
  async disconnect(id: string, signal?: AbortSignal) {
    requireSync(uuid(id));
    try {
      const reply = await this.call(id, signal, 'DELETE');
      requireSync(reply.ok === true && (reply.providerRevocationUnconfirmed === undefined || typeof reply.providerRevocationUnconfirmed === 'boolean'));
      return reply.providerRevocationUnconfirmed !== true;
    } catch (error) {
      if (!(error instanceof SyncHTTPError && error.status === 404)) throw error;
      return true;
    }
  }
  async cancel(id: string) {
    requireSync(uuid(id));
    try { await this.call(`${id}/cancel`, undefined, 'POST', {}); }
    catch (error) {
      if (!(error instanceof SyncHTTPError && error.status === 404)) throw error;
      // Approval can finish while cancellation is in flight. No reference has
      // been published by the caller yet, so remove that late grant as well.
      await this.disconnect(id);
    }
  }
}
export function waitForConnection(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
