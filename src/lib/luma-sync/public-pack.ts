import packs from './public-packs.json' with { type: 'json' };

export const publicPacks = packs;
export async function readPublicPack(url: string, limit: number, signal: AbortSignal): Promise<string> {
  if (url !== packs.covers && url !== packs.template && !Object.values(packs.formatter).includes(url)) throw new Error('Unknown public pack.');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
  const reader = response.body?.getReader();
  if (!response.ok || !reader) { await reader?.cancel(); throw new Error('Could not load pack.'); }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Pack is too large.');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}
