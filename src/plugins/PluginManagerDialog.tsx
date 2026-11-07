import React, { useState, useSyncExternalStore } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner, Tab, TabList } from '@fluentui/react-components';
import { pluginManager, platform, starterRepositories } from './manager';
import { compatible } from './validation';
import type { InstalledPlugin, PluginPackage, PluginVersion } from './types';
import { MarkdownDocumentation } from './MarkdownDocumentation';
import { prompts } from './prompts';
import { loadBundledPlugins } from './bundled';
import { gt } from 'semver';
import { openExternalUrl } from '../util/navigation';

const identity = (v: PluginVersion) => `${v.repository.id}:${v.entry.id}:${v.entry.version}:${v.release?.id || v.commit}`;
export function PluginManagerDialog({ suspended = false }: { suspended?: boolean }) {
  useSyncExternalStore(pluginManager.subscribe, pluginManager.snapshot, pluginManager.snapshot);
  const [tab, setTab] = useState('installed'); const [url, setUrl] = useState(''); const [ref, setRef] = useState(''); const [prerelease, setPrerelease] = useState(false);
  const [versions, setVersions] = useState<PluginVersion[]>([]); const [selected, setSelected] = useState<Record<string, string>>({});
  const [bundledPackages, setBundledPackages] = useState<Record<string, PluginPackage>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [pkg, setPackage] = useState<PluginPackage>(); const [documentTab, setDocumentTab] = useState<'overview' | 'changelog' | 'documentation'>('overview');
  const [documentationVersion, setDocumentationVersion] = useState('');
  const perform = async (label: string, task: () => Promise<void>) => {
    setBusy(label); setError(''); try { await task(); } catch (err) { setError((err as Error).message); } finally { setBusy(''); }
  };
  const discover = (repository = url) => perform('Reading repository releases…', async () => {
    const result = await pluginManager.discover(repository, { ref: ref || undefined, prerelease, refresh: true });
    setVersions(result); setSelected({}); setTab('discover');
  });
  const preview = (candidate: PluginVersion) => bundledPackages[identity(candidate)] ? Promise.resolve(bundledPackages[identity(candidate)]) : pluginManager.preview(candidate);
  const show = (candidate: PluginVersion, section: typeof documentTab = 'overview') => perform('Loading plugin documentation…', async () => {
    setPackage(await preview(candidate)); setDocumentationVersion(identity(candidate)); setDocumentTab(section);
  });
  const showInstalled = (record: InstalledPlugin, section: typeof documentTab = 'overview') => perform('Loading installed documentation…', async () => {
    setPackage(await pluginManager.package(record.id)); setDocumentationVersion(identity(record.current.source)); setDocumentTab(section);
  });
  const installPackages = async (packages: PluginPackage[]) => {
    const choices = packages.map(item => `${item.manifest.name} ${item.manifest.version}\n${item.manifest.description}\nPermissions: ${item.manifest.permissions.join(', ') || 'none'}`).join('\n\n');
    const answer = await prompts.ask('Install selected plugins', 'Run code from these publishers and grant the listed permissions? Release plugins use automatic stable updates by default.', undefined, choices);
    if (answer !== 'accept') return;
    const failures: string[] = [];
    for (const item of packages) {
      try { await pluginManager.install(item, item.manifest.permissions); }
      catch (err) { failures.push(`${item.manifest.name}: ${(err as Error).message}`); }
    }
    if (failures.length) throw new Error(failures.join('\n')); setTab('installed');
  };
  const ids = [...new Set(versions.map(v => v.entry.id))];
  const inspectVersions = pkg ? [...versions, ...pluginManager.available, ...pluginManager.installed.filter(p => p.id === pkg.manifest.id).flatMap(p => [p.current, ...p.history].map(v => v.source))]
    .filter(v => v.entry.id === pkg.manifest.id).filter((v, i, all) => all.findIndex(other => identity(v) === identity(other)) === i) : [];
  const sourceLink = pkg?.source.release?.html_url || pkg?.source.repository.url;
  return <Dialog open={!suspended} onOpenChange={(_, data) => { if (!data.open && !busy) pluginManager.hideManager(); }}>
    <DialogSurface className="plugin-manager"><DialogBody>
      <DialogTitle action={<Button appearance="subtle" disabled={!!busy} aria-label="Close plugin manager" onClick={() => pluginManager.hideManager()}>×</Button>}>Plugin manager</DialogTitle>
      <DialogContent className="plugin-manager-content">
        <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="installed">Installed</Tab><Tab value="discover">Discover</Tab></TabList>
        {busy && <div role="status" className="plugin-busy"><Spinner size="tiny" />{busy}</div>}
        {error && <p role="alert" className="plugin-error">{error}</p>}
        {pluginManager.safeMode && <p>Safe start is active. You can read documentation and manage packages; restart without <code>?plugins=safe</code> to run plugins.</p>}
        <div className="plugin-manager-columns"><div className="plugin-manager-list">
          {tab === 'discover' ? <>
            <h3>Recommended repositories</h3>
            <p>Start with the bundled examples, or choose a repository and select its plugins.</p>
            <Button disabled={!!busy} onClick={(): void => void perform('Preparing bundled examples…', async () => {
              const packages = await loadBundledPlugins(); setBundledPackages(Object.fromEntries(packages.map(item => [identity(item.source), item])));
              setVersions(packages.map(item => item.source)); setSelected({});
            })}>Browse bundled examples</Button>
            {starterRepositories.map(repository => <div className="plugin-card" key={repository.url}><strong>{repository.name}</strong><p>{repository.description}</p>
              <small>{repository.reviewedVersions.length ? `Reviewed: ${repository.reviewedVersions.join(', ')}` : 'Examples are reviewed with this TinyCAD build; remote releases are versioned separately.'}</small>
              <Button disabled={!!busy} onClick={() => { setUrl(repository.url); void discover(repository.url); }}>Browse repository</Button></div>)}
            <form onSubmit={event => { event.preventDefault(); void discover(); }} className="plugin-repository-form">
              <label>GitHub repository URL<input type="url" required placeholder="https://github.com/owner/repository" value={url} onChange={event => setUrl(event.target.value)} /></label>
              <label><input type="checkbox" checked={prerelease} onChange={event => setPrerelease(event.target.checked)} /> Include prereleases</label>
              <details><summary>Developer version</summary><label>Explicit tag or commit (bypasses release tracking)<input value={ref} onChange={event => setRef(event.target.value)} /></label></details>
              <Button type="submit" disabled={!!busy}>Browse plugins</Button>
            </form>
            {ids.map(id => {
              const options = versions.filter(v => v.entry.id === id); const choice = options.find(v => identity(v) === selected[id]) || options.find(v => compatible(v.entry, platform)) || options[0];
              return <div className="plugin-card" key={id}><label className="plugin-selection"><input type="checkbox" disabled={!compatible(choice.entry, platform)} checked={!!selected[id]} onChange={event => setSelected({ ...selected, [id]: event.target.checked ? identity(choice) : '' })} /><strong>{choice.entry.name}</strong></label>
                <p>{choice.entry.description}</p><select aria-label={`${choice.entry.name} version`} value={identity(choice)} onChange={event => setSelected({ ...selected, [id]: event.target.value })}>
                  {options.map(version => <option key={identity(version)} value={identity(version)}>{version.entry.version} · {version.release?.name || version.release?.tag_name || 'development ' + version.commit.slice(0, 8)}{compatible(version.entry, platform) ? '' : ' (incompatible)'}</option>)}
                </select><div className="plugin-card-actions"><Button disabled={!!busy} onClick={(): void => void show(choice)}>Description</Button><Button disabled={!!busy} onClick={(): void => void show(choice, 'changelog')}>Changelog</Button><Button disabled={!!busy} onClick={(): void => void show(choice, 'documentation')}>Full documentation</Button></div>
              </div>;
            })}
            {ids.length > 0 && <Button appearance="primary" disabled={!!busy || !Object.values(selected).some(Boolean)} onClick={(): void => void perform('Installing selected plugins…', async () => {
              const chosen = versions.filter(v => selected[v.entry.id] === identity(v)); const packages: PluginPackage[] = [];
              for (const version of chosen) packages.push(await preview(version)); await installPackages(packages);
            })}>Install selected plugins</Button>}
          </> : <>
            <div className="plugin-card-actions"><Button disabled={!!busy} onClick={(): void => void perform('Checking for updates…', () => pluginManager.checkUpdates(true))}>Check for updates</Button><Button onClick={() => setTab('discover')}>Find plugins</Button></div>
            {!pluginManager.installed.length && <p>No plugins installed. Open Discover to start with the bundled examples or a GitHub repository.</p>}
            {pluginManager.installed.map(record => {
              const manifest = record.current.manifest; const candidate = pluginManager.available.find(v => v.entry.id === record.id && gt(v.entry.version, manifest.version) && compatible(v.entry, platform));
              return <div className="plugin-card" key={record.id}><strong>{manifest.name}</strong> <span>{manifest.version}</span><p>{manifest.description}</p>
                <small>{record.current.source.repository.url} · {record.current.source.release?.name || 'source ' + record.current.source.commit.slice(0, 8)}</small>
                {record.error && <p role="alert">{record.error}</p>}
                <div className="plugin-card-actions"><Button disabled={!!busy} onClick={(): void => void showInstalled(record)}>Description</Button><Button disabled={!!busy} onClick={(): void => void showInstalled(record, 'changelog')}>Changelog</Button><Button disabled={!!busy} onClick={(): void => void showInstalled(record, 'documentation')}>Full documentation</Button></div>
                <label>Updates<select value={record.policy} disabled={!!busy} onChange={event => void perform('Saving update policy…', () => pluginManager.policy(record.id, event.target.value as InstalledPlugin['policy']))}><option value="automatic">Automatic</option><option value="manual">Manual</option><option value="pinned">Pinned to this version</option></select></label>
                <label>Channel<select value={record.channel} disabled={!!busy} onChange={event => void perform('Saving update channel…', () => pluginManager.policy(record.id, record.policy, event.target.value as InstalledPlugin['channel']))}><option value="stable">Stable releases</option><option value="prerelease">Include prereleases</option></select></label>
                <div className="plugin-card-actions"><Button disabled={!!busy} onClick={(): void => void perform('Changing plugin state…', () => pluginManager.setEnabled(record.id, !record.enabled))}>{record.enabled ? 'Disable' : 'Enable / retry'}</Button>
                  <Button disabled={!!busy} onClick={(): void => void perform('Uninstalling plugin…', async () => {
                    if (await prompts.ask('Uninstall plugin', `Remove ${manifest.name}? Data in designs and libraries will be preserved.`) === 'accept') await pluginManager.uninstall(record.id);
                  })}>Uninstall</Button>
                  {candidate && <Button disabled={!!busy} onClick={(): void => void perform('Reviewing available update…', async () => {
                    const update = await pluginManager.preview(candidate); setPackage(update); setDocumentTab('changelog'); await installPackages([update]);
                  })}>Update to {candidate.entry.version}</Button>}
                </div>
                {record.history.length > 0 && <label>Rollback<select aria-label={`${manifest.name} rollback`} value="" disabled={!!busy} onChange={event => { const digest = event.target.value; if (digest) void perform('Rolling back plugin…', () => pluginManager.rollback(record.id, digest)); }}><option value="">Choose previous version…</option>{record.history.map(lock => <option key={lock.digest} value={lock.digest}>{lock.manifest.version} · {new Date(lock.installedAt).toLocaleDateString()}</option>)}</select></label>}
                {manifest.contributes?.mainViews?.filter(view => view.scope === 'application').map(view => <label key={view.id}><input type="checkbox" checked={localStorage.getItem('tinycad.plugins.startupView') === view.id} onChange={event => { event.target.checked ? localStorage.setItem('tinycad.plugins.startupView', view.id) : localStorage.removeItem('tinycad.plugins.startupView'); pluginManager.changed(); }} />Use {view.title} as the startup page</label>)}
                {platform === 'electron' && record.grants.includes('desktop.tools') && <Button disabled={!!busy} onClick={(): void => void perform('Configuring native tool…', async () => {
                  const result = await window.electronAPI.choosePluginTool(record.id); if (result) pluginManager.notify(`Native tool configured as ${result.id}: ${result.name}`);
                })}>Configure native tool</Button>}
              </div>;
            })}
          </>}
        </div><div className="plugin-manager-details">
          {pkg ? <>
            <h2>{pkg.manifest.name}</h2><p>{pkg.manifest.description}</p>
            {inspectVersions.length > 0 && <label>Documentation version<select value={documentationVersion} disabled={!!busy} onChange={event => {
              const version = inspectVersions.find(v => identity(v) === event.target.value); if (version) void show(version, documentTab);
            }}>{inspectVersions.map(v => <option key={identity(v)} value={identity(v)}>{v.entry.version} · {v.release?.name || 'source snapshot'}</option>)}</select></label>}
            <div className="plugin-card-actions"><Button onClick={() => setDocumentTab('overview')}>Overview</Button><Button onClick={() => setDocumentTab('changelog')}>Changelog</Button><Button appearance={documentTab === 'documentation' ? 'primary' : 'secondary'} onClick={() => setDocumentTab('documentation')}>Full documentation</Button>
              {sourceLink?.startsWith('https://') && <a href={sourceLink} onClick={event => { event.preventDefault(); openExternalUrl(sourceLink); }}>Repository / release</a>}
            </div>
            <MarkdownDocumentation pkg={pkg} entry={pkg.manifest[documentTab === 'overview' ? 'readme' : documentTab]} />
          </> : <p>Select a plugin's Description, Changelog, or Full documentation to read it here. Reading documentation does not activate plugin code.</p>}
        </div></div>
      </DialogContent>
    </DialogBody></DialogSurface>
  </Dialog>;
}
