import { PluginPackage, SurfaceContext } from './types';
import { check, LIMITS } from './validation';

/** Serialized into an isolated frame/worker. This function must have no closure dependencies. */
function clientFactory() {
  let port: MessagePort; let next = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timer: any }>();
  const handlers = new Map<string, (params: any) => any>(); const listeners = new Map<string, Set<(value: any) => void>>();
  const request = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
    if (!port) { reject(new Error('Plugin API is not connected.')); return; }
    const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Plugin API request timed out.')); }, 60000);
    pending.set(id, { resolve, reject, timer }); port.postMessage({ type: 'request', id, method, params });
  });
  const on = (event: string, callback: (value: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback);
    return () => { listeners.get(event)?.delete(callback); };
  };
  const api = {
    request,
    commands: {
      registerHandler: (id: string, handler: (params: any) => any) => { handlers.set('command:' + id, handler); return () => handlers.delete('command:' + id); },
      execute: (command: string, args: any = {}) => request('commands.execute', { command, args }),
      listAvailable: () => request('commands.listAvailable'),
    },
    documents: {
      list: () => request('documents.list'), getSnapshot: (documentId?: string) => request('documents.getSnapshot', { documentId }),
      applyEdits: (transaction: any) => request('documents.applyEdits', transaction),
      create: (name?: string) => request('documents.create', { name }), open: () => request('documents.open'),
      activate: (documentId: string) => request('documents.activate', { documentId }),
      save: (documentId?: string) => request('documents.save', { documentId }), close: (documentId: string) => request('documents.close', { documentId }),
      export: (documentId?: string) => request('documents.export', { documentId }),
    },
    editor: { getContext: () => request('editor.getContext'), getSelection: () => request('editor.getSelection'), select: (ids: string[]) => request('editor.select', { ids }), reveal: (id: string) => request('editor.reveal', { id }) },
    symbols: { get: (symbolId?: string) => request('symbols.get', { symbolId }), applyEdits: (transaction: any) => request('symbols.applyEdits', transaction) },
    netlists: { generate: (format = 'connectivity', documentId?: string) => request('netlists.generate', { format, documentId }) },
    extensionData: {
      get: (target: any = {}) => request('extensionData.get', target),
      set: (target: any, data: any, schema = 1) => request('extensionData.set', { ...target, data, schema }),
      delete: (target: any = {}) => request('extensionData.delete', target),
    },
    views: { open: (viewType: string, documentId?: string) => request('views.open', { viewType, documentId }), close: (viewId: string) => request('views.close', { viewId }) },
    settings: { get: () => request('settings.get'), set: (value: any) => request('settings.set', { value }) },
    resources: { read: (path: string) => request('resources.read', { path }) },
    network: { request: (url: string, options: any = {}) => request('network.request', { url, ...options }) },
    libraries: {
      registerProvider: (id: string, provider: { search: (query: any) => any; resolve: (symbol: any) => any }) => {
        handlers.set('library:' + id + ':search', provider.search); handlers.set('library:' + id + ':resolve', provider.resolve);
        return () => { handlers.delete('library:' + id + ':search'); handlers.delete('library:' + id + ':resolve'); };
      },
      placeSymbol: (providerId: string, symbolId: string) => request('libraries.placeSymbol', { providerId, symbolId }),
    },
    desktop: { getCapabilities: () => request('desktop.getCapabilities'), runTool: (toolId: string, input: string) => request('desktop.runTool', { toolId, input }) },
    ui: { notify: (message: string) => request('ui.notify', { message }), confirm: (message: string) => request('ui.confirm', { message }), previewEdits: (transaction: any) => request('ui.previewEdits', transaction), setDirty: (dirty: boolean) => request('ui.setDirty', { dirty }) },
    events: { on },
    _connect: (connection: MessagePort) => {
      port = connection;
      port.onmessage = async ({ data }) => {
        if (data.type === 'result') {
          const waiter = pending.get(data.id); if (!waiter) return; clearTimeout(waiter.timer); pending.delete(data.id);
          if (data.error) { const error = new Error(data.error.message); Object.assign(error, { code: data.error.code }); waiter.reject(error); } else waiter.resolve(data.result);
        } else if (data.type === 'invoke') {
          try {
            const handler = handlers.get(data.method); if (!handler) throw new Error('Plugin handler is not registered: ' + data.method);
            const result = await handler(data.params); port.postMessage({ type: 'result', id: data.id, result });
          } catch (error) { port.postMessage({ type: 'result', id: data.id, error: { message: (error as Error).message } }); }
        } else if (data.type === 'event') {
          for (const callback of listeners.get(data.event) || []) { try { callback(data.payload); } catch (error) { console.error(error); } }
        }
      };
      port.start();
    },
  };
  return api;
}

function frameBootstrap() {
  let worker: Worker | undefined; let initialized = false;
  const dataURL = (source: string) => {
    const bytes = new TextEncoder().encode(source); let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return 'data:text/javascript;base64,' + btoa(binary);
  };
  window.addEventListener('message', async event => {
    if (initialized || event.source !== window.parent || !event.ports[0] || event.data?.type !== 'tinycad-init') return;
    initialized = true; const port = event.ports[0]; const { role, code, context, client, token } = event.data;
    const fail = (error: any) => port.postMessage({ type: 'failed', token, message: error?.message || String(error) });
    try {
      if (role === 'controller') {
        const body = `const dataURL = ${dataURL.toString()}; const tinycad = (${client})(); globalThis.tinycad = tinycad; self.onmessage = async event => { const port = event.ports[0]; tinycad._connect(port); try { const module = await import(dataURL(event.data.code)); const plugin = module.activate ? module : globalThis.tinycadPlugin; if (!plugin?.activate) throw new Error('Controller must export activate(api).'); await plugin.activate(tinycad); port.postMessage({type:'ready', token:${JSON.stringify(token)}}); } catch(error) { port.postMessage({type:'failed',token:${JSON.stringify(token)},message:error.message}); } };`;
        const url = dataURL(body);
        worker = new Worker(url, { type: 'module' }); worker.onerror = fail;
        const bridge = new MessageChannel();
        bridge.port1.onmessage = message => port.postMessage(message.data);
        port.onmessage = message => bridge.port1.postMessage(message.data);
        bridge.port1.start(); port.start();
        worker.postMessage({ code }, [bridge.port2]);
      } else {
        // Factory source is host-provided static code; plugin bytes are loaded as a module, never eval'd.
        const factoryUrl = dataURL(`export default ${client}`);
        const makeClient = (await import(/* @parcel-ignore */ factoryUrl)).default; URL.revokeObjectURL(factoryUrl);
        const api = makeClient(); api._connect(port); (globalThis as any).tinycad = api;
        const moduleUrl = dataURL(code);
        const module = await import(/* @parcel-ignore */ moduleUrl); URL.revokeObjectURL(moduleUrl);
        const plugin = module.mount ? module : (globalThis as any).tinycadPluginUI;
        if (!plugin?.mount) throw new Error('UI must export mount(root, api, context).');
        await plugin.mount(document.getElementById('root'), api, context);
        port.postMessage({ type: 'ready', token });
      }
    } catch (error) { fail(error); }
  });
}

export class PluginConnection {
  readonly frame: HTMLIFrameElement;
  private port?: MessagePort;
  private disposed = false;
  private requests = 0;
  private activeRequests = 0;
  private activationTimer?: ReturnType<typeof setTimeout>;
  private rejectActivation?: (error: Error) => void;
  private requestWindow = Date.now();
  private windowRequests = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<void>;
  constructor(pkg: PluginPackage, role: 'controller' | 'ui', context: SurfaceContext & { surface?: string; locale?: string; theme?: any },
    invoke: (method: string, params: any) => Promise<any>, container: HTMLElement, private onFailure: (message: string) => void) {
    const token = crypto.randomUUID(); const nonce = crypto.randomUUID();
    const frame = document.createElement('iframe'); this.frame = frame;
    frame.name = 'tinycad-plugin-' + token;
    frame.title = role === 'ui' ? pkg.manifest.name : `${pkg.manifest.name} controller`;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.referrerPolicy = 'no-referrer'; frame.className = 'plugin-frame';
    if (role === 'controller') frame.hidden = true;
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' data: blob: 'wasm-unsafe-eval'; worker-src data: blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body,#root{height:100%;margin:0}body{font:13px system-ui;color:#242424;background:#fff}button,input,select,textarea{font:inherit}button{cursor:pointer}#root{box-sizing:border-box;padding:12px;overflow:auto}</style></head><body><div id="root"></div><script nonce="${nonce}">(${frameBootstrap.toString()})();</script></body></html>`;
    this.ready = new Promise<void>((resolve, reject) => {
      this.rejectActivation = reject;
      const timeout = setTimeout(() => { reject(new Error('Plugin activation timed out.')); this.fail('Plugin activation timed out.'); }, 15000);
      this.activationTimer = timeout;
      frame.onload = () => {
        if (this.disposed || this.port) return;
        const channel = new MessageChannel(); this.port = channel.port1;
        channel.port1.onmessage = async ({ data }) => {
          if (!data || typeof data !== 'object' || this.disposed) return;
          if (data.type === 'ready' && data.token === token) { clearTimeout(timeout); resolve(); return; }
          if (data.type === 'failed' && data.token === token) { clearTimeout(timeout); reject(new Error(String(data.message))); this.fail(String(data.message)); return; }
          if (data.type === 'result') {
            const waiting = this.pending.get(data.id); if (!waiting) return;
            clearTimeout(waiting.timer); this.pending.delete(data.id);
            data.error ? waiting.reject(new Error(data.error.message)) : waiting.resolve(data.result); return;
          }
          if (data.type !== 'request' || !Number.isSafeInteger(data.id) || typeof data.method !== 'string') return;
          if (Date.now() - this.requestWindow > 10000) { this.requestWindow = Date.now(); this.windowRequests = 0; }
          if (++this.windowRequests > 500) { this.fail('Plugin exceeded its request rate limit.'); return; }
          try {
            check(this.activeRequests < 32, 'Too many simultaneous plugin requests.');
            check(JSON.stringify(data.params || {}).length <= LIMITS.rpc, 'Plugin request exceeds message limit.');
            this.activeRequests++;
            try { const result = await invoke(data.method, data.params || {}); this.port?.postMessage({ type: 'result', id: data.id, result }); }
            finally { this.activeRequests--; }
          } catch (error) { this.port?.postMessage({ type: 'result', id: data.id, error: { code: (error as any).code || 'InvalidRequest', message: (error as Error).message } }); }
        };
        channel.port1.start();
        frame.contentWindow!.postMessage({ type: 'tinycad-init', token, role, context, client: clientFactory.toString(), code: new TextDecoder().decode(pkg.files[role === 'controller' ? pkg.manifest.controller : pkg.manifest.ui!]) }, '*', [channel.port2]);
      };
      container.appendChild(frame);
    });
  }
  private fail(message: string) { this.onFailure(message); this.dispose(); }
  async call(method: string, params: any, timeout = 60000): Promise<any> {
    await this.ready; check(!this.disposed, 'Plugin runtime is stopped.');
    check(this.pending.size < 32, 'Too many pending plugin commands.');
    const id = ++this.requests;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Plugin command timed out.')); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.port!.postMessage({ type: 'invoke', id, method, params });
    });
  }
  event(event: string, payload: any) { this.port?.postMessage({ type: 'event', event, payload }); }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.port?.close(); this.frame.remove();
    clearTimeout(this.activationTimer); this.rejectActivation?.(new Error('Plugin stopped.'));
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Plugin stopped.')); } this.pending.clear();
  }
}
