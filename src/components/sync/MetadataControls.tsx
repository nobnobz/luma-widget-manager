'use client';

import { useEffect, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type SyncAddon } from '@/lib/luma-sync/addons';
import { actorDefaultGenres, encodeGenrePreference, parseGenrePreference, personGenreDefaultsField, personGenreField,
  searchAddonField, searchAddonFingerprint, searchGenreField, tmdbGenres } from '@/lib/luma-sync/metadata-preferences';
import { editPersonLayout, personLayoutField, personMediaTypes, personRoles, personSections, personSorts, readPersonLayout,
  type PersonRole } from '@/lib/luma-sync/person-layout';
import { type PreferenceSettings } from '@/lib/luma-sync/preferences';
import { SortableRow, SortableRows } from './SortableRows';

type Props = { values: PreferenceSettings; unavailable: string[]; onChange: (values: PreferenceSettings) => void };
const knownGenres = new Set(tmdbGenres.map(([id]) => id));

export function GenreControl({ person, values, unavailable, onChange }: Props & { person: boolean }) {
  const field = person ? personGenreField : searchGenreField;
  const current = parseGenrePreference(values[field] ?? '', person) ?? [];
  const useDefaults = person && values[personGenreDefaultsField] !== true;
  const selected = new Set(useDefaults ? [...actorDefaultGenres, ...current] : current);
  const choices = person ? tmdbGenres : [...tmdbGenres, [-1, 'Without a genre'] as const];
  const [error, setError] = useState(false);
  if (unavailable.includes(field) || person && unavailable.includes(personGenreDefaultsField)) {
    return <p className="sync-setting-note">Excluded genres: edit in Luma.</p>;
  }
  function change(id: number, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    const value = encodeGenrePreference([...next], person);
    const accepted = parseGenrePreference(value, person) !== null;
    setError(!accepted);
    if (accepted) onChange({ ...values, [field]: value, ...(person ? { [personGenreDefaultsField]: true } : {}) });
  }
  return <details className="sync-record">
    <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" />Excluded genres
      <span className="sync-meta ml-auto">{selected.size || 'None'}</span></summary>
    {person && useDefaults && <p className="sync-setting-note">Luma’s default exclusions apply to acting credits.</p>}
    <div className="sync-genre-grid">
      {choices.map(([id, title]) => <label key={id} className="sync-setting-check">
        <input type="checkbox" checked={selected.has(id)} onChange={event => change(id, event.target.checked)} />{title}
      </label>)}
    </div>
    {[...selected].some(id => id > 0 && !knownGenres.has(id)) && <p className="sync-setting-note">Additional genres set in Luma are kept.</p>}
    {person && !useDefaults && <Button type="button" variant="ghost" size="sm" onClick={() => {
      const unknown = current.filter(id => !knownGenres.has(id));
      onChange({ ...values, [personGenreField]: unknown.length ? encodeGenrePreference(unknown, true) : null, [personGenreDefaultsField]: null });
      setError(false);
    }}>Restore default exclusions</Button>}
    {error && <p role="alert" className="sync-setting-hint text-destructive">This genre list is too large. Edit it in Luma.</p>}
  </details>;
}

export function SearchAddonControl({ values, unavailable, onChange, addons }: Props & { addons: readonly SyncAddon[] }) {
  const [loaded, setLoaded] = useState<{ key: string; options: [string, string][] }>({ key: '', options: [] });
  const addonKey = JSON.stringify(addons.filter(addon => addon.enabled).map(addon => [addon.manifestURL, addon.name]));
  useEffect(() => {
    let current = true;
    const enabled: [string, string][] = JSON.parse(addonKey);
    Promise.all(enabled.map(async ([url, name]): Promise<[string, string]> => [await searchAddonFingerprint(url), name || new URL(url).hostname]))
      .then(options => { if (current) setLoaded({ key: addonKey, options }); })
      .catch(() => { if (current) setLoaded({ key: addonKey, options: [] }); });
    return () => { current = false; };
  }, [addonKey]);
  if (values['metadata.searchProvider'] !== 'addons' && values['metadata.searchProvider'] !== 'aiometadata')
    return <p className="sync-setting-note">Choose Add-ons as the search provider to select an add-on.</p>;
  if (unavailable.includes(searchAddonField)) return <p className="sync-setting-note">Search add-on: edit in Luma.</p>;
  const options = loaded.key === addonKey ? loaded.options : [];
  const current = String(values[searchAddonField] ?? '');
  const isKnown = !current || options.some(([id]) => id === current);
  return <div className="sync-settings-grid">
    <div className="sync-setting sync-setting-wide"><label className="sync-profile">Search add-on
      <select value={isKnown ? current : '__native__'} disabled={loaded.key !== addonKey || (!options.length && !current)}
        onChange={event => {
          const id = event.target.value;
          if (!id || options.some(([option]) => option === id)) onChange({ ...values, [searchAddonField]: id || null });
        }}>
        <option value="">All searchable add-ons</option>
        {!isKnown && <option value="__native__" disabled>Set in Luma</option>}
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <p className="sync-setting-hint">If the selected add-on can’t search, Luma uses the other searchable add-ons.</p></div>
  </div>;
}

export function PersonSectionsEditor({ values, unavailable, onChange }: Props) {
  const [role, setRole] = useState<PersonRole>('actor');
  const [error, setError] = useState(false);
  const root = readPersonLayout(values[personLayoutField] ?? '');
  if (!root || unavailable.includes(personLayoutField)) return <p className="sync-setting-note">Filmography sections: edit in Luma.</p>;
  const rows = personSections(root, role);
  function update(edit: Parameters<typeof editPersonLayout>[2]) {
    const next = editPersonLayout(root!, role, edit);
    setError(next === null);
    if (next !== null) onChange({ ...values, [personLayoutField]: next });
  }
  return <details className="sync-record">
    <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" />Filmography sections</summary>
    <div className="sync-record-body">
      <label className="sync-profile">Role
        <select value={role} onChange={event => { setRole(event.target.value as PersonRole); setError(false); }}>
          {personRoles.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>
      <SortableRows ids={rows.map(row => row.id)} reorder={(from, to) => update({ order: arrayMove(rows, from, to).map(row => row.id) })}>
        {rows.map(row => {
          const shared = row.shared;
          const visible = shared ? values[shared] !== false : row.visible;
          return <SortableRow key={`${role}:${row.id}`} id={row.id} label={row.title}>
            <details className="sync-person-section">
              <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" />
                <span>{row.title}</span>{!visible && <span className="sync-meta ml-auto">Hidden</span>}
              </summary>
              {row.editable ? <div className="sync-record-body">
                <label className="sync-setting-check"><input type="checkbox" checked={visible} disabled={!!shared && unavailable.includes(shared)}
                  onChange={event => {
                    if (shared) onChange({ ...values, [shared]: event.target.checked });
                    else update({ id: row.id, field: 'visible', value: event.target.checked });
                  }} />{shared ? 'Show for all roles' : 'Show section'}</label>
                {row.mixed && <label className="sync-profile">Titles
                  <select value={row.type} onChange={event => update({ id: row.id, field: 'type', value: event.target.value })}>
                    {!personMediaTypes.some(([id]) => id === row.type) && <option value={row.type}>Set in Luma</option>}
                    {personMediaTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>}
                <label className="sync-profile">Sort by
                  <select value={row.sort} onChange={event => update({ id: row.id, field: 'sort', value: event.target.value })}>
                    {!personSorts.some(([id]) => id === row.sort) && <option value={row.sort}>Set in Luma</option>}
                    {personSorts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
              </div> : <p className="sync-setting-note px-3">Edit this section in Luma.</p>}
            </details>
          </SortableRow>;
        })}
      </SortableRows>
      {error && <p className="sync-setting-hint text-destructive" role="alert">This layout can’t be changed here. Edit it in Luma.</p>}
    </div>
  </details>;
}
