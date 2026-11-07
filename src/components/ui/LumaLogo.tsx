'use client';

import { useId } from 'react';
import LumaLogoImage from '@/../public/branding/luma-icon.png';

/** The original artwork, clipped to the mark so it works on any background. */
export function LumaLogo({ className }: { className?: string }) {
  const clipId = useId();
  return (
    <svg viewBox="270 185 770 830" className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <path d="M 295 321 C 295 254 345 204 410 204 C 430 204 448 209 467 220 L 977 524 C 1001 538 1015 565 1015 601 C 1015 638 1001 664 976 679 L 469 982 C 451 994 431 1000 410 1000 C 345 1000 295 951 295 886 Z" />
        </clipPath>
      </defs>
      <image width="1254" height="1254" href={LumaLogoImage.src} clipPath={`url(#${clipId})`} />
    </svg>
  );
}
