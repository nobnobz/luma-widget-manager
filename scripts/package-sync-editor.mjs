import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('out');
const target = resolve(process.env.LUMA_WIDGET_EDITOR_PACKAGE_OUTPUT || 'build/sync-editor');
const site = resolve(target, 'site');
const html = readFileSync(resolve(out, 'sync/index.html'), 'utf8');
if (!html.includes('/widgets/_next/static/')) throw new Error('Build with NEXT_PUBLIC_BASE_PATH=/widgets first.');
const hashes = new Set();
for (const [, attrs, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
  if (src && !src.startsWith('/widgets/_next/static/')) throw new Error('Unexpected external script in the editor.');
  if (source) hashes.add(`'sha256-${createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('base64')}'`);
}
if (!hashes.size) throw new Error('Missing Next.js hydration scripts.');
const origin = '{$LUMA_PUBLIC_ORIGIN}';
const packs = JSON.parse(readFileSync(resolve('src/lib/luma-sync/public-packs.json'), 'utf8'));
const packSources = [packs.covers, packs.template, ...Object.values(packs.formatter)].join(' ');
const scoped = (...paths) => paths.map(path => `${origin}${path}`).join(' ');
const configuredAddonsEnabled = process.env.NEXT_PUBLIC_LUMA_CONFIGURED_ADDONS !== 'off';
const readerFile = 'sync-assets/configured-manifest-reader.html';
const readerPath = `/widgets/${readerFile}`;
let readerRoute = '';
if (configuredAddonsEnabled) {
  const script = readFileSync(resolve(out, readerFile), 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing configured add-on reader script.');
  const hash = createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  readerRoute = `
    @configuredManifestReader path /${readerFile}
    handle @configuredManifestReader {
        header {
            Content-Security-Policy "default-src 'none'; script-src 'sha256-${hash}'; connect-src https:; frame-ancestors ${origin}; sandbox allow-scripts; base-uri 'none'; form-action 'none'"
            Cache-Control "no-store"
            Referrer-Policy "no-referrer"
            X-Content-Type-Options "nosniff"
        }
        file_server
    }`;
}
const headers = [
  "default-src 'none'",
  `script-src ${scoped('/widgets/_next/static/')} 'wasm-unsafe-eval' ${[...hashes].join(' ')}`,
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "media-src https:", "font-src 'self'",
  `connect-src ${scoped('/v1/server', '/v1/passkeys/editor/', '/v1/snapshots', '/v2/snapshots/', '/v1/devices', '/v1/devices/', '/v1/editor/session', '/v1/editor/catalogs', '/v1/editor/catalog-preview', '/v1/connections/trakt/', '/v1/connections/simkl/', '/v1/connections/mdblist/', '/widgets/sync-assets/lzfse.wasm')} ${packSources}`,
  ...(configuredAddonsEnabled ? [`frame-src ${scoped(readerPath)}`] : []),
  "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'", "object-src 'none'", "worker-src 'none'",
].join('; ');
const files = ['sync/index.html', '_next/static', ...(configuredAddonsEnabled ? [readerFile] : []), 'sync-assets/lzfse.wasm', 'sync-assets/LZFSE-LICENSE.txt', 'sync-assets/favicon-white.svg',
  'luma-favicon.svg', 'luma-icon-16.png', 'luma-icon-32.png', 'branding/luma-icon.png'];
for (const file of files) if (!existsSync(resolve(out, file))) throw new Error(`Missing built asset ${file}.`);
rmSync(site, { recursive: true, force: true });
for (const file of files) cpSync(resolve(out, file), resolve(site, file), { recursive: true });
mkdirSync(target, { recursive: true });
writeFileSync(resolve(target, 'widgets.caddy'), `
@widgetLanding path / /index.html
header @widgetLanding Cache-Control "no-store"
redir @widgetLanding /widgets/sync/ 302
redir /widgets/sync /widgets/sync/ 308
handle_path /widgets/* {
    root * /etc/caddy/widget-editor/site${readerRoute}
    @widgetFile path /sync/ /_next/static/* /sync-assets/lzfse.wasm /sync-assets/LZFSE-LICENSE.txt /sync-assets/favicon-white.svg /luma-favicon.svg /luma-icon-16.png /luma-icon-32.png /branding/luma-icon.png
    handle @widgetFile {
        header {
            Content-Security-Policy "${headers}"
            Cache-Control "no-store"
            Referrer-Policy "no-referrer"
            X-Content-Type-Options "nosniff"
            X-Frame-Options "DENY"
            Cross-Origin-Opener-Policy "same-origin"
            Cross-Origin-Resource-Policy "same-origin"
            Permissions-Policy "camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)"
        }
        file_server
    }
    handle {
        respond 404
    }
}
`);
console.log(`Packaged ${target}`);
