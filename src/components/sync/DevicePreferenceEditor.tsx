'use client';

import { useId, useState } from 'react';
import { Laptop, Smartphone, Tv } from 'lucide-react';
import {
  deviceDefault, deviceGroups, deviceKey, deviceTypeLabels, deviceTypes, deviceValue,
  type DeviceType, type PreferenceField, type PreferenceSettings, type Scalar,
} from '@/lib/luma-sync/preferences';
import { PreferenceControl } from './PreferenceEditor';

const icons = { ios: Smartphone, tvos: Tv, macos: Laptop } as const;

function describe(field: PreferenceField, value: Scalar) {
  if (field.kind === 'toggle') return value ? 'On' : 'Off';
  if (field.kind === 'select') return field.options.find(([option]) => option === value)?.[1] ?? String(value);
  return field.kind === 'number' && field.unit ? `${value} ${field.unit}` : String(value);
}

/** Settings that apply only to devices of one type: each type has its own register, so one device never changes another. */
export function DevicePreferenceEditor({ values, unavailable, onChange }: {
  values: PreferenceSettings | null; unavailable: string[]; onChange: (next: PreferenceSettings) => void;
}) {
  const [type, setType] = useState<DeviceType>('ios'), id = useId();
  if (!values) return <section className="sync-panel"><h2>Per device</h2><p className="sync-empty">These settings can’t be edited here. Open them in Luma.</p></section>;
  return <section className="sync-panel" aria-labelledby={`${id}-title`}>
    <div className="sync-section-heading"><h2 id={`${id}-title`}>Per device</h2></div>
    <p className="sync-area-note">These settings apply only to devices of this type. Everything else applies to all devices of the profile.</p>
    <div role="tablist" aria-label="Device type" className="sync-device-tabs">
      {deviceTypes.map(item => {
        const Icon = icons[item];
        return <button key={item} type="button" role="tab" id={`${id}-tab-${item}`} aria-selected={type === item} aria-controls={`${id}-panel`}
          tabIndex={type === item ? 0 : -1} className="sync-device-tab" onClick={() => setType(item)}
          onKeyDown={event => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = deviceTypes[(deviceTypes.indexOf(item) + step + deviceTypes.length) % deviceTypes.length];
            setType(next);
            requestAnimationFrame(() => document.getElementById(`${id}-tab-${next}`)?.focus());
          }}><Icon aria-hidden className="size-4" /><span>{deviceTypeLabels[item]}</span></button>;
      })}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${type}`} className="sync-preference-groups">
      {deviceGroups.map((group, index) => <details key={group.title} className="sync-record sync-preference-group" open={index === 0 || undefined}>
        <summary className="sync-record-summary">{group.title}</summary>
        <div className="sync-settings-grid">{group.fields.map(source => {
          const field = source, fallback = deviceDefault(source, type), value = deviceValue(values, source.id, type);
          const key = deviceKey(source.id, type);
          return <PreferenceControl key={`${type}:${source.id}`} field={{ ...field, fallback } as PreferenceField} value={value}
            unavailable={unavailable.includes(key)}
            defaultHint={value !== null && value !== fallback ? `Default for ${deviceTypeLabels[type]}: ${describe(source, fallback)}` : undefined}
            onChange={next => onChange({ ...values, [key]: next })} />;
        })}</div>
      </details>)}
    </div>
  </section>;
}
