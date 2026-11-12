'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SyncAddon } from '@/lib/luma-sync/addons';
import { isSkipField, preferenceGroups, skipSchemaField, trackingGroups, validPreferenceValue, type PreferenceField, type PreferenceSettings, type Scalar } from '@/lib/luma-sync/preferences';
import { LibraryLayoutEditor } from './LibraryLayoutEditor';
import { GenreControl, PersonSectionsEditor, SearchAddonControl } from './MetadataControls';

export function PreferenceControl({ field, value, unavailable, onChange }: {
  field: PreferenceField; value?: Scalar | null; unavailable: boolean; onChange: (value: Scalar | null) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const [numberDraft, setNumberDraft] = useState<string>();
  const effective = value ?? field.fallback;
  if (unavailable) return <div className="sync-setting">
    <span>{field.label}</span><p className="sync-setting-hint">Edit in Luma.</p>
  </div>;
  if (field.kind === 'languages') {
    const list: string[] = JSON.parse(String(effective));
    function move(index: number, offset: number) {
      const next = [...list], to = index + offset;
      [next[index], next[to]] = [next[to], next[index]]; onChange(JSON.stringify(next));
    }
    return <div className="sync-setting sync-setting-wide"><div className="grid w-full gap-2">
      <p className="font-medium">{field.label}</p>
      <p className="sync-setting-hint">{list.length ? 'Luma tries these in order.' : 'Luma uses the system preference.'}</p>
      {!!list.length && <ol className="grid gap-1">{list.map((language, index) => <li className="sync-language" key={language}>
        <span>{index + 1}. {language}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={`Move ${language} up`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label={`Move ${language} down`} disabled={index === list.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${language}`} onClick={() => onChange(JSON.stringify(list.filter(item => item !== language)))}><X /></Button>
      </li>)}</ol>}
      {list.length < field.options.length && <label className="sync-profile">Add subtitle language
        <select value="" onChange={event => {
          const language = event.target.value;
          if (field.options.includes(language) && !list.includes(language)) onChange(JSON.stringify([...list, language]));
        }}><option value="">Choose a language</option>
          {field.options.filter(language => !list.includes(language)).map(language => <option key={language}>{language}</option>)}</select>
      </label>}
    </div></div>;
  }
  return <div className="sync-setting">
    {field.kind === 'toggle' ? <label className="sync-setting-check">
      <input type="checkbox" checked={effective === true} onChange={event => onChange(event.target.checked)} /><span>{field.label}</span>
    </label> : <label className="sync-profile">
      {field.label}
      {field.kind === 'select' || field.kind === 'locale' ? <select value={effective === null ? '__default__' : String(effective)} onChange={event => {
        const option = field.options.find(([item]) => String(item) === event.target.value);
        if (option) onChange(option[0]);
        else if (event.target.value === '__default__') onChange(null);
      }}>
        {field.fallback === null && <option value="__default__">{isSkipField(field.id) ? 'Use app setting' : 'Automatic'}</option>}
        {field.kind === 'locale' && typeof effective === 'string' && !field.options.some(([item]) => item === effective) &&
          <option value={effective}>{effective}</option>}
        {field.options.map(([option, label]) => <option key={String(option)} value={String(option)}>{label}</option>)}
      </select> : <span className="sync-setting-number">
        <Input type="number" inputMode={field.step < 1 ? 'decimal' : 'numeric'}
          value={numberDraft ?? (typeof effective === 'number' ? String(effective) : '')} placeholder={effective === null ? 'No limit' : undefined}
          min={field.min} max={field.max} step={field.step < 1 ? 'any' : field.step} aria-invalid={invalid || undefined}
          onChange={event => {
            const input = event.currentTarget, number = input.valueAsNumber;
            setNumberDraft(input.value);
            if (!input.validity.badInput && input.value === '' && field.fallback === null) {
              setInvalid(false); onChange(null); return;
            }
            const accepted = validPreferenceValue(field.id, number);
            setInvalid(!accepted);
            if (accepted) onChange(number);
          }}
          onBlur={() => { setNumberDraft(undefined); setInvalid(false); }} />
        {field.unit && <span>{field.unit}</span>}
      </span>}
    </label>}
    {value != null && <Button variant="ghost" type="button" size="icon" aria-label={`Reset ${field.label}`} title="Restore app default"
      onClick={() => { setNumberDraft(undefined); setInvalid(false); onChange(null); }}><RotateCcw className="size-4" /></Button>}
    {invalid && field.kind === 'number' && <p className="sync-setting-hint text-destructive" role="status">Enter a number from {field.min} to {field.max}.</p>}
  </div>;
}

export function PreferenceEditor({ section, values, unavailable, addons, onChange }: {
  section: 'tracking' | 'preferences';
  values: PreferenceSettings | null;
  unavailable: string[];
  addons: readonly SyncAddon[];
  onChange: (next: PreferenceSettings) => void;
}) {
  const [query, setQuery] = useState('');
  const tracking = section === 'tracking', title = tracking ? 'Tracking' : 'Preferences';
  if (!values) return <section className="sync-panel"><h2>{title}</h2><p className="sync-empty">These settings can’t be edited here. Open them in Luma.</p></section>;
  const search = query.trim().toLowerCase();
  const groups = (tracking ? trackingGroups : preferenceGroups).map(group => {
    const all = !search || group.title.toLowerCase().includes(search);
    const matches = (label: string) => all || label.includes(search);
    const addon = group.title === 'Search' && matches('search add-on');
    return { ...group, fields: all ? group.fields : group.fields.filter(field => matches(field.label.toLowerCase()) ||
      addon && field.id === 'metadata.searchProvider'),
      genres: ['Search', 'Person pages'].includes(group.title) && matches('excluded genres'),
      addon,
      filmography: group.title === 'Person pages' && matches('filmography sections actor director writer known for timeline') };
  }).filter(group => group.fields.length || group.genres || group.addon || group.filmography);
  return <section className="sync-panel" aria-labelledby="sync-preferences-title">
    <div className="sync-section-heading">
      <h2 id="sync-preferences-title">{title}</h2>
      {!tracking && <div className="sync-settings-search"><Search aria-hidden className="size-4" />
        <Input type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <Button type="button" size="icon" variant="ghost" aria-label="Clear settings search" onClick={event => {
          const input = event.currentTarget.parentElement?.querySelector('input');
          setQuery(''); input?.focus();
        }}><X /></Button>}
      </div>}
    </div>
    {!groups.length && <p className="sync-empty" role="status">No settings found for “{query.trim()}”.</p>}
    <div className="sync-preference-groups">
    {groups.map((group, i) => <details key={group.title} className="sync-record sync-preference-group" open={!!search || i === 0 || undefined}>
      <summary className="sync-record-summary"><ChevronRight aria-hidden className="sync-chevron size-4" />{group.title}</summary>
      {tracking && group.title === 'Sources' && <p className="sync-setting-note">Choose which connected accounts Luma uses for watch progress and watchlists. Source selection does not connect an account. Use Sync watch activity above for two-way sync.</p>}
      {tracking && group.title === 'Library' && <LibraryLayoutEditor values={values} unavailable={unavailable} onChange={onChange} />}
      {!!group.fields.length && <div className="sync-settings-grid">{group.fields.map(field => <PreferenceControl key={field.id} field={field} value={values[field.id]}
        unavailable={unavailable.includes(field.id)} onChange={value => {
          const next = { ...values, [field.id]: value };
          if (isSkipField(field.id)) next[skipSchemaField] = 1;
          if (field.id === 'progress.source' && !unavailable.includes('progress.chosen')) next['progress.chosen'] = value !== null;
          onChange(next);
        }} />)}
      </div>}
      {group.addon && <SearchAddonControl addons={addons} values={values} unavailable={unavailable} onChange={onChange} />}
      {group.genres && <GenreControl person={group.title === 'Person pages'} values={values} unavailable={unavailable} onChange={onChange} />}
      {group.filmography && <PersonSectionsEditor values={values} unavailable={unavailable} onChange={onChange} />}
    </details>)}
    </div>
  </section>;
}
