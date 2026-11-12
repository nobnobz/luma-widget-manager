/** Portable subset of LumaCore's AppleSyncedAddonReference wire type. */
export interface SyncAddon {
  id: string;
  manifestURL: string;
  name: string;
  enabled: boolean;
  order: number;
  [field: string]: unknown;
}

export const MAX_SYNC_ADDONS = 100;

/** Only anonymous root manifests are portable. Never redact part of a configured URL. */
export function publicManifestURL(input: string): string | null {
  const value = input.trim();
  if (value.length > 8192 || !/^https:\/\/[^/?#@\\\s]+\/manifest\.json$/i.test(value) ||
      !value.endsWith('/manifest.json')) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.replace(/\.$/, '');
  if (url.username || url.password || url.port || url.pathname !== '/manifest.json' ||
      !host.includes('.') || /^[0-9.:]+$/.test(host) || /\.(?:local|localhost)$/.test(host)) return null;
  return url.href;
}

/** The editor can display the public subset of a snapshot it cannot safely replace. */
export function projectSyncAddons(value: unknown): { addons: SyncAddon[]; complete: boolean } {
  if (!Array.isArray(value) || value.length > MAX_SYNC_ADDONS) throw new Error('Invalid Luma Sync add-on list.');
  let complete = true;
  const rows = value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { complete = false; return []; }
    const { id, name, enabled, order, manifestURL } = row as Record<string, unknown>;
    if (typeof manifestURL !== 'string' || !publicManifestURL(manifestURL) || typeof id !== 'string' ||
        typeof name !== 'string' || typeof enabled !== 'boolean' || typeof order !== 'number' || !Number.isSafeInteger(order)) {
      complete = false; return [];
    }
    return [{ ...row, id, name, enabled, order, manifestURL: manifestURL.trim() }];
  });
  rows.sort((a, b) => a.order - b.order || (a.manifestURL < b.manifestURL ? -1 : a.manifestURL > b.manifestURL ? 1 : 0));
  const seen = new Set<string>();
  const addons = rows.filter(row => {
    const url = publicManifestURL(row.manifestURL)!;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  return { addons, complete };
}

/** Keep unrecognized fields when an existing reference is edited. */
export function readSyncAddons(value: unknown): SyncAddon[] {
  const { addons, complete } = projectSyncAddons(value);
  if (!complete) throw new Error('Invalid or private Luma Sync add-on reference.');
  return addons;
}
