// Each operation owns its worker: Stop can terminate CPU-bound layout immediately.
export function nativeCall(
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Stopped', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./native-worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (error?: Error, data?: unknown) => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(data);
    };
    const abort = () => finish(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'Native tool exceeded 60 seconds. Reduce the drawing or layout budget.',
          ),
        ),
      60000,
    );
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) =>
      event.data.error
        ? finish(new Error(event.data.error))
        : finish(undefined, event.data.data);
    worker.onerror = () =>
      finish(new Error('Could not run the TinyCAD native tool worker.'));
    worker.postMessage({ id: 1, name, args });
  });
}
