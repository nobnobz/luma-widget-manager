import { syncRequest, SyncHTTPError, type RequestSync } from './passkey';
import { requireSync, uuid } from './wire';

export interface SyncDevice { id: string; name: string; createdAt: number; revokedAt: number | null; browser: boolean }
const MAX_DEVICES = 1_000;
function time(value: unknown): number {
  requireSync(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value));
  const ms = Date.parse(value);
  requireSync(Number.isFinite(ms));
  return ms;
}
export function parseDevices(value: Record<string, unknown>): SyncDevice[] {
  const rows = value.devices;
  requireSync(Array.isArray(rows) && rows.length <= MAX_DEVICES);
  const seen = new Set<string>();
  return rows.map(row => {
    requireSync(typeof row === 'object' && row !== null && !Array.isArray(row));
    const item = row as Record<string, unknown>;
    requireSync(uuid(item.id) && !seen.has(item.id) && typeof item.name === 'string' && item.name.length <= 1024 &&
      (item.browser === undefined || item.browser === true) && (item.revokedAt === null || typeof item.revokedAt === 'string'));
    seen.add(item.id);
    return { id: item.id, name: item.name.trim(), createdAt: time(item.createdAt),
      revokedAt: item.revokedAt === null ? null : time(item.revokedAt), browser: item.browser === true };
  });
}
export class SyncDevices {
  private readonly token: string;
  private readonly request: RequestSync;
  constructor(token: string, request: RequestSync = syncRequest) { this.token = token; this.request = request; }
  async list(signal?: AbortSignal): Promise<SyncDevice[]> {
    return parseDevices(await this.request('/v1/devices', { token: this.token, signal, max: 1_000_000 }));
  }
  async remove(id: string, signal?: AbortSignal): Promise<void> {
    requireSync(uuid(id));
    try {
      const value = await this.request(`/v1/devices/${id}`, { token: this.token, signal, method: 'DELETE' });
      requireSync(value.ok === true);
    } catch (error) {
      // An already unknown device is as good as removed.
      if (!(error instanceof SyncHTTPError && error.status === 404)) throw error;
    }
  }
}
