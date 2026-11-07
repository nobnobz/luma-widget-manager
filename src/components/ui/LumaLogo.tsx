'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import LumaLogoImage from '@/../public/branding/luma-logo-transparent.png';

export function LumaLogo({ className }: { className?: string }) {
  return <Image src={LumaLogoImage} alt="" aria-hidden="true" priority className={cn('object-contain scale-[1.4] drop-shadow-[0_2px_3px_rgba(0,34,90,0.24)] dark:drop-shadow-[0_2px_5px_rgba(65,140,255,0.3)]', className)} />;
}
