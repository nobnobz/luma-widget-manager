// LumaCore LibraryShelfLayout: comma-separated IDs; omitted rows follow the
// default order. Hidden rows keep their positions.
export const libraryOrderField = 'library.shelf.order';
export const libraryShelves = [
  { id: 'calendar', label: 'Calendar', field: 'library.upcomingShortcut' },
  { id: 'watchlist', label: 'Watchlist', field: 'library.shelf.watchlist' },
  { id: 'recentlyWatched', label: 'Recently Watched', field: 'library.shelf.recentlyWatched' },
  { id: 'forYou', label: 'For You', field: 'library.shelf.forYou' },
  { id: 'becauseYouWatched', label: 'Because You Watched', field: 'library.shelf.becauseYouWatched' },
  { id: 'pinned', label: 'Custom Row', field: 'library.shelf.pinned' },
  { id: 'sources', label: 'More Libraries', field: 'library.shelf.sources' },
] as const;
type Shelf = typeof libraryShelves[number];
const byID: ReadonlyMap<string, Shelf> = new Map(libraryShelves.map(row => [row.id, row]));
const savedIDs = (value: string) => [...new Set(value.split(',').filter(Boolean))];
export const validLibraryOrder = (value: unknown): value is string =>
  typeof value === 'string' && new TextEncoder().encode(value).length <= 4096;
export function libraryShelfOrder(value: string): Shelf[] {
  const ids = savedIDs(value), seen = new Set(ids);
  return [...ids.flatMap(id => byID.get(id) ?? []), ...libraryShelves.filter(row => !seen.has(row.id))];
}
export function writeLibraryOrder(current: string, rows: readonly Shelf[]): string | null {
  let index = 0;
  const ids = savedIDs(current).map(id => byID.has(id) ? rows[index++].id : id);
  const next = [...ids, ...rows.slice(index).map(row => row.id)].join(',');
  return validLibraryOrder(next) ? next : null;
}
