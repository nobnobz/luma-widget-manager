/** Browser preview only. Keep the saved URL untouched, including unsupported local links. */
export function previewArtworkURL(value: unknown, external: boolean): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  const raw = value.trim();
  if (!external && (/^data:image\/(?:png|gif|jpeg|webp|avif);base64,/i.test(raw) || /^blob:/i.test(raw) || /^\/(?!\/)/.test(raw))) return raw;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  if (external) {
    const host = url.hostname.replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.port || url.search || url.hash || !host.includes('.') ||
        /^[0-9.:]+$/.test(host) || /\.(?:local|localhost|internal|lan|home\.arpa)$/i.test(host)) return null;
  }
  return url.href;
}
