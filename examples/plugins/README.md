# Example plugins

These are standalone examples for the TinyCAD plugin API. They are not included in TinyCAD's browser or Electron distributions, and are not registered as default plugin sources.

- [Circuit Inspector](inspector/README.md): circuit summaries, connectivity reports, design/symbol notes, and sample components.
- [Project Home](project/README.md): manage open drawings with independent save state and undo history.

To try them from a source checkout, open **File → Plugins → Developer mode**, choose **Local folder**, and select this `examples/plugins` directory. Its catalog lets you choose either example. You can also select an individual plugin's subdirectory.

Alternatively, run this from the TinyCAD repository root:

```sh
npm run plugins:serve -- examples/plugins
```

Add `http://127.0.0.1:8080/` as a **Local server** in Developer mode. Install the desired plugins explicitly, then use **Reload from source** after editing them.

`npm run plugins:catalog` refreshes this directory's source catalog. `npm run plugins:package` creates optional release ZIPs/catalog in `plugin-release/`; these are not part of the application build. To publish a source repository, use this directory's catalog and plugin subdirectories at that repository's root.
