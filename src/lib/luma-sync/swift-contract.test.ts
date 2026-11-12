import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deviceDefault, deviceGroups, deviceTypes, validPreferenceValue } from './preferences';

// Contract check against the native catalog (source of truth). Set LUMA_SWIFT_CATALOG to its path; skipped when the file is not available.
const path = process.env.LUMA_SWIFT_CATALOG ?? '/Volumes/Jarvis SSD/Codex/Luma-sync-next/Packages/LumaCore/Sources/LumaDomain/SharedPreferences.swift';
const source = await readFile(path, 'utf8').catch(() => null);
const constants: Record<string, string> = { 'StreamSourcePresentationPreference.placement': 'playback.formatter.placement', 'StreamSourcePresentationPreference.size': 'playback.formatter.size' };
const literal = (text: string) => { const v = text.trim(); return v.startsWith('.bool(') ? v.slice(6, -1) === 'true' : v.startsWith('.integer(') ? Number(v.slice(9, -1)) : v.startsWith('.string(') ? v.slice(9, -2) : null; };

function definitions() {
  const found = new Map<string, { perDevice?: Record<string, unknown>; fallback: unknown }>();
  for (const line of source!.split('\n').filter(item => item.includes('.init(') && item.includes('default:'))) {
    const id = /\.init\("([^"]+)"/.exec(line)?.[1] ?? constants[/\.init\(([\w.]+),/.exec(line)?.[1] ?? ''];
    if (!id) continue;
    const fallback = literal(/default: (\.[a-z]+\([^)]*\)|nil)/.exec(line)?.[1] ?? 'nil');
    const device = /perDevice: \[([^\]]*)\]/.exec(line)?.[1];
    found.set(id, { fallback, perDevice: device === undefined ? undefined : Object.fromEntries([...device.matchAll(/\.(ios|tvos|macos): (\.[a-z]+\([^)]*\))/g)].map(match => [match[1], literal(match[2])])) });
  }
  return found;
}

test('the per-device ids and per-type defaults match the native catalog', { skip: source === null && `native catalog not found at ${path}` }, () => {
  const native = definitions();
  const nativeIds = [...native].filter(([, item]) => item.perDevice).map(([id]) => id).sort();
  const portal = deviceGroups.flatMap(group => group.fields);
  assert.deepEqual(portal.map(item => item.id).sort(), nativeIds);
  for (const item of portal) {
    const definition = native.get(item.id)!;
    for (const type of deviceTypes) {
      assert.equal(deviceDefault(item, type), definition.perDevice![type] ?? definition.fallback, `${item.id}@${type}`);
    }
  }
  // Profile-wide: the new sort field exists with the native strings.
  assert.ok(native.has('playback.streamSort') && !native.get('playback.streamSort')!.perDevice);
  for (const value of ['Default', 'Quality', 'Size', 'Name']) assert.equal(validPreferenceValue('playback.streamSort', value), true);
  assert.equal(validPreferenceValue('playback.streamSort', 'Date'), false);
  for (const count of [5, 10, 15, 20]) assert.equal(validPreferenceValue('home.heroItemCount@tvos', count), true);
  assert.equal(validPreferenceValue('home.heroItemCount@tvos', 7), false);
});
