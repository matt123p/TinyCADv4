/** SDK types for plugin authors. The host passes this object to activate/mount. */
export type { PluginManifest, PluginCatalog, CatalogEntry, DataScope, Json, SurfaceContext } from './types';
import type { Json, DataScope, SurfaceContext } from './types';
export interface DocumentInfo { id: string; name: string; revision: number; dirty: boolean; kind: 'schematic' | 'library'; active: boolean; }
export interface ItemSnapshot { id: string; type: string; point?: [number, number]; point_b?: [number, number]; d_points?: [number, number][]; rotation?: number; name?: string; number?: string; text?: string; attributes?: Record<string, string>; definitionId?: string; definition?: unknown; }
export interface DocumentSnapshot { id: string; persistentId: string; name: string; revision: number; kind: string; activeSheetId?: string; sheets: { id: string; name: string; items: ItemSnapshot[] }[]; }
export interface DataTarget { documentId?: string; scope?: DataScope; targetId?: string; expectedRevision?: number; }
export interface ProviderSymbol {
  name: string; reference: string; uid?: string; description?: string;
  pins: { name: string; number: string; point: [number, number]; rotation?: number; length?: number; electricalType?: number }[];
  graphics?: { type: 'rectangle' | 'line'; a: [number, number]; b: [number, number] }[];
}
export type EditOperation =
  | { type: 'insertWire'; sheetId?: string; a: [number, number]; b: [number, number] }
  | { type: 'insertText'; sheetId?: string; point: [number, number]; text: string }
  | { type: 'insertSymbol'; sheetId?: string; point: [number, number]; definitionId?: string; symbol?: ProviderSymbol }
  | { type: 'move'; sheetId?: string; id: string; delta: [number, number] }
  | { type: 'delete'; sheetId?: string; id: string }
  | { type: 'setAttributes'; sheetId?: string; id: string; attributes: Record<string, string> }
  | { type: 'setPin'; sheetId?: string; id: string; name?: string; number?: string; electricalType?: number }
  | { type: 'setLibraryAttributes'; attributes: Record<string, string> }
  | ({ type: 'setExtensionData'; data: Json; schema: number } & DataTarget)
  | ({ type: 'deleteExtensionData' } & DataTarget);
export interface EditTransaction { documentId: string; expectedRevision: number; label?: string; operations: EditOperation[]; }
export interface EditResult { revision: number; created: string[]; }
export interface PluginAPI {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  commands: {
    registerHandler(id: string, handler: (args: any) => unknown | Promise<unknown>): () => void;
    execute(command: string, args?: Json): Promise<unknown>;
    listAvailable(): Promise<{ id: string; title: string; enabled: boolean }[]>;
  };
  documents: {
    list(): Promise<DocumentInfo[]>; getSnapshot(documentId?: string): Promise<DocumentSnapshot>;
    applyEdits(transaction: EditTransaction): Promise<EditResult>;
    create(name?: string): Promise<string>; open(): Promise<void>; activate(documentId: string): Promise<void>;
    save(documentId?: string): Promise<{ saved: boolean }>; close(documentId: string): Promise<boolean>;
    export(documentId?: string): Promise<{ name: string; xml: string }>;
  };
  editor: { getContext(): Promise<Record<string, string | boolean | number>>; getSelection(): Promise<ItemSnapshot[]>; select(ids: string[]): Promise<void>; reveal(id: string): Promise<void>; };
  symbols: { get(symbolId?: string): Promise<unknown>; applyEdits(transaction: EditTransaction): Promise<EditResult>; };
  extensionData: {
    get(target?: DataTarget): Promise<{ schema?: number; encoding?: string; data?: Json; revision: number }>;
    set(target: DataTarget, data: Json, schema?: number): Promise<EditResult>; delete(target?: DataTarget): Promise<EditResult>;
  };
  netlists: { generate(format?: 'connectivity' | 'spice', documentId?: string): Promise<{ revision: number; text?: string; nets?: unknown[] }>; };
  views: { open(viewType: string, documentId?: string): Promise<string>; close(viewId: string): Promise<void>; };
  settings: { get(): Promise<Record<string, Json>>; set(value: Record<string, Json>): Promise<void>; };
  resources: { read(path: string): Promise<Uint8Array>; };
  network: { request(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; ok: boolean; text: string }>; };
  libraries: {
    registerProvider(id: string, provider: { search(query: { query: string; limit: number }): Promise<{ id: string; name: string; description?: string }[]> | { id: string; name: string; description?: string }[]; resolve(symbol: { id: string }): Promise<ProviderSymbol> | ProviderSymbol }): () => void;
    placeSymbol(providerId: string, symbolId: string): Promise<EditResult>;
  };
  desktop: { getCapabilities(): Promise<{ nativeTools: boolean; tools: { id: string; name: string }[] }>; runTool(toolId: string, input: string): Promise<{ code: number; stdout: string; stderr: string }>; };
  ui: { notify(message: string): Promise<void>; confirm(message: string): Promise<boolean>; setDirty(dirty: boolean): Promise<void>; previewEdits(transaction: EditTransaction): Promise<({ accepted: true } & EditResult) | { accepted: false }>; };
  events: { on(event: string, callback: (data: any) => void): () => void; };
}
export interface PluginUIContext extends SurfaceContext { surface: string; locale: string; theme: { foreground: string; background: string; accent: string }; }
export type Activate = (api: PluginAPI) => void | Promise<void>;
export type Mount = (root: HTMLElement, api: PluginAPI, context: PluginUIContext) => void | Promise<void>;
