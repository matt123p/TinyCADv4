import { isElectron } from './apiServer';

// The public library endpoints require an HTTP origin for browser CORS.
export async function fetchOnlineLibrary(url: string, options?: RequestInit): Promise<Response> {
  if (!isElectron) return fetch(url, options);
  const bridge = window.electronAPI?.onlineLibraryRequest;
  if (!bridge) throw new Error('Restart TinyCAD to enable online library access.');
  const target = new URL(url, 'https://www.tinycad.net');
  if (target.origin !== 'https://www.tinycad.net')
    throw new Error('Invalid online library URL.');
  const signal = options?.signal;
  signal?.throwIfAborted();
  let onAbort: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason || new DOMException('Stopped', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const reply = await Promise.race([
      bridge(target.pathname + target.search), aborted,
    ]);
    return new Response(reply.body, {
      status: reply.status, statusText: reply.statusText,
      headers: { 'Content-Type': reply.contentType },
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
