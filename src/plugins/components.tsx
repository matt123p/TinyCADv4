import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { docDrawing } from '../state/undo/undo';
import { pluginManager, platform } from './manager';
import { documentSessions } from './sessions';
import { prompts } from './prompts';
import { PluginManagerDialog } from './PluginManagerDialog';
import { SurfaceContext } from './types';
import '../../styles/plugins.scss';

export const usePlugins = () => useSyncExternalStore(pluginManager.subscribe, pluginManager.snapshot, pluginManager.snapshot);
export const useSessions = () => useSyncExternalStore(documentSessions.subscribe, documentSessions.snapshot, documentSessions.snapshot);
const run = (task: Promise<any>) => { void task.catch(error => pluginManager.notify(error.message)); };
export function PluginSurface({ pluginId, surface, context = {} }: { pluginId: string; surface: string; context?: SurfaceContext }) {
  usePlugins(); useSessions();
  const root = useRef<HTMLDivElement>(null); const [error, setError] = useState('');
  const digest = pluginManager.installed.find(p => p.id === pluginId)?.current.digest;
  const symbolId = useSelector((state: docDrawing) => state.docStore.present.editLibrary?.symbols.find(s => s.SymbolId === state.docStore.present.editSymbol?.SymbolID)?.persistentId);
  const fullContext = { documentId: context.documentId || documentSessions.activeId, symbolId: context.symbolId || symbolId, viewId: context.viewId };
  useEffect(() => {
    if (!root.current) return;
    let disposed = false; let connection: { dispose(): void } | undefined; setError('');
    void pluginManager.mount(pluginId, surface, fullContext, root.current).then(async result => {
      if (disposed) { result.dispose(); return; } connection = result; await result.ready;
    }).catch(err => { if (!disposed) setError(err.message); });
    return () => { disposed = true; connection?.dispose(); };
  }, [pluginId, surface, digest, fullContext.documentId, fullContext.symbolId, fullContext.viewId]);
  return <div className="plugin-surface" ref={root}>{error && <p role="alert">{error}</p>}</div>;
}
function PluginLibrary({ pluginId, providerId }: { pluginId: string; providerId: string }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setBusy(true); setError('');
      void pluginManager.searchLibrary(pluginId, providerId, query).then(list => { if (current) setResults(list); }).catch(err => { if (current) setError(err.message); }).finally(() => { if (current) setBusy(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [pluginId, providerId, query]);
  return <div className="plugin-library"><label>Search components<input value={query} onChange={event => setQuery(event.target.value)} /></label>
    {busy && <p role="status">Searching…</p>}{error && <p role="alert">{error}</p>}
    {results.map(item => <div key={item.id} className="plugin-library-item"><strong>{item.name}</strong><p>{item.description}</p><Button onClick={() => run(pluginManager.placeLibrarySymbol(pluginId, providerId, item.id))}>Place symbol</Button></div>)}
    {!busy && !results.length && <p>No matching components.</p>}
  </div>;
}
export function PluginPanelHost({ location, children }: { location: 'left' | 'bottom'; children: React.ReactNode }) {
  usePlugins(); const key = 'tinycad.plugins.panel.' + location;
  const [selected, setSelected] = useState(() => { try { return localStorage.getItem(key) || 'builtin'; } catch { return 'builtin'; } });
  const panels = pluginManager.contributions('panels').filter(v => v.item.location === location);
  const providers = location === 'left' ? pluginManager.contributions('libraryProviders') : [];
  const panel = panels.find(v => v.item.id === selected); const provider = providers.find(v => v.item.id === selected);
  const choice = panel || provider ? selected : 'builtin';
  if (!panels.length && !providers.length) return <>{children}</>;
  return <div className="plugin-panel-slot">
    <label className="plugin-panel-selector">{location === 'left' ? 'Left panel' : 'Bottom panel'}<select aria-label={location === 'left' ? 'Left panel' : 'Bottom panel'} value={choice} onChange={event => {
      setSelected(event.target.value); try { localStorage.setItem(key, event.target.value); } catch { /* Session selection still works. */ }
    }}><option value="builtin">{location === 'left' ? 'Libraries' : 'Context'}</option>
      {panels.map(v => <option key={v.item.id} value={v.item.id}>{v.item.title} · {v.plugin.current.manifest.name}</option>)}
      {providers.map(v => <option key={v.item.id} value={v.item.id}>{v.item.title} · component library</option>)}
    </select></label>
    <div className="plugin-panel-content">{panel ? <PluginSurface pluginId={panel.plugin.id} surface={panel.item.surface} /> : provider ? <PluginLibrary pluginId={provider.plugin.id} providerId={provider.item.id} /> : children}</div>
  </div>;
}
export function PluginToolbarItems({ toolbar }: { toolbar: string }) {
  usePlugins(); const items = pluginManager.contributions('toolbarItems').filter(v => v.item.toolbar === toolbar);
  return <>{items.map(({ plugin, item }) => {
    const command = plugin.current.manifest.contributes?.commands?.find(c => c.id === item.command);
    if (!command || !pluginManager.visible(command)) return null;
    return <Button key={item.command} size="small" appearance="subtle" title={command.title} aria-label={command.title}
      disabled={!pluginManager.enabled(item) || !pluginManager.enabled(command)} onClick={() => run(pluginManager.execute(command.id))}>{command.title}</Button>;
  })}</>;
}
export function PluginBar() {
  usePlugins(); useSessions();
  const menus = pluginManager.contributions('menus').filter(v => !v.item.location.startsWith('context/'));
  const views = pluginManager.contributions('mainViews');
  return <div className="plugin-application-bar">
    <Button size="small" onClick={() => pluginManager.showManager()}>Plugins</Button>
    {platform === 'browser' && menus.length > 0 && <details className="plugin-actions-menu"><summary>Plugin actions</summary><div role="menu">{menus.map(({ plugin, item }, i) => {
      const command = plugin.current.manifest.contributes?.commands?.find(c => c.id === item.command);
      return command && pluginManager.visible(command) ? <button role="menuitem" key={item.command + i} disabled={!pluginManager.enabled(item) || !pluginManager.enabled(command)} onClick={() => run(pluginManager.execute(item.command))}>{item.location.split('/')[0]} · {command.title}</button> : null;
    })}</div></details>}
    {views.length > 0 && <select aria-label="Open plugin view" value="" onChange={event => { if (event.target.value) pluginManager.openView(event.target.value, documentSessions.activeId); }}>
      <option value="">Open plugin page…</option>{views.map(v => <option key={v.item.id} value={v.item.id}>{v.item.title}</option>)}
    </select>}
    {documentSessions.list().length > 1 && <Button size="small" onClick={() => run(documentSessions.saveAll().then(results => {
      const failed = results.filter(r => !r.saved); pluginManager.notify(failed.length ? `${failed.length} document(s) could not be saved.` : 'All documents saved.');
    }))}>Save all</Button>}
    {pluginManager.safeMode && <span>Safe start: plugins disabled</span>}
    {pluginManager.notifications.length > 0 && <span className="plugin-notification" role="status" title={pluginManager.notifications[pluginManager.notifications.length - 1]}>{pluginManager.notifications[pluginManager.notifications.length - 1]}</span>}
  </div>;
}
export function PluginToolbars() {
  usePlugins();
  return <>{pluginManager.contributions('toolbars').map(({ item }) => <div key={item.id} className="plugin-owned-toolbar" role="toolbar" aria-label={item.title}>
    <span>{item.title}</span><PluginToolbarItems toolbar={item.id} />
  </div>)}</>;
}
export function PluginMainViews({ children }: { children: React.ReactNode }) {
  usePlugins(); useSessions(); const sessions = documentSessions.list(); const view = pluginManager.views.find(v => v.id === pluginManager.activeView);
  return <>
    {(sessions.length > 1 || pluginManager.views.length > 0) && <div className="plugin-main-tabs" role="tablist" aria-label="Open documents and plugin views">
      {sessions.map(session => <div key={session.id} className="plugin-main-tab"><button role="tab" aria-selected={!view && session.id === documentSessions.activeId} onClick={() => { try { documentSessions.activate(session.id); pluginManager.activateView(); } catch (error) { pluginManager.notify((error as Error).message); } }}>{session.name}{session.dirty ? ' *' : ''}</button>
        {sessions.length > 1 && <button aria-label={`Close ${session.name}`} onClick={() => run(documentSessions.close(session.id))}>×</button>}</div>)}
      {pluginManager.views.map(item => <div key={item.id} className="plugin-main-tab"><button role="tab" aria-selected={view?.id === item.id} onClick={() => pluginManager.activateView(item.id)}>{item.title}</button><button aria-label={`Close ${item.title}`} onClick={() => pluginManager.closeView(item.id)}>×</button></div>)}
    </div>}
    <div className="plugin-built-in-view" style={{ display: view ? 'none' : undefined }}>{children}</div>
    {view && <PluginSurface key={view.id} pluginId={view.pluginId} surface={view.surface} context={{ documentId: view.documentId, viewId: view.id }} />}
  </>;
}
export function PluginOverlays() {
  usePlugins(); const prompt = useSyncExternalStore(prompts.subscribe, prompts.snapshot, prompts.snapshot);
  return <>
    {pluginManager.managerOpen && <PluginManagerDialog suspended={!!prompt} />}
    {prompt && <Dialog open onOpenChange={(_, data) => { if (!data.open) prompts.answer('cancel'); }}><DialogSurface><DialogBody>
      <DialogTitle>{prompt.title}</DialogTitle><DialogContent><p>{prompt.message}</p>{prompt.preview && <pre className="plugin-edit-preview">{prompt.preview}</pre>}</DialogContent>
      <DialogActions>{prompt.choices.map(choice => <Button key={choice.value} appearance={choice.value === 'accept' || choice.value === 'save' ? 'primary' : 'secondary'} onClick={() => prompts.answer(choice.value)}>{choice.label}</Button>)}</DialogActions>
    </DialogBody></DialogSurface></Dialog>}
  </>;
}
