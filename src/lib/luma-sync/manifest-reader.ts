export type ManifestProjection = { id: string; name: string; catalogs: { id: string; type: string; name: string }[] };

export function readConfiguredManifest(reader: Window, url: string, signal: AbortSignal): Promise<ManifestProjection | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return; }
    const { port1, port2 } = new MessageChannel();
    function finish(value: ManifestProjection | null) {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      port1.close();
      resolve(value);
    }
    function abort() { port1.postMessage(null); finish(null); }
    const timeout = setTimeout(abort, 7500);
    signal.addEventListener('abort', abort, { once: true });
    port1.onmessage = ({ data }) => {
      const valid = data && typeof data.id === 'string' && typeof data.name === 'string' && Array.isArray(data.catalogs);
      finish(valid ? data : null);
    };
    try {
      // The sandbox has an opaque origin. Transfer a dedicated reply port to
      // this frame's WindowProxy; never accept global replies containing data.
      reader.postMessage({ url }, '*', [port2]);
    } catch { port2.close(); finish(null); }
  });
}
