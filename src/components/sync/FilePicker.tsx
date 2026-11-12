'use client';

import { useState } from 'react';
import { FileUp } from 'lucide-react';

export function FilePicker({ label, disabled, onPick }: { label: string; disabled?: boolean; onPick: (file: File) => void }) {
  const [name, setName] = useState('');
  return <div className="sync-file-picker">
    <label className="sync-file-button">
      <input type="file" className="sr-only" aria-label={label} disabled={disabled} accept=".json,application/json"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) { setName(file.name); onPick(file); }
        }} />
      <FileUp aria-hidden className="size-4 shrink-0" /> Choose JSON file
    </label>
    {name && <span role="status" className="sync-file-name" title={name}>{name}</span>}
  </div>;
}
