import type { Metadata } from 'next';
import { SyncEditor } from '@/components/sync/SyncEditor';
import './sync.css';

export const metadata: Metadata = { title: 'Luma · Your setup', robots: { index: false, follow: false }, referrer: 'no-referrer', icons: { icon: { url: (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/sync-assets/favicon-white.svg', type: 'image/svg+xml' } } };
export default function SyncPage() {
  return <>
    {/* The stylesheet belongs to the Sync server at the origin root, outside Next's base path. */}
    {/* eslint-disable-next-line @next/next/no-css-tags */}
    <link rel="stylesheet" href="/assets/theme.css" precedence="luma-sync" />
    <SyncEditor />
  </>;
}
