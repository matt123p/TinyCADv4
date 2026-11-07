import { compare, gt } from 'semver';
import { githubPlugins } from './github';
import { pluginStorage } from './storage';
import { PluginConnection } from './runtime';
import {
  HostAdapter, InstalledPlugin, Json, PluginContext, PluginManifest, PluginPackage,
  PluginVersion, PluginView, SurfaceContext, VersionLock, Condition,
} from './types';
import { check, compatible, evaluate, LIMITS, parseManifest, sha256 } from './validation';
import starters from './repositories.json';
import { prompts } from './prompts';

const RECORD_KEY = 'tinycad.plugins.v1';
export const platform = process.env.TARGET_SYSTEM === 'electron' ? 'electron' : 'browser';
export const starterRepositories = starters;
type ContributionKey = keyof NonNullable<PluginManifest['contributes']>;
export class PluginManager {
  installed: InstalledPlugin[] = [];
  available: PluginVersion[] = [];
  views: PluginView[] = [];
  activeView?: string;
  managerOpen = false;
  notifications: string[] = [];
  readonly safeMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('plugins') === 'safe';
  private listeners = new Set<() => void>();
  private revision = 0;
  private controllers = new Map<string, PluginConnection>();
  private surfaces = new Map<string, Set<PluginConnection>>();
  private packages = new Map<string, PluginPackage>();
  private adapter?: HostAdapter;
  private initialized?: Promise<void>;
  private checking?: Promise<void>;
  private commandStack: string[] = [];
  private queue: Promise<any> = Promise.resolve();
  private storeRevision = 0;
  private drafts = new Map<string, string>();
  hasDrafts(id?: string) { return [...this.drafts.values()].some(owner => !id || owner === id); }
  async confirmDiscardDrafts(id?: string) {
    return !this.hasDrafts(id) || await prompts.ask('Unsaved plugin form', 'Discard unsaved changes in the plugin form? Changes already accepted into the document will be preserved.') === 'accept';
  }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.revision;
  changed = () => { this.revision++; for (const callback of this.listeners) callback(); this.syncNativeMenus(); };
  notify(message: string) { this.notifications = [...this.notifications.slice(-9), message]; this.changed(); }
  showManager() { this.managerOpen = true; this.changed(); }
  hideManager() { this.managerOpen = false; this.changed(); }
  attach(adapter: HostAdapter) {
    this.adapter = adapter;
    adapter.subscribe((event, payload) => {
      this.event(event, payload); this.changed();
      if (event === 'documentOpened') {
        for (const plugin of this.installed.filter(p => p.enabled)) {
          if (plugin.current.manifest.activationEvents?.includes('onDocumentData:' + plugin.id) && payload?.pluginIds?.includes(plugin.id)) void this.controller(plugin.id).catch(error => this.runtimeError(plugin.id, error.message));
        }
      }
    });
  }
  context(): PluginContext { return { platform, ...(this.adapter?.context() || {}), activeViewType: this.views.find(v => v.id === this.activeView)?.viewType || 'schematic' }; }
  visible(condition: Condition) {
    return (!condition.platforms || condition.platforms.includes(platform)) && evaluate(condition.when, this.context());
  }
  enabled(condition: Condition) { return this.visible(condition) && evaluate(condition.enablement, this.context()); }
  contributions<K extends ContributionKey>(key: K): { plugin: InstalledPlugin; item: any }[] {
    if (this.safeMode) return [];
    return this.installed.filter(p => p.enabled && !p.error && compatible(p.current.manifest, platform)).flatMap(plugin =>
      ((plugin.current.manifest.contributes?.[key] || []) as any[]).filter(item => this.visible(item)).map(item => ({ plugin, item })),
    ).sort((a, b) => (a.item.order || 0) - (b.item.order || 0) || String(a.item.id || a.item.command).localeCompare(String(b.item.id || b.item.command)));
  }
  async init() {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const raw = window.electronAPI?.pluginStorage ? await pluginStorage.get<any>('records') : JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
      if (raw) {
        this.storeRevision = raw.revision || 0;
        check(raw.version === 1 && Array.isArray(raw.plugins), 'Unsupported saved plugin records.');
        this.installed = raw.plugins.map((record: InstalledPlugin) => {
          parseManifest(record.current.manifest); check(record.id === record.current.manifest.id && /^[a-f0-9]{64}$/.test(record.current.digest), 'Invalid installed plugin record.');
          check(Array.isArray(record.history) && Array.isArray(record.grants), 'Invalid plugin version history.');
          if (record.pending) { record.rejected = [...(record.rejected || []), record.pending.digest]; delete record.pending; }
          return { ...record, error: undefined as string | undefined };
        });
      }
      this.changed();
      if (!this.safeMode) {
        for (const plugin of this.installed.filter(p => p.enabled && p.current.manifest.activationEvents?.includes('onStartup'))) {
          void this.controller(plugin.id).catch(error => this.runtimeError(plugin.id, error.message));
        }
        const startupView = localStorage.getItem('tinycad.plugins.startupView');
        if (startupView) { try { this.openView(startupView); } catch { /* Missing plugin: use schematic. */ } }
        void this.checkUpdates().catch(error => this.notify(error.message));
        window.setInterval(() => { if (!document.hidden) void this.checkUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000 + Math.random() * 60000);
      }
      window.addEventListener('storage', event => { if (event.key === RECORD_KEY) this.notify('Plugin settings changed in another window. Reload when current work is saved.'); });
    })().catch(error => { this.notify('Plugin startup: ' + error.message); });
    return this.initialized;
  }
  private async persist() {
    const data = { version: 1, revision: this.storeRevision + 1, plugins: this.installed };
    if (window.electronAPI?.pluginStorage) await pluginStorage.set('records', data);
    else {
      const stored = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
      check((stored?.revision || 0) === this.storeRevision, 'Plugin installations changed in another window. Reload before making further changes.');
      localStorage.setItem(RECORD_KEY, JSON.stringify(data));
    }
    this.storeRevision = data.revision;
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (navigator.locks) return navigator.locks.request('tinycad-plugin-install', fn);
      return fn();
    };
    const result = this.queue.then(run, run); this.queue = result.catch(() => {}); return result;
  }
  async discover(url: string, options: { ref?: string; prerelease?: boolean; refresh?: boolean } = {}) {
    const versions = await githubPlugins.versions(url, options); this.available = versions; this.changed(); return versions;
  }
  async preview(version: PluginVersion) {
    const record = this.installed.find(p => p.id === version.entry.id);
    const cached = record && [record.current, ...record.history].find(lock => lock.source.repository.id === version.repository.id && lock.source.commit === version.commit && lock.source.release?.id === version.release?.id && lock.manifest.version === version.entry.version);
    return cached ? this.loadLock(cached) : githubPlugins.load(version);
  }
  async install(pkg: PluginPackage, grants: string[], automatic = true) {
    check(compatible(pkg.manifest, platform), 'Plugin is incompatible with this platform/API.');
    check(pkg.manifest.permissions.every(p => grants.includes(p)), 'All requested permissions must be explicitly granted.');
    return this.exclusive(async () => {
      const existing = this.installed.find(p => p.id === pkg.manifest.id);
      check(!existing || existing.current.source.repository.id === pkg.source.repository.id, 'Another repository already owns that plugin ID.');
      check(!existing || existing.current.source.repository.url === pkg.source.repository.url, 'Plugin source change requires a reinstall.');
      check(!existing || existing.current.manifest.version !== pkg.manifest.version || existing.current.digest === pkg.digest, 'Publisher changed content without changing the plugin version.');
      check(!existing || (this.adapter?.safeToUpdate() && !this.hasDrafts(existing.id) && !this.commandStack.length), 'Finish the current edit, plugin form, command, or save before changing plugins.');
      await pluginStorage.setPackage(pkg);
      const lock: VersionLock = { digest: pkg.digest, manifest: pkg.manifest, source: pkg.source, fileHashes: pkg.fileHashes, installedAt: new Date().toISOString() };
      const settings = await pluginStorage.getSettings(pkg.manifest.id);
      const next: InstalledPlugin = {
        id: pkg.manifest.id, current: lock,
        history: existing ? [existing.current, ...existing.history].filter((v, i, all) => v.digest !== lock.digest && all.findIndex(x => x.digest === v.digest) === i).slice(0, 5) : [],
        grants: [...new Set(grants.filter(p => pkg.manifest.permissions.includes(p)))],
        enabled: !this.safeMode, policy: automatic && !!pkg.source.release ? 'automatic' : 'manual', channel: existing?.channel || (pkg.source.release?.prerelease ? 'prerelease' : 'stable'),
        rejected: existing?.rejected || [], revision: (existing?.revision || 0) + 1,
        settingsSnapshots: { ...existing?.settingsSnapshots, ...(existing ? { [existing.current.digest]: settings } : {}) },
      };
      const previousList = this.installed;
      if (existing) {
        existing.pending = lock; await this.persist(); this.stop(existing.id);
      }
      this.packages.set(pkg.digest, pkg); this.installed = [...this.installed.filter(p => p.id !== next.id), next];
      try {
        if (!this.safeMode) await this.controller(next.id); await this.persist();
      } catch (error) {
        this.stop(next.id); this.installed = previousList;
        if (existing) { delete existing.pending; existing.rejected = [...existing.rejected, pkg.digest]; existing.error = undefined; }
        await pluginStorage.setSettings(next.id, settings); await this.persist(); this.changed(); throw error;
      }
      this.notify(`${next.current.manifest.name} ${next.current.manifest.version} ${existing ? 'updated' : 'installed'}.`);
    });
  }
  async policy(id: string, policy: InstalledPlugin['policy'], channel?: InstalledPlugin['channel']) {
    return this.exclusive(async () => {
      const record = this.record(id); record.policy = policy; if (channel) record.channel = channel;
      record.revision++; await this.persist(); this.changed();
    });
  }
  async setEnabled(id: string, enabled: boolean) {
    return this.exclusive(async () => {
    if (!enabled && !await this.confirmDiscardDrafts(id)) return;
    check(this.adapter?.safeToUpdate(), 'Finish the current edit or save first.');
    const record = this.record(id); record.enabled = enabled; record.error = undefined; this.stop(id);
    record.revision++; await this.persist(); this.changed();
    });
  }
  async uninstall(id: string, removeSettings = false) {
    return this.exclusive(async () => {
    if (!await this.confirmDiscardDrafts(id)) return;
    check(this.adapter?.safeToUpdate(), 'Finish the current edit or save first.'); this.stop(id);
    const old = this.installed; this.installed = this.installed.filter(p => p.id !== id);
    try { await this.persist(); } catch (error) { this.installed = old; throw error; }
    if (removeSettings) await pluginStorage.remove('settings-' + id); this.changed();
    });
  }
  async rollback(id: string, digest: string) {
    return this.exclusive(async () => {
    check(this.adapter?.safeToUpdate(), 'Finish the current edit or save first.');
    check(!this.hasDrafts(id) && !this.commandStack.length, 'Finish the plugin form or running command before rolling back.');
    const record = this.record(id); const lock = record.history.find(v => v.digest === digest); check(lock, 'Rollback version is not in retained history.');
    check(lock.manifest.permissions.every(p => record.grants.includes(p)), 'Older version needs permissions that are no longer granted. Reinstall it to review grants.');
    const pkg = await this.loadLock(lock); const settings = await pluginStorage.getSettings(id);
    const previous = { ...record, history: [...record.history] };
    this.stop(id); record.current = lock; record.history = [previous.current, ...record.history.filter(v => v.digest !== digest)].slice(0, 5);
    record.policy = 'pinned'; record.error = undefined; record.revision++;
    await pluginStorage.setSettings(id, record.settingsSnapshots?.[digest] || {});
    try { this.packages.set(digest, pkg); if (record.enabled && !this.safeMode) await this.controller(id); await this.persist(); }
    catch (error) { this.stop(id); Object.assign(record, previous); await pluginStorage.setSettings(id, settings); throw error; }
    this.notify(`${record.current.manifest.name} rolled back to ${record.current.manifest.version}. Automatic updates are paused.`);
    });
  }
  async checkUpdates(force = false) {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const groups = new Map<string, PluginVersion[]>();
      for (const record of [...this.installed]) {
        if (!record.current.source.release || record.policy === 'pinned') continue;
        const key = record.current.source.repository.url + ':' + record.channel;
        try {
          if (!groups.has(key)) groups.set(key, await githubPlugins.versions(record.current.source.repository.url, { prerelease: record.channel === 'prerelease', refresh: force }));
          const versions = groups.get(key)!; const candidates = versions.filter(v => v.entry.id === record.id && compatible(v.entry, platform)).sort((a, b) => compare(b.entry.version, a.entry.version));
          const candidate = candidates[0]; if (!candidate || !gt(candidate.entry.version, record.current.manifest.version)) continue;
          this.available = [...this.available.filter(v => v.entry.id !== record.id), ...candidates]; this.changed();
          if (record.policy !== 'automatic' || !record.enabled || this.safeMode || !this.adapter?.safeToUpdate() || this.commandStack.length || this.hasDrafts(record.id)) continue;
          const pkg = await githubPlugins.load(candidate); if (record.rejected.includes(pkg.digest)) continue;
          const schemas = record.current.manifest.contributes?.dataSchemas || [];
          const migration = pkg.manifest.contributes?.dataSchemas?.some(s => s.version > (schemas.find(old => old.scope === s.scope)?.version || 0));
          if (migration || pkg.manifest.permissions.some(p => !record.grants.includes(p))) { this.notify(`${pkg.manifest.name} ${pkg.manifest.version} needs review before updating.`); continue; }
          await this.install(pkg, record.grants, true);
        } catch (error) { if (force) this.notify(`Update check for ${record.current.manifest.name}: ${(error as Error).message}`); }
      }
    })();
    try { await this.checking; } finally { this.checking = undefined; }
  }
  record(id: string) { const record = this.installed.find(p => p.id === id); check(record, 'Plugin is not installed.'); return record; }
  private async loadLock(lock: VersionLock) {
    let pkg = this.packages.get(lock.digest) || await pluginStorage.getPackage(lock.digest);
    if (!pkg) { pkg = await githubPlugins.load(lock.source); check(pkg.digest === lock.digest, 'The exact locked plugin version is no longer available.'); await pluginStorage.setPackage(pkg); }
    parseManifest(pkg.manifest, lock.source.entry);
    check(JSON.stringify(pkg.manifest) === JSON.stringify(lock.manifest), 'Cached manifest does not match the version lock.');
    for (const [file, expected] of Object.entries(lock.fileHashes)) check(pkg.files[file] && await sha256(pkg.files[file]) === expected, 'Cached plugin resource is corrupt: ' + file);
    this.packages.set(lock.digest, pkg); return pkg;
  }
  package(id: string) { return this.loadLock(this.record(id).current); }
  private runtimeError(id: string, message: string) {
    const record = this.installed.find(p => p.id === id); if (record) record.error = message;
    this.notify(`${record?.current.manifest.name || id}: ${message}`);
  }
  async controller(id: string): Promise<PluginConnection> {
    check(!this.safeMode, 'Plugins are disabled in safe-start mode.'); const record = this.record(id);
    check(record.enabled && !record.error, record.error || 'Plugin is disabled.');
    if (this.controllers.has(id)) { const connection = this.controllers.get(id)!; await connection.ready; return connection; }
    const pkg = await this.package(id);
    if (this.controllers.has(id)) { const connection = this.controllers.get(id)!; await connection.ready; return connection; }
    const connection = new PluginConnection(pkg, 'controller', {}, (method, params) => this.invoke(id, method, params, {}), document.body, error => this.runtimeError(id, error));
    this.controllers.set(id, connection); await connection.ready; return connection;
  }
  async mount(id: string, surface: string, context: SurfaceContext, container: HTMLElement) {
    await this.controller(id); const pkg = await this.package(id); check(pkg.manifest.ui, 'Plugin has no UI bundle.');
    const allowed = [...(pkg.manifest.contributes?.panels || []), ...(pkg.manifest.contributes?.symbolEditorTabs || []), ...(pkg.manifest.contributes?.mainViews || [])];
    check(allowed.some(v => v.surface === surface && this.visible(v)), 'Unknown or unavailable plugin surface.');
    const boundContext = { ...context, surfaceInstanceId: crypto.randomUUID() };
    const connection = new PluginConnection(pkg, 'ui', { ...boundContext, surface, locale: document.documentElement.lang || 'en', theme: { background: '#ffffff', foreground: '#242424', accent: '#0f6cbd' } }, (method, params) => this.invoke(id, method, params, boundContext), container, error => this.notify(`${pkg.manifest.name}: ${error}`));
    if (!this.surfaces.has(id)) this.surfaces.set(id, new Set()); this.surfaces.get(id)!.add(connection);
    return { ready: connection.ready, dispose: () => { this.drafts.delete(boundContext.surfaceInstanceId); connection.dispose(); this.surfaces.get(id)?.delete(connection); } };
  }
  stop(id: string) {
    window.electronAPI?.cancelPluginTasks?.(id);
    for (const [key, owner] of this.drafts) if (owner === id) this.drafts.delete(key);
    this.controllers.get(id)?.dispose(); this.controllers.delete(id);
    for (const connection of this.surfaces.get(id) || []) connection.dispose(); this.surfaces.delete(id);
    this.views = this.views.filter(v => v.pluginId !== id); if (!this.views.some(v => v.id === this.activeView)) this.activeView = undefined;
  }
  async execute(command: string, args: any = {}, callerId?: string) {
    const found = this.contributions('commands').find(v => v.item.id === command);
    check(found && this.enabled(found.item), 'Plugin command is unavailable in the current context.');
    check(!callerId || callerId === found.plugin.id || found.item.exported, 'Command is not exported to other plugins.');
    check(!this.commandStack.includes(command) && this.commandStack.length < 8, 'Recursive plugin command execution.');
    this.commandStack.push(command);
    try { const connection = await this.controller(found.plugin.id); return await connection.call('command:' + command, args); }
    finally { this.commandStack.splice(this.commandStack.lastIndexOf(command), 1); }
  }
  async searchLibrary(id: string, providerId: string, query: string) {
    const record = this.record(id);
    check(record.grants.includes('libraries.provide') && record.current.manifest.contributes?.libraryProviders?.some(p => p.id === providerId), 'Library provider is not permitted.');
    const connection = await this.controller(id); const result = await connection.call('library:' + providerId + ':search', { query, limit: 100 });
    check(Array.isArray(result) && result.length <= 100, 'Library search returned too many or invalid results.');
    return result.map(item => { check(item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.length <= 200 && (!item.description || typeof item.description === 'string'), 'Invalid library search result.'); return { id: item.id, name: item.name, description: item.description || '' }; });
  }
  /** Called only by the host's Place button. The user action authorizes this placement. */
  async placeLibrarySymbol(id: string, providerId: string, symbolId: string) {
    const record = this.record(id); check(this.adapter, 'Plugin host is unavailable.');
    return this.adapter.invoke({ ...record, grants: [...record.grants, 'document.write'] }, 'libraries.placeSymbol', { providerId, symbolId }, {});
  }
  openView(viewType: string, documentId?: string) {
    const found = this.contributions('mainViews').find(v => v.item.id === viewType); check(found, 'Plugin view is unavailable.');
    if (found.item.scope === 'document') check(documentId, 'This view requires a document.');
    const existing = !found.item.multiple && this.views.find(v => v.viewType === viewType && v.documentId === documentId);
    const view = existing || { id: crypto.randomUUID(), pluginId: found.plugin.id, viewType, title: found.item.title, surface: found.item.surface, documentId };
    if (!existing) this.views = [...this.views, view]; this.activeView = view.id; this.changed(); return view.id;
  }
  activateView(id?: string) { check(!id || this.views.some(v => v.id === id), 'View is closed.'); this.activeView = id; this.changed(); }
  closeView(id: string) { this.views = this.views.filter(v => v.id !== id); if (this.activeView === id) this.activeView = undefined; this.changed(); }
  event(event: string, payload: any) {
    for (const record of this.installed) {
      // Event names are public; data is filtered before crossing the boundary.
      const canRead = record.grants.includes('document.read') || record.grants.includes('symbols.read');
      if (!canRead && !['themeChanged', 'localeChanged', 'activeViewChanged'].includes(event)) continue;
      this.controllers.get(record.id)?.event(event, payload);
      for (const surface of this.surfaces.get(record.id) || []) surface.event(event, payload);
    }
  }
  private async invoke(id: string, method: string, params: any, context: SurfaceContext): Promise<any> {
    const record = this.record(id); check(record.enabled && !this.safeMode, 'Plugin is disabled.');
    if (method === 'ui.setDirty') {
      check(context.surfaceInstanceId && typeof params.dirty === 'boolean', 'Only UI surfaces can track form drafts.');
      params.dirty ? this.drafts.set(context.surfaceInstanceId, id) : this.drafts.delete(context.surfaceInstanceId); return;
    }
    if (method === 'commands.execute') {
      if (params.command.startsWith('core.')) return this.adapter!.invoke(record, method, params, context);
      return this.execute(params.command, params.args, id);
    }
    if (method === 'commands.listAvailable') return this.contributions('commands').filter(v => v.plugin.id === id || v.item.exported).map(v => ({ id: v.item.id, title: v.item.title, enabled: this.enabled(v.item) }));
    if (method === 'views.open') { check(this.contributions('mainViews').some(v => v.plugin.id === id && v.item.id === params.viewType), 'Cannot open another plugin\'s view.'); return this.openView(params.viewType, params.documentId || context.documentId); }
    if (method === 'views.close') { check(this.views.some(v => v.pluginId === id && v.id === params.viewId), 'Cannot close another plugin\'s view.'); this.closeView(params.viewId); return; }
    if (method === 'settings.get') return pluginStorage.getSettings(id);
    if (method === 'settings.set') { check(params.value && typeof params.value === 'object' && JSON.stringify(params.value).length <= LIMITS.metadata, 'Invalid or oversized plugin settings.'); await pluginStorage.setSettings(id, params.value); return; }
    if (method === 'resources.read') { const pkg = await this.package(id); check(pkg.manifest.files.includes(params.path), 'Undeclared package resource.'); return pkg.files[params.path]; }
    check(this.adapter, 'Plugin host is not ready.'); return this.adapter.invoke(record, method, params, context);
  }
  private syncNativeMenus() {
    if (!window.electronAPI?.setPluginMenus) return;
    const menus = this.contributions('menus').filter(v => !v.item.location.startsWith('context/')).map(({ plugin, item }) => {
      const command = plugin.current.manifest.contributes?.commands?.find(c => c.id === item.command);
      return { label: command?.title || item.command, command: item.command, enabled: this.enabled(item) && !!command && this.enabled(command), location: item.location };
    });
    window.electronAPI.setPluginMenus(menus);
  }
}
export const pluginManager = new PluginManager();
