import './native.bundle.js';
self.onmessage = (event: MessageEvent) => {
  const { id, name, args } = event.data;
  try {
    self.postMessage({
      id,
      data: (globalThis as any).TinyCADChatNative.nativeTool(name, args),
    });
  } catch (e) {
    self.postMessage({
      id,
      error: e instanceof Error ? e.message : 'Native operation failed.',
    });
  }
};
