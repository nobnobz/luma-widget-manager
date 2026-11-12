import { publicPacks, readPublicPack } from './public-pack';
import { previewArtworkURL } from '../preview-artwork';
import type { Folder, Hub } from '../luma-document';

const MAX_PACK = 256 * 1024;
type Cover = { title: string; videoURL: string; backgroundURL: string | null };
const titleKey = (title: string) => title.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export async function loadCoverPack(signal: AbortSignal): Promise<Cover[]> {
  const raw: unknown = JSON.parse(await readPublicPack(publicPacks.covers, MAX_PACK, signal));
  if (!Array.isArray(raw)) throw new Error('Invalid UME cover pack.');
  const covers = raw.flatMap((row: unknown): Cover[] => {
    if (typeof row !== 'object' || !row) return [];
    const { title, videoURL, backgroundURL } = row as Record<string, unknown>;
    const video = previewArtworkURL(videoURL, true);
    return typeof title === 'string' && title.length <= 128 && titleKey(title) && video
      ? [{ title, videoURL: video, backgroundURL: previewArtworkURL(backgroundURL, true) }] : [];
  });
  if (!covers.length) throw new Error('The UME cover pack contains no supported covers.');
  return covers;
}

/** Keep custom art, disabled motion choices, and all provider fields intact. */
export function applyCoverPack(collections: Hub[], covers: Cover[]) {
  const byTitle = new Map<string, Cover>();
  const ambiguous = new Set<string>();
  for (const cover of covers) {
    const key = titleKey(cover.title), existing = byTitle.get(key);
    if (existing && existing.videoURL !== cover.videoURL) ambiguous.add(key);
    else if (!existing) byTitle.set(key, cover);
  }
  const changed: string[] = [];
  function visit(folder: Folder): Folder {
    const key = titleKey(folder.title), cover = !ambiguous.has(key) && byTitle.get(key);
    const next = { ...folder };
    if (cover && !folder.focusVideoUrl && !folder.focusGifUrl && folder.focusGifEnabled !== false) {
      next.focusVideoUrl = cover.videoURL; next.focusGifEnabled = true;
      if (cover.backgroundURL) {
        if (!folder.coverImageUrl) next.coverImageUrl = cover.backgroundURL;
        if (!folder.heroBackdropUrl) next.heroBackdropUrl = cover.backgroundURL;
      }
      changed.push(folder.title);
    }
    if (next.sections) next.sections = next.sections.map(section => ({ ...section, folders: section.folders.map(visit) }));
    if (next.subfolders) next.subfolders = next.subfolders.map(visit);
    return next;
  }
  return { collections: collections.map(hub => ({ ...hub, folders: hub.folders.map(visit) })), changed };
}
