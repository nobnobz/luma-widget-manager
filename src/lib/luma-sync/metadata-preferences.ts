// LumaCore: TMDBGenre, GenreExclusion, PersonFilmographyPreferences and
// SearchProviderSelection. Keep numeric IDs, not translated names, on the wire.
export const personGenreField = 'metadata.excludedPersonGenreIDs';
export const personGenreDefaultsField = 'metadata.personGenreDefaultsApplied';
export const searchGenreField = 'search.excludedGenres';
export const searchAddonField = 'search.addon';
export const actorDefaultGenres = [99, 10763, 10764, 10767];
export const tmdbGenres: readonly (readonly [number, string])[] = [
  [28, 'Action'], [10759, 'Action & Adventure'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'],
  [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'], [10751, 'Family'], [14, 'Fantasy'], [36, 'History'],
  [27, 'Horror'], [10762, 'Kids'], [10402, 'Musical'], [9648, 'Mystery'], [10763, 'News'], [10764, 'Reality'],
  [10749, 'Romance'], [878, 'Science Fiction'], [10765, 'Science Fiction & Fantasy'], [10766, 'Soap'],
  [10767, 'Talk'], [10770, 'TV Movie'], [53, 'Thriller'], [10752, 'War'], [10768, 'War & Politics'], [37, 'Western'],
];
export const fitsSharedString = (value: unknown): value is string =>
  typeof value === 'string' && new TextEncoder().encode(value).length <= 4096;
export function parseGenrePreference(value: unknown, person: boolean): number[] | null {
  if (!fitsSharedString(value)) return null;
  const raw = value.trim();
  if (!raw) return [];
  let values: unknown;
  if (person && raw.startsWith('[')) {
    try { values = JSON.parse(raw); } catch { return null; }
  } else {
    const tokens = raw.split(/[,|\s]+/).filter(Boolean);
    if (!tokens.length || tokens.some(token => !/^[+-]?\d+$/.test(token))) return null;
    values = tokens.map(Number);
  }
  if (!Array.isArray(values) || values.some(id => !Number.isSafeInteger(id))) return null;
  return [...new Set(values.filter(id => id > 0 || !person && id === -1))].sort((a, b) => a - b);
}
export function encodeGenrePreference(ids: readonly number[], person: boolean) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  return person ? JSON.stringify(sorted) : sorted.join(',');
}
export const validMetadataLanguage = (value: unknown): value is string =>
  fitsSharedString(value) && /^[A-Za-z]{2,8}(?:[_-][A-Za-z0-9]{2,8})*$/.test(value);
export const validSearchAddon = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || /^[a-f0-9]{64}$/.test(value));
export async function searchAddonFingerprint(manifestURL: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestURL));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
