import type { Metadata } from 'next';
import Link from 'next/link';
import { MainEditor } from '@/components/editor/MainEditor';
import { withBasePath } from '@/lib/base-path';

export const metadata: Metadata = {
  title: 'Fusion Widget Manager',
  description: 'Create and organize your Fusion widgets.',
  icons: {
    icon: [{ url: withBasePath('/branding/fusion-favicon.png'), type: 'image/png', sizes: '32x32' }],
    apple: withBasePath('/apple-touch-icon.png?v=2'),
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Fusion Widget Manager' },
};

export default function FusionTools() {
  return <>
    <nav className="relative z-20 mx-auto flex w-full max-w-[1400px] px-4 pt-3 sm:px-6">
      <Link href="/" className="rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">← Luma Widget Manager</Link>
    </nav>
    <MainEditor />
  </>;
}
