/** Public, serializable plugin contracts. Do not expose Redux or model classes here. */
export const PLUGIN_API_VERSION = '1.0.0';
export type Platform = 'browser' | 'electron';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DataScope = 'document' | 'sheet' | 'symbolDefinition' | 'symbolInstance' | 'library' | 'libraryName';
export interface ExtensionEnvelope { schema: number; encoding: string; payload: string; rawXml?: string; }
export interface ExtensionOwner {
  persistentId?: string;
  pluginData?: Record<string, ExtensionEnvelope>;
  /** Unknown/newer XML is preserved without needing its plugin. */
  pluginDataXml?: string[];
}
export interface PluginMetadata {
  id: string; name: string; description: string; version: string; apiVersion: string;
  platforms: Platform[]; readme: string; changelog: string; documentation: string;
}
export interface Condition { when?: string; enablement?: string; platforms?: Platform[]; }
export interface CommandContribution extends Condition { id: string; title: string; exported?: boolean; }
export interface SurfaceContribution extends Condition { id: string; title: string; surface: string; order?: number; }
export interface PanelContribution extends SurfaceContribution { location: 'left' | 'bottom'; }
export interface MainViewContribution extends SurfaceContribution { scope: 'application' | 'document'; multiple?: boolean; }
export interface MenuContribution extends Condition { location: string; command: string; group?: string; order?: number; }
export interface ToolbarContribution extends Condition { id: string; title: string; }
export interface ToolbarItemContribution extends Condition {
  toolbar: string; command: string; icon?: string; order?: number;
}
export interface PluginManifest extends PluginMetadata {
  manifestVersion: 1; controller: string; ui?: string; files: string[];
  permissions: string[]; activationEvents?: string[];
  contributes?: {
    commands?: CommandContribution[]; panels?: PanelContribution[];
    symbolEditorTabs?: SurfaceContribution[]; mainViews?: MainViewContribution[];
    menus?: MenuContribution[]; toolbars?: ToolbarContribution[]; toolbarItems?: ToolbarItemContribution[];
    libraryProviders?: { id: string; title: string }[];
    dataSchemas?: { scope: DataScope; version: number }[];
  };
}
export interface CatalogEntry extends PluginMetadata {
  package: { type: 'releaseAsset'; asset: string; sha256?: string } | { type: 'source'; manifest: string };
}
export interface PluginCatalog { catalogVersion: 1; plugins: CatalogEntry[]; }
export interface Repository { id: number; url: string; slug: string; defaultBranch: string; }
export interface ReleaseAsset { id: number; name: string; size: number; digest?: string; browser_download_url: string; }
export interface Release {
  id: number; name: string; tag_name: string; published_at: string; prerelease: boolean;
  draft: boolean; assets: ReleaseAsset[]; html_url: string;
}
export interface PluginVersion {
  repository?: Repository; entry: CatalogEntry; commit: string; release?: Release;
  catalogDigest: string; ref?: string;
  development?: DevelopmentSource;
}
/** Host-selected development roots. Directory paths stay in the Electron main process. */
export type DevelopmentSource =
  | { kind: 'server'; url: string; manifest: string }
  | { kind: 'directory'; id: string; name: string; manifest: string };
export function sourceIdentity(source: PluginVersion): string {
  const dev = source.development;
  return dev ? JSON.stringify(dev.kind === 'server' ? ['server', dev.url] : ['directory', dev.id])
    : JSON.stringify(['github', source.repository?.id, source.repository?.url]);
}
export interface PluginPackage {
  manifest: PluginManifest; files: Record<string, Uint8Array>; digest: string;
  fileHashes: Record<string, string>; source: PluginVersion;
}
export interface VersionLock {
  digest: string; manifest: PluginManifest; source: PluginVersion;
  fileHashes: Record<string, string>; installedAt: string;
}
export interface InstalledPlugin {
  id: string; current: VersionLock; history: VersionLock[]; enabled: boolean;
  grants: string[]; policy: 'automatic' | 'manual' | 'pinned'; channel: 'stable' | 'prerelease';
  rejected: string[]; revision: number; error?: string; pending?: VersionLock;
  settingsSnapshots?: Record<string, Record<string, Json>>;
}
export interface StarterRepository { name: string; url: string; description: string; reviewedVersions: string[]; }
export interface PluginView {
  id: string; pluginId: string; viewType: string; title: string; surface: string; documentId?: string;
}
export type PluginContext = Record<string, string | boolean | number>;
export interface SurfaceContext { documentId?: string; symbolId?: string; viewId?: string; surfaceInstanceId?: string; }
export interface NativePluginMenu { label: string; command: string; enabled: boolean; location: string; }
export interface HostAdapter {
  context(): PluginContext;
  invoke(plugin: InstalledPlugin, method: string, params: any, context: SurfaceContext): Promise<any>;
  safeToUpdate(): boolean;
  subscribe(listener: (event: string, payload: any) => void): () => void;
}
export class PluginError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'PluginError'; }
}
