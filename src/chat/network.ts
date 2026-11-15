import { isElectron } from '../io/apiServer';
import { ProviderSettings } from './types';

// Z.AI does not allow browser CORS. Only this fixed provider is relayed;
// arbitrary URLs and provider keys are never accepted as relay destinations.
export async function providerFetch(
  settings: ProviderSettings,
  url: string,
  init: RequestInit,
  send: typeof fetch = fetch,
): Promise<Response> {
  if (settings.provider !== 'glm') return send(url, init);
  const target = new URL(url);
  if (
    target.origin !== 'https://api.z.ai' ||
    !['/api/paas/v4/models', '/api/paas/v4/chat/completions'].includes(
      target.pathname,
    ) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error(
      'Z.AI uses its standard API endpoint. Use a compatible provider for custom endpoints.',
    );
  const operation = target.pathname.endsWith('/models')
    ? 'models'
    : 'chat/completions';
  if (isElectron) {
    if (typeof window === 'undefined' || !window.electronAPI?.chatRequest)
      throw new Error(
        'The Electron chat bridge is unavailable. Restart TinyCAD.',
      );
    const bridge = window.electronAPI;
    const id = crypto.randomUUID();
    const headers = new Headers(init.headers);
    if (init.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    return new Promise<Response>((resolve, reject) => {
      let stream: ReadableStreamDefaultController<Uint8Array>;
      let started = false,
        ended = false;
      const encoder = new TextEncoder();
      let unsubscribe = () => {};
      const cleanup = () => {
        unsubscribe();
        init.signal?.removeEventListener('abort', abort);
      };
      const fail = (error: Error) => {
        if (ended) return;
        ended = true;
        if (started) stream.error(error);
        else reject(error);
        cleanup();
      };
      const abort = () => {
        bridge.cancelChatRequest(id);
        fail(new DOMException('Stopped', 'AbortError'));
      };
      if (bridge.onChatStream)
        unsubscribe = bridge.onChatStream((event) => {
          if (event.id !== id || ended) return;
          if (event.type === 'start') {
            started = true;
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
              cancel() {
                bridge.cancelChatRequest(id);
                ended = true;
                cleanup();
              },
            });
            resolve(
              new Response(body, {
                status: event.status,
                headers: { 'Content-Type': 'text/event-stream' },
              }),
            );
          } else if (event.type === 'chunk' && started)
            stream.enqueue(encoder.encode(event.text || ''));
          else if (event.type === 'end' && started) {
            ended = true;
            stream.close();
            cleanup();
          }
        });
      init.signal?.addEventListener('abort', abort, { once: true });
      bridge
        .chatRequest({
          id,
          operation,
          authorization: headers.get('Authorization') || '',
          body: typeof init.body === 'string' ? init.body : undefined,
        })
        .then((result) => {
          if (ended) return;
          if (init.signal?.aborted) {
            abort();
            return;
          }
          if (!started) {
            ended = true;
            resolve(
              new Response(result.body, {
                status: result.status,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
            cleanup();
          } else fail(new Error('The provider stream ended unexpectedly.'));
        })
        .catch((error) => fail(error));
    });
  }
  return send(`/api/chat/glm/${operation}`, {
    ...init,
    credentials: 'omit',
  });
}
