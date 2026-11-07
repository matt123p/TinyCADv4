import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Tab, TabList } from '@fluentui/react-components';
import { AddRegular, ArrowClockwiseRegular, BoxRegular, CodeRegular, DeleteRegular, DismissRegular, SearchRegular } from '@fluentui/react-icons';
import { compare, gt } from 'semver';
import { pluginManager, platform } from './manager';
import { compatible } from './validation';
import type { InstalledPlugin, PluginPackage, PluginVersion } from './types';
import { sourceIdentity } from './types';
import { MarkdownDocumentation } from './MarkdownDocumentation';
import { prompts } from './prompts';
import { openExternalUrl } from '../util/navigation';
import { developmentPlugins } from './development';
import { githubSource, loadSourceSettings, saveSourceSettings, versionSource } from './sources';
import type { PluginSource, PluginSourceSettings } from './sources';

type View = 'installed' | 'available';
type Documentation = 'readme' | 'changelog' | 'documentation';
type SourceEditor = { kind: 'github' | 'server' | 'directory' | 'revision'; url: string; ref: string; developer: boolean };
const rowKey = (v: PluginVersion) => `${sourceIdentity(v)}:${v.entry.id}`;
const identity = (v: PluginVersion) => `${rowKey(v)}:${v.entry.version}:${v.release?.id || v.commit}`;
const sourceLabel = (v: PluginVersion) => v.development
  ? v.development.kind === 'server' ? v.development.url : v.development.name
  : v.commit === 'bundled' ? 'Previously installed example' : v.repository.url;
const unique = (versions: PluginVersion[]) => versions.filter((v, i) => versions.findIndex(other => identity(v) === identity(other)) === i);

export function PluginManagerDialog({ suspended = false }: { suspended?: boolean }) {
  useSyncExternalStore(pluginManager.subscribe, pluginManager.snapshot, pluginManager.snapshot);
  const [view, setView] = useState<View>('installed');
  const [settings, setSettings] = useState<PluginSourceSettings>({ sources: [], catalogs: {} });
  const [ready, setReady] = useState(false);
  const [sourceId, setSourceId] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [prerelease, setPrerelease] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pkg, setPackage] = useState<PluginPackage>();
  const [packageVersion, setPackageVersion] = useState('');
  const [documentTab, setDocumentTab] = useState<Documentation>('readme');
  const [documentationError, setDocumentationError] = useState('');
  const [documentLoading, setDocumentLoading] = useState(false);
  const [editor, setEditor] = useState<SourceEditor>();
  const [editorError, setEditorError] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const folderTarget = useRef<{ record?: InstalledPlugin; source?: PluginSource }>({});
  const list = useRef<HTMLDivElement>(null);
  const source = settings.sources.find(item => item.id === sourceId);

  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await loadSourceSettings(pluginManager.installed.map(record => record.current.source));
      if (active) setSettings(saved);
    })().catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const perform = async (label: string, task: () => Promise<void>) => {
    setBusy(label); setError(''); setNotice('');
    try { await task(); } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };
  const remember = async (next: PluginSourceSettings) => { await saveSourceSettings(next); setSettings(next); };
  const readSource = async (item: PluginSource, refresh = false): Promise<PluginVersion[]> => {
    if (item.kind === 'github') return pluginManager.discover(item.url, { ref: item.ref, prerelease, refresh });
    if (item.kind === 'server') return developmentPlugins.server(item.url);
    return developmentPlugins.versions(item.directory);
  };
  const rememberCatalog = async (item: PluginSource, versions: PluginVersion[], activate = false) => {
    const sources = [...settings.sources.filter(other => other.id !== item.id), item];
    await remember({ sources, catalogs: { ...settings.catalogs, [item.id]: versions } });
    if (activate) { setSourceId(item.id); setView('available'); setSearch(''); setSelectedKey(''); setSelectedVersion(''); }
  };
  const selectSource = (id: string) => {
    setSourceId(id); setSelectedKey(''); setSelectedVersion(''); setError('');
    const item = settings.sources.find(candidate => candidate.id === id);
    if (item && !settings.catalogs[id]) void perform('Loading plugin source…', async () => { await rememberCatalog(item, await readSource(item)); });
  };
  const preview = (version: PluginVersion) => pluginManager.preview(version);
  const install = async (item: PluginPackage) => {
    const manifest = item.manifest;
    const answer = await prompts.ask('Install plugin', 'Run this plugin and grant the listed permissions?', undefined,
      `${manifest.name} ${manifest.version}\n${manifest.description}\n\nPermissions: ${manifest.permissions.join(', ') || 'none'}`);
    if (answer !== 'accept') return;
    await pluginManager.install(item, manifest.permissions);
    setView('installed'); setSelectedKey(rowKey(item.source)); setSelectedVersion('');
    setNotice(`${manifest.name} is installed.`);
  };
  const chooseFolder = (record?: InstalledPlugin, existingSource?: PluginSource) => {
    folderTarget.current = { record, source: existingSource };
    if (platform === 'electron') void perform('Reading development folder…', async () => {
      const versions = await developmentPlugins.chooseDirectory();
      if (versions.length) { await rememberCatalog(versionSource(versions[0]), versions, true); setEditor(undefined); }
    });
    else folderInput.current?.click();
  };
  const refresh = () => {
    if (source?.kind === 'directory' && platform === 'browser') { chooseFolder(undefined, source); return; }
    void perform('Refreshing plugin sources…', async () => {
      const catalogs = { ...settings.catalogs }; const failures: string[] = [];
      for (const item of source ? [source] : settings.sources) {
        try { catalogs[item.id] = await readSource(item, true); } catch (err) { failures.push(`${item.name}: ${(err as Error).message}`); }
      }
      await remember({ ...settings, catalogs });
      if (view === 'installed') await pluginManager.checkUpdates(true);
      if (failures.length) throw new Error(failures.join('\n'));
      setNotice('Plugin sources are up to date.');
    });
  };
  const addSource = (): void => void perform('Adding plugin source…', async () => {
    try {
      if (editor.kind === 'directory') { chooseFolder(); return; }
      const versions = editor.kind === 'server' ? await developmentPlugins.server(editor.url)
        : await pluginManager.discover(githubSource(editor.url).url, { ref: editor.kind === 'revision' ? editor.ref : undefined, prerelease, refresh: true });
      const item = editor.kind === 'server' ? versionSource(versions[0]) : githubSource(editor.url, editor.kind === 'revision' ? editor.ref : undefined);
      await rememberCatalog(item, versions, true); setEditor(undefined);
    } catch (err) { setEditorError((err as Error).message); }
  });

  const configured = new Set(settings.sources.map(item => item.id));
  const available = unique([...Object.values(settings.catalogs).flat(), ...pluginManager.available,
    ...pluginManager.installed.map(record => record.current.source)])
    .filter(version => version.commit !== 'bundled' && configured.has(versionSource(version).id));
  const candidates = view === 'installed' ? pluginManager.installed.map(record => record.current.source) : [...available].sort((a, b) => compare(b.entry.version, a.entry.version));
  const query = search.trim().toLowerCase();
  const rows = candidates.filter((version, index) => candidates.findIndex(other => rowKey(other) === rowKey(version)) === index)
    .filter(version => (sourceId === 'all' || versionSource(version).id === sourceId)
      && `${version.entry.name} ${version.entry.id} ${version.entry.description}`.toLowerCase().includes(query))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  const selected = rows.find(version => rowKey(version) === selectedKey) || rows[0];
  const record = selected && pluginManager.installed.find(item => item.id === selected.entry.id && sourceIdentity(item.current.source) === sourceIdentity(selected));
  const options = selected ? unique([...(record ? [record.current, ...record.history].map(lock => lock.source) : []),
    ...available.filter(version => rowKey(version) === rowKey(selected))]).sort((a, b) => compare(b.entry.version, a.entry.version)) : [];
  const candidate = options.find(version => identity(version) === selectedVersion)
    || (view === 'installed' ? record?.current.source : options.find(version => compatible(version.entry, platform))) || selected;
  const candidateId = candidate && identity(candidate);
  const displayedPackage = packageVersion === candidateId ? pkg : undefined;
  const installedElsewhere = selected && !record && pluginManager.installed.some(item => item.id === selected.entry.id);
  const retained = candidate && record?.history.find(lock => identity(lock.source) === candidateId);
  const currentSelected = record && candidateId === identity(record.current.source);
  const sourceLink = candidate?.release?.html_url || candidate?.repository?.url;

  useEffect(() => {
    let active = true;
    setPackage(undefined); setDocumentationError(''); setDocumentLoading(!!candidate);
    if (candidate) void preview(candidate).then(value => { if (active) { setPackage(value); setPackageVersion(candidateId); } })
      .catch(err => { if (active) setDocumentationError(err.message); }).finally(() => { if (active) setDocumentLoading(false); });
    return () => { active = false; };
  }, [candidateId, record?.current.digest]);

  const selectRow = (version: PluginVersion) => { setSelectedKey(rowKey(version)); setSelectedVersion(''); setDocumentTab('readme'); };
  const reload = () => {
    if (record.current.source.development.kind === 'directory' && platform !== 'electron') { chooseFolder(record); return; }
    void perform('Reloading development plugin…', async () => { await install(await developmentPlugins.reload(record.current.source)); });
  };
  const openEditor = (developer: boolean) => { setEditorError(''); setEditor({ developer, kind: developer ? 'server' : 'github', url: developer ? 'http://localhost:8080/' : '', ref: '' }); };

  return <>
    <input hidden type="file" multiple ref={folderInput} aria-label="Development folder" {...({ webkitdirectory: '' } as any)} onChange={event => {
      const files = Array.from(event.target.files || []); const target = folderTarget.current; event.target.value = '';
      if (files.length) void perform('Reading development folder…', async () => {
        const versions = await developmentPlugins.directory(files, target.record?.current.source.development || target.source?.directory);
        if (target.record) await install(await developmentPlugins.reload(target.record.current.source));
        else { await rememberCatalog(versionSource(versions[0]), versions, true); setEditor(undefined); }
      });
    }} />
    <Dialog surfaceMotion={null} open={!suspended && !editor} onOpenChange={(_, data) => { if (!data.open && !busy) pluginManager.hideManager(); }}>
      <DialogSurface className="plugin-manager"><DialogBody>
        <DialogTitle className="plugin-manager-title" action={<Button appearance="subtle" disabled={!!busy} icon={<DismissRegular />} aria-label="Close plugin manager" onClick={() => pluginManager.hideManager()} />}>Plugin manager</DialogTitle>
        <DialogContent className="plugin-manager-content">
          <div className="plugin-manager-navigation">
            <TabList selectedValue={view} onTabSelect={(_, data) => { setView(data.value as View); setSelectedVersion(''); }}>
              <Tab value="installed">Installed <span className="plugin-count">{pluginManager.installed.length}</span></Tab>
              <Tab value="available">Available</Tab>
            </TabList>
            <Button appearance="subtle" icon={<CodeRegular />} disabled={!!busy || !ready} onClick={() => openEditor(true)}>Developer mode</Button>
          </div>
          <div className="plugin-manager-toolbar">
            <div className="plugin-search"><SearchRegular /><input type="search" aria-label="Search plugins" placeholder="Search plugins" value={search} onChange={event => setSearch(event.target.value)} /></div>
            <label className="plugin-source-picker">Source<select aria-label="Plugin source" value={sourceId} disabled={!!busy || !ready} onChange={event => selectSource(event.target.value)}>
              <option value="all">All sources</option>{settings.sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <Button icon={<AddRegular />} disabled={!!busy || !ready} onClick={() => openEditor(false)}>Add</Button>
            <Button icon={<DeleteRegular />} disabled={!!busy || !source} title="Remove the selected source; keep its installed plugins" onClick={(): void => void perform('Removing plugin source…', async () => {
              const catalogs = { ...settings.catalogs }; delete catalogs[source.id];
              await remember({ sources: settings.sources.filter(item => item.id !== source.id), catalogs });
              setSourceId('all'); setNotice('Source removed. Installed plugins have been kept.');
            })}>Remove</Button>
            <Button icon={<ArrowClockwiseRegular />} aria-label="Refresh plugins" title="Refresh sources and check for updates" disabled={!!busy || !ready} onClick={refresh} />
          </div>
          <div className={`plugin-manager-status${error ? ' plugin-error' : ''}`} role={error ? 'alert' : 'status'}>
            {busy || !ready ? <><Spinner size="tiny" />{busy || 'Loading plugins…'}</> : error || (pluginManager.safeMode ? 'Safe start: plugin code is disabled.' : notice)}
          </div>
          <div className="plugin-manager-columns">
            <div className="plugin-manager-list" ref={list} role="listbox" aria-label="Plugins" onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !rows.length) return;
              event.preventDefault(); const index = rows.findIndex(item => rowKey(item) === rowKey(selected));
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
              selectRow(rows[next]); (list.current.querySelectorAll('[role=option]')[next] as HTMLElement)?.focus();
            }}>
              {rows.map(version => {
                const installed = pluginManager.installed.find(item => item.id === version.entry.id && sourceIdentity(item.current.source) === sourceIdentity(version));
                return <button role="option" aria-label={version.entry.name} aria-selected={rowKey(selected) === rowKey(version)} tabIndex={rowKey(selected) === rowKey(version) ? 0 : -1} className="plugin-list-row" key={rowKey(version)} onClick={() => selectRow(version)}>
                  <span className="plugin-list-icon"><BoxRegular /></span><span className="plugin-list-copy">
                    <span className="plugin-list-heading"><strong>{version.entry.name}</strong><span>{version.entry.version}</span></span>
                    <span className="plugin-list-description">{version.entry.description}</span>
                    <span className="plugin-list-meta">{installed ? installed.error ? 'Needs attention' : installed.enabled ? 'Installed' : 'Disabled' : 'Available'}<span>·</span>{versionSource(version).name}</span>
                  </span>
                </button>;
              })}
              {ready && !rows.length && <div className="plugin-empty"><BoxRegular /><strong>{query ? 'No matching plugins' : view === 'installed' ? 'No installed plugins' : 'No plugins in this source'}</strong><p>{query ? 'Try another name or clear your search.' : view === 'installed' ? 'Select Available to install a plugin.' : 'Add a repository URL or choose another source.'}</p></div>}
            </div>
            <section className="plugin-manager-details" aria-label="Plugin details">
              {candidate ? <>
                <div className="plugin-details-heading"><h2>{candidate.entry.name}</h2>{record && <span className="plugin-installed-badge">Installed {record.current.manifest.version}</span>}</div>
                <div className="plugin-package-id">{candidate.entry.id}</div>
                <p className="plugin-details-description">{candidate.entry.description}</p>
                <div className="plugin-version-actions"><label>Version<select aria-label="Plugin version" disabled={!!busy} value={candidateId} onChange={event => setSelectedVersion(event.target.value)}>{options.map(version => <option key={identity(version)} value={identity(version)}>{version.entry.version}{version.development ? ` · ${version.commit.slice(0, 8)}` : version.release?.prerelease ? ' · prerelease' : ''}{identity(version) === identity(record?.current.source || candidate) && record ? ' (installed)' : ''}</option>)}</select></label>
                  {(!record || !currentSelected) && <Button appearance="primary" disabled={!!busy || !displayedPackage || !compatible(candidate.entry, platform) || installedElsewhere} onClick={(): void => void perform('Installing plugin…', async () => {
                    if (retained) { await pluginManager.rollback(record.id, retained.digest); setSelectedVersion(''); }
                    else await install(displayedPackage);
                  })}>{retained ? 'Restore version' : record && gt(candidate.entry.version, record.current.manifest.version) ? 'Update' : 'Install'}</Button>}
                  {record && <>{record.current.source.development && <Button disabled={!!busy} onClick={reload}>{record.current.source.development.kind === 'directory' && platform === 'browser' ? 'Reload from folder…' : 'Reload from source'}</Button>}<Button disabled={!!busy} onClick={(): void => void perform('Changing plugin state…', () => pluginManager.setEnabled(record.id, !record.enabled))}>{record.enabled ? 'Disable' : 'Enable / retry'}</Button>
                    <Button disabled={!!busy} onClick={(): void => void perform('Uninstalling plugin…', async () => {
                      if (await prompts.ask('Uninstall plugin', `Remove ${record.current.manifest.name}? Data in designs and libraries will be preserved.`) === 'accept') { await pluginManager.uninstall(record.id); setSelectedVersion(''); }
                    })}>Uninstall</Button></>}
                </div>
                {!compatible(candidate.entry, platform) && <p className="plugin-error">This version is incompatible with this TinyCAD platform or API.</p>}
                {installedElsewhere && <p className="plugin-error">Installed from another source. Uninstall that copy before changing sources.</p>}
                {record?.error && <p role="alert" className="plugin-error">{record.error}</p>}
                <div className="plugin-details-source" title={sourceLabel(candidate)}><span>Source</span>{sourceLink?.startsWith('https://') ? <a href={sourceLink} onClick={event => { event.preventDefault(); openExternalUrl(sourceLink); }}>{sourceLabel(candidate)}</a> : <span>{sourceLabel(candidate)}</span>}</div>
                {record && <details className="plugin-settings"><summary>Plugin settings</summary><div className="plugin-settings-content">
                  {record.current.source.development ? <span>Manual development reloads</span> : <>
                    <label>Updates<select value={record.policy} disabled={!!busy} onChange={event => void perform('Saving update policy…', () => pluginManager.policy(record.id, event.target.value as InstalledPlugin['policy']))}><option value="automatic">Automatic</option><option value="manual">Manual</option><option value="pinned">Pinned to this version</option></select></label>
                    <label>Channel<select value={record.channel} disabled={!!busy} onChange={event => void perform('Saving update channel…', () => pluginManager.policy(record.id, record.policy, event.target.value as InstalledPlugin['channel']))}><option value="stable">Stable releases</option><option value="prerelease">Include prereleases</option></select></label>
                  </>}
                  {record.history.length > 0 && <label>Rollback<select aria-label={`${record.current.manifest.name} rollback`} value="" disabled={!!busy} onChange={event => { const digest = event.target.value; if (digest) void perform('Rolling back plugin…', async () => { await pluginManager.rollback(record.id, digest); setSelectedVersion(''); }); }}><option value="">Choose previous version…</option>{record.history.map(lock => <option key={lock.digest} value={lock.digest}>{lock.manifest.version} · {lock.digest.slice(0, 8)} · {new Date(lock.installedAt).toLocaleDateString()}</option>)}</select></label>}
                  {record.current.manifest.contributes?.mainViews?.filter(item => item.scope === 'application').map(item => <label key={item.id}><input type="checkbox" checked={localStorage.getItem('tinycad.plugins.startupView') === item.id} onChange={event => { event.target.checked ? localStorage.setItem('tinycad.plugins.startupView', item.id) : localStorage.removeItem('tinycad.plugins.startupView'); pluginManager.changed(); }} />Use {item.title} as the startup page</label>)}
                  {platform === 'electron' && record.grants.includes('desktop.tools') && <Button disabled={!!busy} onClick={(): void => void perform('Configuring native tool…', async () => { const tool = await window.electronAPI.choosePluginTool(record.id); if (tool) setNotice(`Native tool configured: ${tool.name}`); })}>Configure native tool</Button>}
                </div></details>}
                <div className="plugin-document-tabs"><TabList size="small" selectedValue={documentTab} onTabSelect={(_, data) => setDocumentTab(data.value as Documentation)}><Tab value="readme">Description</Tab><Tab value="changelog">Changelog</Tab><Tab value="documentation">Full documentation</Tab></TabList></div>
                {documentLoading && <div className="plugin-document-loading"><Spinner size="tiny" />Loading description…</div>}
                {documentationError && <p role="alert" className="plugin-error">{documentationError}</p>}
                {displayedPackage && <MarkdownDocumentation pkg={displayedPackage} entry={displayedPackage.manifest[documentTab]} />}
              </> : <div className="plugin-empty"><BoxRegular /><strong>Select a plugin</strong><p>Its description, versions, and documentation will appear here.</p></div>}
            </section>
          </div>
          <div className="plugin-manager-footer"><span>{rows.length} {rows.length === 1 ? 'plugin' : 'plugins'}</span><label><input type="checkbox" checked={prerelease} disabled={!!busy} onChange={event => { setPrerelease(event.target.checked); setNotice('Refresh the source to apply the prerelease filter.'); }} />Include prereleases</label></div>
        </DialogContent>
      </DialogBody></DialogSurface>
    </Dialog>
    {editor && <Dialog open={!suspended} onOpenChange={(_, data) => { if (!data.open && !busy) setEditor(undefined); }}><DialogSurface className="plugin-source-dialog"><DialogBody>
      <DialogTitle>{editor.developer ? 'Developer mode' : 'Add plugin repository'}</DialogTitle>
      <DialogContent><form id="plugin-source-form" className="plugin-source-form" onSubmit={event => { event.preventDefault(); addSource(); }}>
        {editor.developer && <label>Development source<select value={editor.kind} disabled={!!busy} onChange={event => { const kind = event.target.value as SourceEditor['kind']; setEditor({ ...editor, kind, url: kind === 'server' ? 'http://localhost:8080/' : '' }); }}><option value="server">Local server</option><option value="directory">Local folder</option><option value="revision">GitHub tag or commit</option></select></label>}
        {editor.kind !== 'directory' && <label>{editor.kind === 'server' ? 'Local plugin server URL' : 'GitHub repository URL'}<input autoFocus type="url" required disabled={!!busy} placeholder={editor.kind === 'server' ? 'http://localhost:8080/' : 'https://github.com/owner/repository'} value={editor.url} onChange={event => setEditor({ ...editor, url: event.target.value })} /></label>}
        {editor.kind === 'revision' && <label>Tag or commit<input required disabled={!!busy} value={editor.ref} onChange={event => setEditor({ ...editor, ref: event.target.value })} /></label>}
        <p>{editor.kind === 'github' ? 'Add a repository, then choose which plugins to install.' : editor.kind === 'directory' ? 'Choose a folder containing a plugin manifest or a catalog. Browser reloads require selecting the folder again.' : 'Development plugins reload manually. Local servers must allow browser CORS requests.'}</p>
        {busy && <div className="plugin-source-progress" role="status"><Spinner size="tiny" />{busy}</div>}
        {(editorError || error) && <p role="alert" className="plugin-error">{editorError || error}</p>}
      </form></DialogContent>
      <DialogActions><Button disabled={!!busy} onClick={() => setEditor(undefined)}>Cancel</Button>{editor.kind === 'directory' ? <Button appearance="primary" disabled={!!busy} onClick={() => chooseFolder()}>Choose folder</Button> : <Button appearance="primary" disabled={!!busy} type="submit" form="plugin-source-form">Add source</Button>}</DialogActions>
    </DialogBody></DialogSurface></Dialog>}
  </>;
}
