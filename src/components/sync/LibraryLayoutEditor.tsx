'use client';

import { useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { libraryOrderField, libraryShelfOrder, libraryShelves, writeLibraryOrder } from '@/lib/luma-sync/library-layout';
import { libraryRowField, makeLibraryRow, readLibraryRow } from '@/lib/luma-sync/library-row';
import type { PreferenceSettings } from '@/lib/luma-sync/preferences';
import { LibraryCatalogPicker } from './SyncCatalogs';
import { SortableRow, SortableRows } from './SortableRows';

export function LibraryLayoutEditor({ values, unavailable, onChange }: {
  values: PreferenceSettings; unavailable: string[]; onChange: (next: PreferenceSettings) => void;
}) {
  const [error, setError] = useState(''), [rowError, setRowError] = useState(false);
  const value = values[libraryOrderField], storedOrder = typeof value === 'string' ? value : '';
  const orderAvailable = !unavailable.includes(libraryOrderField);
  const rows = libraryShelfOrder(storedOrder);
  const custom = readLibraryRow(values[libraryRowField]);
  function reorder(next: typeof rows) {
    const order = writeLibraryOrder(storedOrder, next);
    setError(order === null ? 'This row order is too large. Edit it in Luma.' : '');
    if (order !== null) onChange({ ...values, [libraryOrderField]: order });
  }

  return <section className="sync-library-layout" aria-labelledby="library-rows-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="library-rows-title" className="font-semibold">Library rows</h3>
      {orderAvailable && rows.some((row, index) => row !== libraryShelves[index]) &&
        <Button type="button" variant="outline" size="sm" onClick={() => reorder([...libraryShelves])}>Restore default order</Button>}
    </div>
    <p className="sync-setting-hint">Drag rows into order. Turn off any rows you want to hide.</p>
    <SortableRows ids={orderAvailable ? rows.map(row => row.id) : []} reorder={(from, to) => reorder(arrayMove(rows, from, to))}>
      {rows.map(row => {
        const editable = !unavailable.includes(row.field);
        const control = <label className="sync-library-visibility">
          <span>{row.label}</span>
          {editable ? <span className="sync-library-toggle"><span aria-hidden="true">{values[row.field] === false ? 'Hidden' : 'Shown'}</span>
            <input type="checkbox" aria-label={`Show ${row.label}`} checked={values[row.field] !== false}
              onChange={event => onChange({ ...values, [row.field]: event.target.checked })} /></span>
            : <span className="sync-meta">Edit in Luma</span>}
        </label>;
        return orderAvailable ? <SortableRow key={row.id} id={row.id} label={row.label}>{control}</SortableRow>
          : <div key={row.id}>{control}</div>;
      })}
    </SortableRows>
    {error && <p role="alert" className="sync-setting-hint text-destructive">{error}</p>}
    <div className="sync-library-catalog">
      <div className="min-w-0">
        <p className="font-medium">Custom row</p>
        <p className="sync-setting-hint break-words">{unavailable.includes(libraryRowField) ? 'Manage this source in Luma.'
          : custom ? [custom.origin, custom.name].filter(Boolean).join(' · ') : 'Choose an installed catalog. For private lists, use Luma.'}</p>
      </div>
      {!unavailable.includes(libraryRowField) && <div className="flex flex-wrap items-center gap-2">
        <LibraryCatalogPicker label={custom ? 'Change catalog' : 'Choose catalog'} onSelect={route => {
          const value = makeLibraryRow(route);
          setRowError(value === null);
          if (value !== null) onChange({ ...values, [libraryRowField]: value });
        }} />
        {custom && <Button type="button" variant="outline" className="sync-danger-outline" size="sm" onClick={() => {
          setRowError(false); onChange({ ...values, [libraryRowField]: null });
        }}>Remove catalog</Button>}
      </div>}
      {rowError && <p className="sync-setting-hint text-destructive" role="alert">This catalog can’t be used for a Library row.</p>}
    </div>
  </section>;
}
