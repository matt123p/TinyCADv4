// A fresh worker and module instance for each run isolate ngspice global state.
import { EngineEvent, EngineRequest } from './contracts';
declare const self: {
  onmessage: (
    event: MessageEvent<EngineRequest & { moduleUrl: string }>,
  ) => void;
  postMessage(event: EngineEvent): void;
};

self.onmessage = async (
  event: MessageEvent<EngineRequest & { moduleUrl: string }>,
) => {
  try {
    const request = event.data;
    (
      globalThis as unknown as { ngspiceEmit: (json: string) => void }
    ).ngspiceEmit = (json) => self.postMessage(JSON.parse(json) as EngineEvent);
    const moduleUrl = request.moduleUrl;
    const response = await fetch(new URL('manifest.json', moduleUrl));
    if (!response.ok)
      throw new Error(
        'The bundled WASM engine is missing. Build the engine assets first.',
      );
    const manifest = await response.json();
    if (manifest.protocol !== 1 || manifest.platform !== 'wasm')
      throw new Error('Incompatible bundled WASM engine.');
    let wasmBinary: ArrayBuffer;
    for (const name of ['ngspice.js', 'ngspice.wasm']) {
      const file = manifest.files.find(
        (entry: { path: string }) => entry.path === name,
      );
      if (!file) throw new Error(`Missing engine inventory entry: ${name}`);
      const loaded = await fetch(new URL(name, moduleUrl));
      if (!loaded.ok) throw new Error(`Missing engine asset: ${name}`);
      const bytes = await loaded.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (n) => n.toString(16).padStart(2, '0'),
      ).join('');
      if (digest !== file.sha256)
        throw new Error(`Bundled engine integrity check failed: ${name}`);
      if (name === 'ngspice.wasm') wasmBinary = bytes;
    }
    const create = (await import(moduleUrl)).default;
    const engine = await create({ wasmBinary });
    self.postMessage({
      type: 'ready',
      info: {
        backend: 'wasm',
        buildId: manifest.buildId,
        version: manifest.version,
        protocol: 1,
        capabilities: manifest.capabilities,
      },
    });
    for (const [name, text] of Object.entries(request.files))
      engine.FS.writeFile(name, text);
    engine.ccall('tc_run', 'number', ['string'], [request.deck]);
  } catch (error) {
    self.postMessage({
      type: 'finished',
      state: 'failed',
      error: String(error),
    });
  }
};
