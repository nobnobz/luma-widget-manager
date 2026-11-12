import { publicManifestURL } from './addons';

export const libraryRowField = 'library.shelf.pinnedList';
type AddonShelf = { source: { addon: { manifestURL: string; type: string; catalogID: string; paginated: boolean } }; name: string; origin?: string };
const clean = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
function publicCatalogAddress(value: string) {
  const url = publicManifestURL(value);
  if (!url) return false;
  const host = new URL(url).hostname;
  return !/\.(?:localhost|local|internal|lan|home\.arpa|test|invalid|example|onion)$/i.test(host) &&
    host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

/** LumaCore LibraryPinnedShelf.storageValue, restricted to anonymous add-ons. */
export function readLibraryRow(value: unknown): AddonShelf | null {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > 4096) return null;
  try {
    const row = JSON.parse(value), addon = row?.source?.addon;
    if (!addon || Object.keys(row.source).length !== 1 || !clean(row.name, 1024) || !row.name.trim() ||
        (row.origin !== undefined && !clean(row.origin, 256)) || typeof addon.manifestURL !== 'string' ||
        !publicCatalogAddress(addon.manifestURL) || typeof addon.type !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(addon.type) ||
        !clean(addon.catalogID, 1024) || !addon.catalogID || typeof addon.paginated !== 'boolean') return null;
    return { source: { addon: { manifestURL: addon.manifestURL, type: addon.type, catalogID: addon.catalogID, paginated: addon.paginated } },
      name: row.name, ...(row.origin !== undefined ? { origin: row.origin } : {}) };
  } catch { return null; }
}

export function makeLibraryRow(route: { manifestURL: string; mediaType: string; catalogID: string; title: string; provider?: string; paginated?: boolean }) {
  // Older catalog readers omit pagination. Luma's custom Library row loads the first page only.
  const value = JSON.stringify({ source: { addon: { manifestURL: route.manifestURL, type: route.mediaType,
    catalogID: route.catalogID, paginated: route.paginated === true } }, name: route.title || route.catalogID, origin: route.provider });
  return readLibraryRow(value) ? value : null;
}
