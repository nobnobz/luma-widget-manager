'use client';

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { previewArtworkURL } from '@/lib/preview-artwork';
import { cn } from '@/lib/utils';

interface PreviewProps {
  src: unknown;
  alt?: string;
  onDemand?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  onRatio?: (ratio: number) => void;
}
function ImagePreview({ url, supplied, alt = '', onDemand, fit, className, onRatio }: Omit<PreviewProps, 'src'> & { url: string | null; supplied: boolean }) {
  const [requested, setRequested] = useState(!onDemand);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const showImage = !!url && requested && state !== 'failed';
  return <div className={cn('relative grid min-h-0 min-w-0 place-items-center overflow-hidden bg-muted text-muted-foreground', className)}>
    {showImage && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={cn('absolute inset-0 size-full', fit === 'contain' ? 'object-contain' : 'object-cover', state === 'loading' && 'opacity-0')}
        onLoad={e => { const { naturalWidth, naturalHeight } = e.currentTarget; if (naturalHeight) onRatio?.(naturalWidth / naturalHeight); setState('ready'); }}
        onError={() => setState('failed')} />
    )}
    {url && !requested ? <Button type="button" size="sm" variant="outline" onClick={() => setRequested(true)}>Load image</Button>
      : (!showImage || state === 'loading') && <div className="grid justify-items-center gap-1 px-2 text-center text-xs" role="status">
        <ImageIcon aria-hidden className="size-4" />
        <span>{!supplied ? 'No image' : showImage ? 'Loading image…' : 'Image unavailable'}</span>
      </div>}
  </div>;
}
export function ArtworkPreview({ src, ...props }: PreviewProps) {
  const url = previewArtworkURL(src, !!props.onDemand);
  return <ImagePreview key={url ?? 'unavailable'} {...props} url={url} supplied={typeof src === 'string' && !!src.trim()} />;
}

function Playback({ url }: { url: string }) {
  const [requested, setRequested] = useState(false), [failed, setFailed] = useState(false);
  if (failed) return <p className="text-xs text-muted-foreground" role="status">Video unavailable in this browser.</p>;
  if (!requested) return <Button type="button" size="sm" variant="outline" onClick={() => setRequested(true)}>Load video</Button>;
  return <video controls playsInline preload="metadata" aria-label="Animation preview" className="aspect-video w-full rounded-md bg-black" src={url} onError={() => setFailed(true)} />;
}
export function AnimationPreview({ src }: { src: unknown }) {
  const url = previewArtworkURL(src, true);
  return url ? <Playback key={url} url={url} /> : <p className="text-xs text-muted-foreground">Video unavailable in the browser.</p>;
}
