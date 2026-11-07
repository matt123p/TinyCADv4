# Writing TinyCAD plugins

TinyCAD plugins run in isolated workers and frames in the browser and Electron. Open **Plugins → Discover** to install the bundled Circuit Inspector and Project Home examples, or enter a GitHub repository URL and select plugins from its catalog.

The implementation contracts are in [`src/plugins/api.ts`](../src/plugins/api.ts), [`types.ts`](../src/plugins/types.ts), and the [manifest](../schemas/tinycad-plugin.schema.json) and [catalog](../schemas/tinycad-plugins.schema.json) schemas. See [the architecture proposal](plugin.md) for the wider design.

## Repository layout

Use one `tinycad-plugins.json` catalog per repository/release and one `tinycad-plugin.json` per plugin. A repository can contain several independently selected and versioned plugins. The working examples are in [`examples/plugins`](../examples/plugins).

Each plugin must include a short `description` and Markdown `readme`, `changelog`, and `documentation` paths. These are relative to the plugin package, not the repository root. Declare every page and image in `files`. The manager reads these before installation without running code, and shows the installed or selected version's documents. Relative Markdown links work within the package; raw HTML and executable Markdown are disabled.

## Controller and UI

Bundle the controller and UI as self-contained ES modules, with no runtime imports of npm packages or TinyCAD internals. Their entry points are:

```js
// controller.js
export function activate(api) {
  api.commands.registerHandler('org.example.my-plugin.inspect', async () => {
    const drawing = await api.documents.getSnapshot();
    await api.ui.notify(`${drawing.name}: ${drawing.sheets.length} sheets`);
  });
}
```

```js
// ui.js
export async function mount(root, api, context) {
  const heading = document.createElement('h2');
  heading.textContent = `My plugin: ${context.surface}`;
  root.append(heading);
}
```

The host passes the SDK; plugins do not need a runtime SDK import. Use `import type { PluginAPI, PluginUIContext }` from the SDK contract when building with TypeScript. Each UI surface gets its declared `surface` ID, document/symbol context, locale, and theme. Controllers and surfaces have separate JavaScript globals; share working state through host settings, document metadata, or registered commands.

UI forms should call `ui.setDirty(true)` while they contain unaccepted changes, then `ui.setDirty(false)` after saving/discarding their draft. Automatic updates defer while that plugin has a draft, and disable/uninstall or quitting prompts before discarding it. Store longer-lived drafts in plugin settings if they must survive switching away from the surface.

Declare commands, panels, tabs, views, menus, and toolbars in `contributes`. The host rejects IDs outside your plugin namespace, invalid references, and conditions outside the supported expression language. Conditions can use equality, `!`, `&&`, `||`, parentheses, and the published context keys. A command handler becomes available after controller activation; the host lazily starts controllers when needed.

Views occupy the central editor area while schematic and document tabs remain available. Left/bottom panels have explicit selectors, and the built-in bottom **Context** option retains automatic selection behavior. Library providers appear alongside the built-in left-panel choices. Menus use logical slots shared by browser and Electron; browser plugin actions are grouped in **Plugin actions** and desktop entries go into native menus.

## Document changes and permissions

Request only the permissions listed in your manifest. The installation dialog shows each plugin's permissions separately. Reading snapshots, executing core commands, editing metadata, using a network origin, and running native tools are independently checked by the host. Reading diagram data shares it with your plugin code; browser isolation is not a guarantee against every possible data-exfiltration channel.

Snapshots contain public DTOs with persistent item IDs. Use `documents.applyEdits` with the snapshot's session `id` and monotonic `revision`:

```js
const snapshot = await api.documents.getSnapshot();
await api.documents.applyEdits({
  documentId: snapshot.id,
  expectedRevision: snapshot.revision,
  label: 'Connect the new component',
  operations: [
    { type: 'insertWire', sheetId: snapshot.activeSheetId, a: [100, 100], b: [150, 100] }
  ]
});
```

Coordinates use TinyCAD's internal drawing units. Each accepted batch is one undo step. The complete batch is rejected on an invalid operation or revision conflict. Long-running tools should re-read/recompute when the diagram changes; an AI plugin can call `ui.previewEdits` to ask the user to review its operations before applying them. Activate a document before changing it. Use session IDs for API calls; persistent file/entity UUIDs are a separate identity space.

`extensionData` is automatically scoped to your plugin ID. Declare a schema for each scope used. Include an `expectedRevision` in a data target to detect stale updates. Document, sheet, symbol definition/instance, library, and library-name metadata are preserved by the host even when the plugin is unavailable. Unsupported newer schemas are read-only. Package rollback does not reverse document migrations.

Exported core commands currently include `core.file.save`, `core.file.open`, `core.file.new`, `core.edit.undo`, `core.edit.redo`, `core.view.zoomIn`, `core.view.zoomOut`, and `core.tools.bom`. Their underlying permissions are still required. Another plugin can invoke a plugin command only if its declaration has `exported: true`.

## Release distribution and updates

Run `npm run plugins:bundle` after changing the shipped examples, and `npm run plugins:package` to generate ready-to-upload ZIPs and a release catalog under `plugin-release/`. Attach the generated catalog and packages to a GitHub release. This command creates local artifacts only; it does not publish anything.

Release catalog entries identify assets in that exact release. SHA-256 digests are supplied in the generated catalog and verified against GitHub's asset digest when available. A source-packaged entry can instead reference a manifest at the release's resolved source commit. Tags/commits are a fallback for repositories without releases or an explicit developer choice. The root source catalog in this repository demonstrates that layout.

Each installed plugin has its own automatic/manual/pinned update policy, stable/prerelease channel, permissions, and retained version history. Compatible stable release updates are automatic by default; permission expansion or schema-version increases require review. Rollback pins the chosen version until the user resumes updates. Packages are cached in Electron's user-data directory or browser IndexedDB; browser `localStorage` stores the selected versions and policies.

Browser GitHub metadata requests work through its API. If an environment blocks a release-asset download because of CORS, configure `PLUGIN_DOWNLOAD_RELAY` at build time with the HTTPS URL of the supplied [download relay](../scripts/plugin-download-relay.mjs). The browser still verifies package digests. Electron downloads through a restricted main-process adapter. Do not substitute a moving branch or unrelated asset when a release is unavailable.

## Native tools and recovery

Electron users can configure an executable for a plugin with `desktop.tools` permission. The host returns a tool ID, never an executable path. `desktop.runTool` supplies stdin to that approved executable, without a shell or plugin-provided arguments, in a temporary working directory with time/output limits. This fixed adapter suits stdin-driven tools; engines needing other argument conventions need an additional host adapter. Browser capability discovery reports native tools unavailable.

Open TinyCAD with `?plugins=safe` to inspect files and plugin documentation without running third-party code. Disable/retry and uninstall are available in the manager. Uninstall preserves design/library metadata. Save open designs before browser refresh; document sessions are currently retained for the lifetime of the application window.

## Verification

- `npm run test:plugins`: archive/manifest validation, XML/SQLite round trips, atomic edits, undo, independent sessions, update/rollback, and cache integrity.
- `npm run test:plugins:browser`: real browser manager, isolation, Markdown, panel, page, and session checks against `dist/` (run `npm run build:fs` first).
- `npm run test:plugins:electron`: actual Electron disk cache/restart, native menus, isolation, and documentation checks after `npm run build:electron`. Linux CI needs a virtual display, for example `xvfb-run npm run test:plugins:electron`.
- `node scripts/package-plugins.mjs --check`: ensure bundled examples match their sources.

The included Project Home example manages open files; a portable `.tcproject` format, directory discovery, a production SPICE engine, and an AI service are separate plugins/features rather than hidden inside the runtime.
