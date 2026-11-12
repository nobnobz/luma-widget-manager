import { previewArtworkURL } from '../preview-artwork';
import { requireSync, utf8, object, type JSONObject } from './wire';

export const FORMATTER_FIELD = 'playback.formatterTags';
export const FORMATTER_LIMIT = 3;
export const MAX_FORMATTER_FILE = 2_000_000;
const MAX_RULES = 6_000_000;

export interface FormatterTag extends JSONObject { name: string; pattern: string; isEnabled?: boolean }
export interface FormatterPack extends JSONObject { sourceUrl: string; isActive?: boolean; filters: FormatterTag[]; groups?: JSONObject[] }

function optional(raw: JSONObject, key: string, type: 'string' | 'boolean') {
  requireSync(raw[key] == null || typeof raw[key] === type);
}
function tagImage(value: unknown, builtin: boolean): string | null {
  const safe = previewArtworkURL(value, true);
  if (safe || !builtin || typeof value !== 'string') return safe;
  const path = /^https:\/\/github\.com\/nobnobz\/Omni-Template-Bot-Bid-Raiser\/blob\/main\/(Other\/[^?#]+)\?raw=(?:true|1)$/i.exec(value);
  return path ? previewArtworkURL(`https://raw.githubusercontent.com/nobnobz/Omni-Template-Bot-Bid-Raiser/main/${path[1]}`, true) : null;
}
export function formatterArtworkURL(tag: FormatterTag) {
  // Normalize the shipped UME link without changing the saved pack.
  return tagImage(tag.imageURL ?? tag.imageUrl, true);
}
export function isUMEArtwork(url: string) {
  return url.startsWith('https://raw.githubusercontent.com/nobnobz/Omni-Template-Bot-Bid-Raiser/main/Other/');
}
function readTag(input: unknown, imported: boolean, builtin = false): FormatterTag {
  const raw = object(input);
  for (const key of ['id', 'groupId', 'name', 'pattern', 'imageURL', 'imageUrl', 'tagColor', 'tagStyle', 'textColor', 'borderColor']) optional(raw, key, 'string');
  optional(raw, 'isEnabled', 'boolean');
  requireSync(typeof raw.name === 'string' && raw.name.trim() && typeof raw.pattern === 'string' && raw.pattern.trim());
  const image = raw.imageURL ?? raw.imageUrl;
  const safe = imported && image ? tagImage(image, builtin) : undefined;
  if (imported && image) requireSync(safe);
  return { ...raw, ...(safe ? { imageURL: safe, imageUrl: undefined } : {}), name: raw.name, pattern: raw.pattern };
}
function readGroups(input: unknown): JSONObject[] | undefined {
  if (input == null) return undefined;
  requireSync(Array.isArray(input));
  return input.map(value => {
    const raw = object(value);
    for (const key of ['id', 'name', 'color']) optional(raw, key, 'string');
    optional(raw, 'isExpanded', 'boolean');
    return raw;
  });
}
export function readFormatter(value: unknown): FormatterPack[] {
  requireSync(typeof value === 'string' && utf8.encode(value).length <= MAX_RULES);
  const { imports } = object(JSON.parse(value));
  requireSync(Array.isArray(imports) && imports.length <= FORMATTER_LIMIT);
  const seen = new Set<string>();
  return imports.map(value => {
    const raw = object(value);
    const source = raw.sourceUrl ?? raw.sourceURL;
    requireSync(typeof source === 'string' && source.trim() && Array.isArray(raw.filters) && raw.filters.length);
    const sourceUrl = source.trim();
    requireSync(!seen.has(sourceUrl.toLowerCase())); seen.add(sourceUrl.toLowerCase());
    optional(raw, 'isActive', 'boolean');
    return { ...raw, sourceUrl, filters: raw.filters.map(tag => readTag(tag, false)), groups: readGroups(raw.groups) };
  });
}
export function formatterValue(packs: FormatterPack[]) {
  if (!packs.length) return undefined; // explicit register reset, not an absent field
  const wire = JSON.stringify({ imports: packs });
  readFormatter(wire);
  return wire;
}
export function importFormatterPack(text: string, fileName: string, builtin = false): FormatterPack {
  requireSync(utf8.encode(text).length <= MAX_FORMATTER_FILE);
  const { filters, groups } = object(JSON.parse(text));
  requireSync(Array.isArray(filters) && filters.length);
  const name = fileName.trim().slice(0, 128).replace(/[\u0000-\u001F\u007F]/g, '');
  requireSync(name);
  return { sourceUrl: 'file:' + name, filters: filters.map(tag => readTag(tag, true, builtin)), groups: readGroups(groups), isActive: true };
}
