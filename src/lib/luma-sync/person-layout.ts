import { fitsSharedString } from './metadata-preferences';

// LumaCore PersonSectionLayoutPolicy / SettingsDocument. Unknown keys and
// order entries belong to the client that created them and survive edits.
export const personLayoutField = 'metadata.personSectionLayout';
export const personRoles = [['actor', 'Actor'], ['director', 'Director'], ['writer', 'Writer']] as const;
export type PersonRole = typeof personRoles[number][0];
export const personSorts = [
  ['default', 'Luma default'], ['mostVoted', 'Most voted'], ['leastVoted', 'Least voted'],
  ['popular', 'Most popular'], ['leastPopular', 'Least popular'], ['newest', 'Latest release first'],
  ['oldest', 'Earliest release first'], ['topRated', 'Highest rated'], ['lowestRated', 'Lowest rated'],
  ['title', 'Title A–Z'], ['titleDescending', 'Title Z–A'],
] as const;
export const personMediaTypes = [['all', 'Movies & Shows'], ['movies', 'Movies'], ['series', 'Shows']] as const;
const commonVisibility = { knownFor: 'metadata.personShowKnownFor', timeline: 'metadata.personShowTimeline' } as const;
type MapValue = Record<string, unknown>;
const isObject = (value: unknown): value is MapValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (map: MapValue, key: string) => Object.hasOwn(map, key) ? map[key] : undefined;
const child = (map: MapValue, key: string) => { const value = own(map, key); return isObject(value) ? value : {}; };
const shapeOK = (map: MapValue, key: string) => own(map, key) === undefined || isObject(own(map, key));
export function readPersonLayout(value: unknown): MapValue | null {
  if (!fitsSharedString(value)) return null;
  if (!value) return {};
  try {
    const root: unknown = JSON.parse(value);
    return isObject(root) && (!Object.hasOwn(root, 'version') || root.version === 1) && shapeOK(root, 'roles') ? root : null;
  } catch { return null; }
}
const definitions = (role: PersonRole) => [
  { id: 'knownFor', title: 'Known For', shared: commonVisibility.knownFor, mixed: true },
  { id: role === 'director' ? 'directedMovies' : 'movies', title: role === 'director' ? 'Films Directed' : 'Movies', mixed: false },
  { id: role === 'director' ? 'directedSeries' : 'series', title: role === 'director' ? 'Series Directed' : 'Series', mixed: false },
  { id: 'upcoming', title: 'Coming Soon', mixed: true }, { id: 'planned', title: 'Planned', mixed: true },
  { id: 'timeline', title: 'Timeline', shared: commonVisibility.timeline, mixed: true },
];
export function personSections(root: MapValue, role: PersonRole) {
  const roleMap = child(child(root, 'roles'), role), sections = child(roleMap, 'sections');
  const known = definitions(role), byID = new Map(known.map(row => [row.id, row]));
  const ids = Array.isArray(roleMap.order) ? [...new Set(roleMap.order.filter(id => typeof id === 'string' && byID.has(id)))] : [];
  return [...ids.flatMap(id => byID.get(id) ?? []), ...known.filter(row => !ids.includes(row.id))].map(row => {
    const entry = child(sections, row.id);
    return { ...row, editable: shapeOK(roleMap, 'sections') && shapeOK(sections, row.id),
      visible: typeof entry.visible === 'boolean' ? entry.visible : row.id !== 'planned',
      type: typeof entry.type === 'string' ? entry.type : 'all', sort: typeof entry.sort === 'string' ? entry.sort : 'default' };
  });
}
export function editPersonLayout(root: MapValue, role: PersonRole, edit:
  { order: string[] } | { id: string; field: 'visible' | 'type' | 'sort'; value: boolean | string },
) {
  const roles = child(root, 'roles');
  if (!shapeOK(roles, role)) return null;
  const original = child(roles, role), roleMap = { ...original };
  const known = new Set(definitions(role).map(row => row.id));
  if ('order' in edit) {
    if (original.order !== undefined && !Array.isArray(original.order)) return null;
    const order = [...new Set(edit.order.filter(id => known.has(id)))];
    if (order.length !== known.size) return null;
    let index = 0;
    const entries = Array.isArray(original.order) ? original.order : [];
    const retained = entries.flatMap(id => typeof id === 'string' && known.has(id) ? order.slice(index, ++index) : [id]);
    roleMap.order = [...retained, ...order.slice(index)];
  } else {
    if (!known.has(edit.id) || !shapeOK(original, 'sections')) return null;
    const sections = child(original, 'sections');
    if (!shapeOK(sections, edit.id)) return null;
    roleMap.sections = { ...sections, [edit.id]: { ...child(sections, edit.id), [edit.field]: edit.value } };
  }
  const result = JSON.stringify({ ...root, version: 1, roles: { ...roles, [role]: roleMap } });
  return fitsSharedString(result) ? result : null;
}
