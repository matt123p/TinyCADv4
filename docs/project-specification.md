# TinyCAD project specification

This document defines the project browser, file editing and saving, Git source control, project settings, generated files and hierarchical schematics. The browser should behave like the folder explorer in VS Code or Visual Studio. The [PCB layout specification](TinyCAD_PCB_Layout_Complete_Specification.md) defines board editing and manufacturing, and the [drawing format](drawing-format.md) and [PCB format](pcb-format.md) define the native design files.

The Electron Project workspace owns the folder browser, file tabs, project libraries, hierarchy, and Git integration. PCB Design opens `.dpn` files in the same workspace. PCB files retain their board-specific format and are saved through the project file service. For boards with an existing schematic association, PCB checks and updates read the saved project schematic.

## Single File and Project modes

**Single File** is a complete way to use TinyCAD. Start with the familiar TinyCAD v4.1.0 layout, including the drawing canvas, menus, toolbars, sheet tabs and Libraries. Open, inspect, edit and save a drawing directly. The project tree, project file-tab strip and vertical activity bar appear only in **Project** mode. Opening an ordinary file in Single File mode keeps that mode, even if the file is stored under a project folder.

In Electron and Google Drive mode, use **Settings → Open in…** as the startup preference with **Single File** and **Project** choices. Where no preference exists, start in Single File mode. With **Project** selected, reopen the most recent accessible selected root or offer **Open Project Folder…** to choose one. An explicit request to open a `.tcproject` takes precedence over the startup preference for that launch.

From Single File mode, opening a `.tcproject` or choosing **File → Open Project Folder…** switches the existing TinyCAD window to Project mode. Keep the current document and its edits available during the switch. If the project cannot use that open document, let the user resolve unsaved changes before replacing its view. If opening is cancelled or fails, keep the existing mode and document. **Close Project** returns to Single File mode after the user resolves pending project edits. These commands change the current session mode.

The filesystem-only browser build runs in Single File mode. Open a schematic or standalone PCB through the file commands. Simulation is available from a schematic's simulation sheet and chart controls. In all supported builds, let the user choose to open a `.dpn` directly in the PCB editor, edit it, and save it as a standalone file. A board with embedded connectivity opens with its existing nets and pad assignments. For a board without a schematic association, **Board connections…** creates named nets and assigns electrical pads to them. Pads mapped to the same device terminal are assigned together. Import a reviewed `.tcdevice.json` file from the same dialog to add a component for placement. The board embeds the definitions for subsequent offline editing. Where a netlist import format is supported, the user can also choose to import a netlist explicitly. Direct schematic updates and back annotation are commands for linked projects.

## Choosing the root folder

- Let the user choose a local root folder in Electron or a Drive root folder in Google Drive mode. Opening a `.tcproject` from the desktop or Electron’s **File → Open** uses its containing folder as the root and loads the settings. **File → Open Project Folder…** also accepts folders that have no settings file. Keep the current drawing and any unsaved edits when the project tree changes.
- Show the selected folder as the top of the tree. When a selected folder has no `.tcproject`, let users browse its files and create project settings when needed. Use one root settings file per project and report ambiguity if a folder contains multiple candidates.
- Provide **Recent Projects** beside **Open Project Folder…** in Electron and in the Drive folder picker. Open the selected root through the same project workflow as a newly chosen folder. Retain up to ten roots per device or signed-in Drive account, newest first.
- Share the left-hand Projects panel across Circuit Design, Circuit Design + Simulation and PCB Design. Let users show Projects and Libraries independently or together.
- Provide Project mode in Electron and Google Drive mode. The filesystem-only browser build opens individual design files in Single File mode.

## Sidebar activity bar

In Project mode, use a vertical icon column for **Projects**, **Libraries** and **Source Control**. Select one activity panel at a time. When the active design is a PCB, **Libraries** shows its footprint library and unplaced components in the shared sidebar. The Source Control icon opens the Git panel and shows the pending change count for the selected repository when Git is available. Use **File → Open Project Folder…** to choose a root and the close button beside the root name to close it.

Give each button a tooltip, an accessible name, a keyboard focus indicator and a visible active state. Use the VS Code Activity Bar beside the sidebar as the interaction reference. [VS Code custom layout](https://code.visualstudio.com/docs/configure/custom-layout)

## Project tree and file operations

Show files and folders recursively under the fixed root. Expand and collapse each folder in place, with indentation showing nesting. Use left-aligned names, file-type icons and a neutral selection highlight. Put file and folder actions in context menus accessible by right-click or Shift+F10. Let users create folders and files at the root or in any writable subfolder. Support renaming, moving and deleting files and folders. Use the platform or storage provider's trash when available.

Show ordinary files whether or not they have a tracked association in `.tcproject`. Apply the same rename, move and delete operations to native and supporting files.

On the desktop, refresh the project tree automatically when files are added, renamed or removed in the displayed folders. List collapsed folders when they are expanded. Keep open editors and their unsaved changes intact. The project folder actions menu also offers **Refresh** for filesystems without working change notifications and for Google Drive.

Renaming or moving a registered file within the project updates its location in `.tcproject` and any affected hierarchy locators. Moving a folder also updates its configured output recipe directories. The document and board identities stay the same. Close affected editor tabs before moving linked files. If the move is interrupted, TinyCAD checks the saved state on reopen and restores the previous file locations and hierarchy links when the settings update did not commit.

Before moving a linked file or folder to trash, review the project entries, schematic and PCB associations, and recipes that will be removed. Close affected editor tabs first. TinyCAD clears a primary document setting only when that document is removed. Surviving drawings and boards keep their saved contents. Resolve any missing child links in the hierarchy editor. Recipes with surviving sources can regenerate their output files. If trash fails and the item remains, reopening the project can restore its registration.

| File type | Project browser behaviour |
|---|---|
| Supported native TinyCAD files, including `.dsn`, `.dzn` and `.dpn` | Create and open in the appropriate TinyCAD editor. |
| Plain text, Markdown and CSV | Create, open and edit. Generated BOMs saved as CSV can also be opened and edited. |
| PDF datasheets and images | Add existing files or save generated files into the tree, then open them in read-only viewers. |

### Drag and drop into the project

Drop files from the operating system onto a folder row or the project root. Highlight the destination during the drag. Copy the files into that destination on desktop and upload them there in Google Drive mode. Accept multiple files and, when the platform supplies a folder tree, preserve its nested paths. Imported files become visible in the tree and can be opened through the normal file actions. Keep **Add files…** available for keyboard use and platforms that lack drag-and-drop support. [VS Code Explorer file operations](https://code.visualstudio.com/docs/editing/getting-started/userinterface)

If a destination already contains the same name, offer **Keep both**, **Replace** or **Skip** before writing that file. **Keep both** adds a numbered suffix. **Replace** checks the saved version before writing. Linked project files offer **Keep both** and **Skip** to preserve their registered design identities. A dropped folder can add files inside an existing folder with the same name. Show progress by path and list failures by filename so users can retry them. Opening imported files and registering design links remain explicit actions.

## File tabs and Save All

Use the [shared TinyCAD editor design](tinycad-ui-design.md#shared-editor-contract) for the menu, toolbar, panels and drawing controls that surround project tabs.

In Project mode, open each supported file in a tab labelled with its filename. Reopen an existing tab when the same file is selected again. Keep file tabs distinct from navigation within a file, such as schematic sheet tabs. Switching tabs retains edits and undo history. Show which files have unsaved edits. Each tab has a close icon, and Delete closes the focused tab after any unsaved changes are resolved. Put the icon-only Save All command beside Save in the editor toolbar. Provide Download as a separate context-menu action for unsupported file types.

Remember each project's open saved files, tab order, and active tab in local editor preferences. Reopening the folder restores those tabs, including an empty tab strip when all files were closed. Skip files that are unavailable. Saving and recovery continue through the existing document workflows.

The Electron app and browser use the same project tab history limits. Keep up to 50 sessions within a combined 256 KiB budget in Chromium local storage. Prune the least recently used sessions first, and reclaim additional session space if storage is full. Other editor preferences keep their own storage entries.

In Electron and Drive, **New file…** creates a text document in the selected folder. Notes, Markdown and CSV open in editable tabs. Markdown offers a local preview. Images and paginated PDFs open as read-only tabs. An edited tab shows an asterisk until saved. Linked schematics and linked or unlinked PCB files open in separate tabs with folder-relative labels. Switching tabs retains pending edits and undo history for each drawing and board. Save All includes inactive schematic and PCB tabs.

**Save** writes the active file to its existing path. **Save All** writes each modified editable file across the open tabs, including settings when modified. If a file cannot be saved, identify it and keep its pending edits. Report which files were saved and which still need attention. Protect each file against overwriting a newer saved version.

With a schematic sheet and a PCB from the same project folder open, choose **Side by side** beside the file tabs. Click into a pane or Tab to one of its controls to give that file focus for shared commands such as Save and Undo. Cross-probing can select a schematic terminal or highlight a PCB net while both drawings are visible. Choose **Side by side** again to return to the active file. On narrow windows the editors stack vertically.

## Git source control

Use VS Code's **Source Control** workflow as the reference for reviewing saved changes, staging, committing and synchronising. Electron uses the installed Git client and the project's existing working tree and index. Detect a repository at the selected root or in an ancestor and identify the repository root and active branch clearly. Offer **Initialize Repository** for an ordinary local folder and **Clone Repository** into a user-selected local parent folder. Show an actionable message when Git is unavailable. The initial Git integration applies to local repositories in Electron. Google Drive projects retain their project revision workflow. [VS Code source control overview](https://code.visualstudio.com/docs/sourcecontrol/overview)

| Area | Required behaviour |
|---|---|
| Changes | List untracked, modified, removed, renamed and conflicted files. Group staged and unstaged changes separately and show both entries for a partially staged file. Reflect changes made by command-line Git on refresh. If the project is inside a larger repository, show which files are outside the project and keep bulk actions scoped to the project. Before committing, show the complete staged set that Git will commit. |
| Review and staging | Open a diff tab from a changed file. Compare the working copy with its staged version and the staged version with the last commit. Support stage and unstage per file or in bulk. Support partial staging in ordinary text, Markdown and CSV diffs. Treat native TinyCAD design files and binary assets as whole files for staging. Show a text diff where the format permits it and identify files that need a whole-file comparison. |
| Commit and history | Enter a commit message and commit the staged changes locally. Show unsaved tab edits separately from on-disk Git changes and offer **Save All** before review. Show commit history, branch relationships and a file's history, and allow inspection of a selected revision. |
| Branches and remotes | Create and switch branches. Show the upstream branch and incoming and outgoing commits. Provide **Fetch**, **Pull**, **Push** and **Sync Changes**. Pull uses a fast-forward update. Sync pulls and then pushes only when the pull succeeds. Push targets the active branch’s configured upstream. Use the user’s configured Git authentication. |
| Conflicts and open files | List conflicts and offer a three-way merge view for editable text. For native design files and binary assets, let users compare or choose complete versions and reopen the result through the normal editor. Before a Git operation reloads a dirty file, offer to save or retain its pending edits. Refresh affected tabs and project links after a branch switch or pull. |

Open the Electron **Source Control** panel to refresh Git status, review a diff in a tab, stage changes or inspect commit history. Review the complete staged set before committing, including files outside the selected project folder. TinyCAD invokes Git with repository hooks and external diff drivers disabled. Branch switching and pull reload clean linked schematics and boards. Retained edits stay open against their original saved version, so subsequent saves still check for changes on disk. Open **Git file history** from a file’s actions menu. **Resolve…** compares the base, current and incoming versions. Edit and stage a text result, or choose a complete version for a native design or binary asset. When a side deleted the file, choosing that side stages the deletion. TinyCAD checks the index and working file against the preview before writing.

Use the normal Git index and commit history. Project **Save As** and revision comparison continue to work for folders without Git. Use Git **Clone** or a branch when the user wants another checkout with repository history. [VS Code staging and commits](https://code.visualstudio.com/docs/sourcecontrol/staging-commits) · [VS Code history](https://code.visualstudio.com/docs/sourcecontrol/history) · [VS Code repositories and remotes](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes)

## Project folder and settings file

A TinyCAD project is a root folder and its entire subtree. A versioned UTF-8 XML `<name>.tcproject` file at the root identifies the folder as a project and holds shared settings and document associations, similar to a Visual Studio `.csproj`. Keep design documents and generated files as ordinary files in the tree. The layout below is an example. Users can organise and name subfolders to suit the design.

```text
Sensor Board/
  Sensor Board.tcproject
  Circuit.dsn
  Board.dpn
  assets/
    Connector-datasheet.pdf
  README.md
  outputs/
    BOM.csv
    Circuit.net
    Circuit.snapshot.json
  releases/
```

Open **Project Settings…** at the project root to edit the project name, author, primary schematic and primary PCB. Save the settings tab directly or include it in **Save All**. These edits use the existing `.tcproject` filename and preserve document links, associations and output recipes. The settings file also records the project UUID, schema version, required features, revision lineage, primary documents and schematic-to-board associations. It stores project-wide design settings, library and asset settings, and output recipes or root-relative references to shared settings files. Use stable document identities for links and root-relative paths to locate the files. A folder can contain supporting files and subfolders without listing each one in `.tcproject`. Copy or move the whole tree to another location to carry the project with it.

The version 1 codec uses a `TinyCADProject` XML root with one `SETTINGS` element for identity, metadata, lineage and primary documents. `FILE` elements link document IDs to folder-relative paths. `ASSOCIATION` elements link schematic and PCB IDs. TinyCAD validates that referenced paths resolve within the project tree and reports missing files, ambiguous names and unsupported required features. [Project settings codec](../src/pcb/projectSettings.ts)

## Board sources and multi-board projects

Each linked PCB has one **source schematic root**, stored by document UUID alongside the board UUID in a `.tcproject` `ASSOCIATION`. The root supplies the board's circuit, including its sheets and reachable circuit child instances. A board's own source record identifies the circuit revision and connectivity digest it last applied. The project reader checks the association against that record when both exist. Primary documents are project defaults for opening files. A rename updates the file path while the association continues to use the same IDs. [Project settings codec](../src/pcb/projectSettings.ts) · [Project board reader](../src/io/projects.ts)

### One PCB per board folder

Treat each **board folder** as a sub-project within the project tree. It contains one active `.dpn` and as many schematics and supporting subfolders as needed. Keep the board's source root alongside the PCB by default. Alternative layouts can explicitly share a source. A single-board project can use the project root as its board folder. In a multi-board project, put each physical board in its own folder beneath a single root `.tcproject`. Register board folders and their source associations in the root settings. A folder acts as a board sub-project through that registration and shares the root project's settings.

```text
Sensor system/
  Sensor system.tcproject
  System.dsn                  # Optional system schematic
  Main/
    Main.dpn
    Main.dsn                  # Main-board source root
    Power.dsn
    outputs/
  Sensor/
    Sensor.dpn
    Sensor.dsn                # Daughterboard source root
    Analogue.dsn
    outputs/
```

**Create PCB from Schematic…** starts with the active schematic as the source and records the pairing on Apply. Offer the source folder for a new board and let the user choose another board folder if the source folder already contains an active board. Show the source path on the board and in its update preview. If several board folders share an explicitly associated source, ask which board to update and compile for the chosen target. Write each board's netlist and BOM to that board folder's configured output directory.

### Optional system schematic

Place a hierarchical schematic at the project root to show how the boards connect. Use the hierarchy editor to place each board's source schematic as a **board instance**. Bind that placement to the registered board UUID so it resolves to the intended layout when several boards share a source. Use ordinary child placements inside a board folder to expand circuitry into that board. Use board instances in the system schematic to expose the linked board's interface at the system level.

Expose named ports mapped to the actual connector pins on each board. Wires between board instances express direct mating or cable connections through those ports. System connectivity follows the explicit pin mappings. **Create PCB from Schematic…** and **Update PCB from Schematic…** compile a selected board's source root. The system schematic provides a separate view for reviewing inter-board connections.

Draw the named ports on each board source's hierarchy interface sheet and assign reviewed devices to the connectors on the PCB. Open the root system schematic and choose **Place board instance** from each PCB's project-tree actions. Select a placed instance and use **Map board ports…** to choose the connector and physical pad for each named port. Draw the system wires and choose **Review system connections…** to inspect each wiring net, board path, connector pad and board-local net. The review uses the current system drawing and the saved PCB definitions. It flags unmapped ports and stale interfaces.

The system schematic stores the board UUID on each instance. Its port mappings store the interface pin UUID, the PCB's schematic component UUID and the component signal UUID. The same schematic can supply the interface of multiple layouts and each instance keeps its own mappings. **Reload board interface** reviews changes to wired ports and retains mappings for surviving port identities when the source remains the same.

| Design arrangement | Connection model |
|---|---|
| One PCB drawn on several sheets | One schematic root compiles the full hierarchy into one board circuit. Sheet boundaries organise the drawing. |
| Alternative layouts of one circuit (PRJ-07) | Give each layout its own board folder. Explicitly associate the layouts with a shared source root when they implement the same circuit. Each board has its own physical design and last applied snapshot. |
| Motherboard plus a daughterboard | Give each physical PCB its own board folder and source root. Connect their mating connector ports in the optional root system schematic. |
| Assembly variants (PRJ-08) | Keep one physical board design and record which parts are fitted or substituted for each build option. |

### How professional tools organise multiple boards

- **KiCad** allows multiple schematic sheets in a project and one board per project. A motherboard and daughterboard can therefore be organised as separate KiCad projects. [KiCad project model](https://docs.kicad.org/10.0/en/kicad/kicad.html)
- **Altium Designer** has a separate Multi-board project. Its system schematic links modules to child PCB designs, imports the pins and nets of designated connectors, and connects the modules directly or through cables or harnesses. The assembly view brings the boards together mechanically. [Altium logical system design](https://www.altium.com/documentation/altium-designer/multi-board-design/logical-system) · [Altium multi-board design](https://www.altium.com/documentation/altium-designer/multi-board-design)
- **Siemens Xpedition** supports a top-down workflow. The designer partitions a system into functional blocks, defines the board and cable interfaces, and passes those blocks and connectors to the individual board designs. [Siemens multi-board system design](https://www.siemens.com/en-us/products/pcb/model-based-systems-engineering/multiboard-design/)

A top-down partitioner for an existing monolithic schematic is a separate future capability. The board-folder workflow establishes the boundaries when the design is authored by selecting a source root for each board and defining the connector ports exposed at the system level.

## Document lifecycle and recovery

**Save As** for a project copies the entire folder tree. Give the copy a distinct revision identity and record its source revision while retaining document identities and internal links. Compare revisions using their saved project settings and file contents, and report differences by relative path. Saving a schematic updates its linked native file and preserves its `.dsn` or `.dzn` representation. Saving project settings updates `.tcproject`.

For linked schematic edits, debounce autosave within two seconds of committed edits for M1. The last acknowledged autosave must be recoverable. Check for changes to the saved schematic before restoring an autosave.

- Write project saves atomically where the platform permits. Keep the last valid save and a bounded recovery journal.
- Use browser persistence for recovery alongside explicit portable file saves. Show failures and storage-quota exhaustion.
- Detect another writable tab or process for the same local document. Protect it with a single-writer lease or an explicit conflict or fork workflow.
- Show which committed schematic state was saved.

Standalone and linked PCB edits stay in memory until an explicit Save, Save As or Save All. Reopening loads the saved board. The title-bar asterisk indicates edits waiting to be saved, and explicit writes still check for intervening file changes. The autosave requirements above apply to schematic recovery.

Authoritative data comprises circuit intent, physical objects, resolved library definitions, constraints and output configuration. Meshes, spatial indexes, filled-zone polygons and DRC reports are caches unless part of a frozen release record. Rebuild them when their dependency hash changes.

Persist document state separately from personal view state. Switching colour theme or panel position shall not modify manufacturing content. Dirty status must distinguish unsaved work, out-of-sync schematic, stale fill and stale checks.

## Generated project files

In project mode, run BOM, netlist and other generators into suitable subfolders of the project. Use `outputs/` as the default location for intermediate files and let users configure destinations in the project settings. Store output recipes with destination, filename, layer mapping and precision as applicable. Newly written outputs appear in the project tree.

Open **Project outputs** from the project root to configure or run a recipe. **Configure PCB outputs…** in a PCB's project-tree actions preselects that board for new recipes. A schematic BOM or netlist recipe can name a saved schematic directly, or name a registered PCB and follow its current source association. Both use the saved schematic and expand its linked child sheets. A board-scoped circuit recipe defaults to `outputs/` under that board's folder.

PCB recipes read the saved board and default to `outputs/pcb/` under its folder. Available outputs include the full and fitted board BOMs, placement and assembly CSVs, Gerber copper, mask, paste, legend and outline, XNC drills, and SVG assembly drawings. Use a PCB BOM to report the parts in that saved layout. Choose the board side for layered artwork and assembly drawings. Placement and assembly CSVs support full precision or a fixed number of decimal places for coordinates and rotation. Each recipe has its own configurable output folder and filename.

PCB CSV recipes default to **Spreadsheet text**, which prefixes formula-like text fields with an apostrophe. Choose **Raw text for machine import** to preserve the original field strings for a downstream importer. Coordinate and rotation columns stay numeric in both modes.

TinyCAD writes a companion manifest with hashes of the recipe, source files and output. Regeneration checks ownership and preserves hand-edited or unmanaged files.

Keep generated files as ordinary files that can be regenerated from the editable design. Use the recipe and source revision to track freshness. Frozen manufacturing releases have their own output and provenance records.

| ID | Requirement | Acceptance condition | Release |
|---|---|---|---|
| OUT-07 | Store output recipes, destinations, filenames, layer mapping and precision in project settings | Running a saved recipe writes ordinary files such as BOMs and netlists to the configured project subfolder and reproduces equivalent output and manifest hashes | M1 |

## Hierarchical project schematics

### TinyCAD v3 behavior

In v3, the child drawing has a special symbol sheet with artwork and named pins. The parent places that saved drawing as a symbol, with a reference designator, a transform and wire connections. A parent pin connects to matching labels in the child by name. Each drawing can have several normal circuit sheets, and a child can contain further child placements. The parent can open the child drawing or reload its symbol after an edit. [TinyCAD v3 manual](https://docs.tinycad.net/v3/Using-multiple-sheet-schematics/#using-hierarchical-designs) · [C++ symbol editor and XML codec](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/DrawHierarchicalSymbol.cpp)

The child stores its interface in a `HierarchicalSymbol` sheet under `TinyCADSheets`. The parent stores a `HIERARCHICAL_SYMBOL` placement with a `file` attribute, position, rotation, scaling and `FIELD` records. v3 writes the child path relative to the containing drawing when possible and falls back to the original path. Its readers accept the historical spellings `HierachicalSymbol` and `HIERACHICAL_SYMBOL`. [C++ symbol XML codec](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/DrawHierarchicalSymbol.cpp#L59-L66) · [C++ path handling](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/TinyCadDoc.cpp#L1868-L1904)

The C++ netlister gives each placement its own instance index, expands all sheets in that instance, and links the parent pin's hotspot to the child instance's label of the same name. Same-name labels can join across sheets within an instance. Two placements of the same child keep their internal nets separate. Legacy flattened references include the designator path, for example `H2_H1_R1`. The FAQ records failures involving missing instance references and duplicate port pin numbers, even though users wire ports by name. [C++ traversal and port binding](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/NetList.cpp#L1026-L1068) · [C++ instance-scoped labels](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/Net.h#L104-L135) · [TinyCAD v3 FAQ](https://docs.tinycad.net/v3/FAQ/)

### M1 implementation contract

1. **Authoring and navigation.** Open a project from its root `.tcproject`, select a root schematic, edit a child's interface sheet, and place that child from the project tree. Support wiring, rotation, repeated placements, and navigation from a placement to its child and back through the instance path. Show where a child is used and report port changes that affect connected placements. The interface sheet supplies artwork and ports. Compile electrical circuitry from the normal sheets.
2. **Native persistence and migration.** Keep parents and children as ordinary `.dsn` or `.dzn` files. Preserve the legacy sheet and placement tags on import, accept both historical spellings and write the corrected spellings. Store the reference and transform, child document identity and a project-relative locator for new links, and stable placement and port IDs. Resolve legacy relative paths against the containing schematic first. Resolve or copy legacy absolute and out-of-project targets explicitly during migration, then record the project-relative link. Report missing or ambiguous children and preserve unresolved placements for repair. Verify that a copied project tree opens with its links intact.
3. **Connectivity and identity.** Build the circuit from the selected root and expand each reachable child placement along its full instance path. Reuse the sheet-local connectivity builder and bind parent hotspots to the matching labels across the child's normal sheets. Use names for legacy port matching and retain the resulting stable binding for edits. Qualify power and hidden-pin scope against legacy fixtures and define deliberate global connections explicitly. Scope ordinary labels to their instance. Give physical units and terminals stable identities based on the placement UUID path and native unit/pin IDs. Use readable designator paths for display and export, and diagnose missing or conflicting references and ambiguous port definitions. Detect cycles by tracking the active document chain, so repeated use in different branches remains valid.
4. **Shared consumers and diagnostics.** Feed the expanded graph into ERC, project netlist/BOM generation and PCB synchronisation. Carry instance, document, sheet and pin provenance through to PCB cross-probing and ECO previews. Hierarchy placements provide connectivity through ports. Physical component rows come from the instantiated circuit sheets. Block PCB compilation and netlist generation on unresolved children, cycles or ambiguous port bindings and locate the affected placement or port.

### Editing project hierarchy

Use **New schematic…** or **Import schematic…** in Projects to add a child drawing. Existing project files can be registered with **Add to project**. Open the child and choose **Add hierarchical symbol**, then use the drawing tools and the **Pin** tool to create its interface. Give each port a unique name in the pin panel. Use the same names on labels in the child's normal circuit sheets.

Open the parent and choose **Place as child symbol** from the child file's project menu. Place and wire the symbol with the usual editing tools. Each placement has its own designator and UUID. The document saves the child's project-relative path, UUID and a copy of its interface artwork with its port identities.

Select a placement to open its child, inspect its locator or reload the interface. The hierarchy bar shows the instance path and **Back to parent** returns to the selected placement. **Where used** lists placements in the registered project drawings. Reloading asks for review when a connected port name or hotspot changes. Existing wires retain their coordinates.

Legacy relative locators resolve from the containing schematic and stay within the project. If a target exists in the project tree, **Add child to project and open** registers it explicitly. For an absolute or missing locator, import a copy of the child into the project, then choose **Relink child** on the parent placement. Unresolved placements retain their original locator and any embedded artwork until repaired. Project copying retains document and placement UUIDs along with relative links.

### Compiling and cross-probing

ERC, the live Netlist list, netlist exports and the BOM use the expanded project graph. Register each child in Projects before compilation so that its document, sheet and unit UUIDs are saved. Labels, power symbols and hidden power pins share a name within one instance. Connect separate instances through their declared ports.

The PCB snapshot uses the placement UUID path and the original unit and pin UUIDs. A copied project and a renamed designator keep the existing component, signal and net identities when terminal membership stays the same. In Projects, open the linked board's action menu and choose **Cross-probe schematic…**. A mapped pad opens the original pin in the correct instance. **Review connectivity** compares the current schematic with the board's recorded circuit revision and reports retained nets, proposed nets and previous nets to review. See [PCB component intent](pcb-format.md#authoring-pcb-component-intent) for multipart bindings and physical roles.

Select a schematic component and choose **Find in PCB…** to see the matched board paths and pad mappings. A component viewed through a hierarchy can match both an ancestor's board and a board rooted at the active drawing. **Show net on board** highlights the selected pad's applied net. In PCB layout, select **Board net** or click a track or via to highlight its net and list the schematic terminals. Select a terminal to open its source pin. Each board uses its own applied circuit and instance paths.

The [legacy fixture](../scripts/tests/fixtures/pcb-hierarchy/src/Circuit.dsn) places a two-sheet child twice, with a nested grandchild, named ports, repeated internal labels, a power symbol and a hidden power pin. The [TinyCAD 3.00.04 XML export](../scripts/tests/fixtures/pcb-hierarchy/v3-netlist.xml) and the explicit expected graph both agree with v4 on 14 physical components and six nets. The regression test normalizes the direction of flattened v3 reference paths and compares each terminal by reference and pin number. To regenerate the reference, open the fixture's `src/Circuit.dsn` in v3 and select **Special → Create PCB Net List → XML**. The checked-in reference uses paths relative to the fixture root.

| ID | Requirement | Acceptance condition | Release |
|---|---|---|---|
| SYN-11 | Author, open and migrate hierarchical project schematics with named child ports, repeated placements and nested instances | Repeated instances keep local nets distinct. ERC, BOM/netlist, PCB cross-probing and ECO use the same instance-aware graph, including after a project copy | M1 |

## Schematic and PCB synchronisation

### Terminology and industry practice

- **Annotation** assigns reference designators. **Re-annotation** changes existing assignments. Common prefixes include `C` for capacitors, `R` for resistors and `U` for integrated circuits. For a multipart device, `U3A` and `U3B` identify schematic units of the same physical component, `U3`. TinyCAD uses **Reference designator** in the UI and retains `Ref` as the native schematic field. [KiCad reference designators and symbol annotation](https://docs.kicad.org/10.0/en/eeschema/eeschema.html#reference-designators-and-symbol-annotation)
- **Forward annotation** updates the PCB from the schematic. **Back annotation** updates the schematic from the PCB. KiCad gives each direction an explicit update command and previews the changes. It normally pairs components by UUID. Its **Geographical Reannotation** command renumbers footprints by their position. [KiCad forward and back annotation](https://docs.kicad.org/10.0/en/eeschema/eeschema.html#schematic-to-pcb) · [KiCad PCB re-annotation](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html#geographical-re-annotation)
- Altium Designer compares the two documents using component UIDs and applies a reviewed **engineering change order (ECO)**. It also supports **Positional Re-Annotation** and can retain separate logical and physical designators for repeated designs. Cadence documents bidirectional schematic/board integration and back annotation through ECOs in OrCAD Capture and PCB Editor. [Altium synchronisation](https://www.altium.com/documentation/altium-designer/sch-pcb/keeping-synchronized) · [Altium positional annotation](https://www.altium.com/documentation/altium-designer/pcb/positional-annotation) · [Altium repeated design annotation](https://www.altium.com/documentation/altium-designer/device-sheets) · [Cadence OrCAD Capture CIS](https://www.cadence.com/content/dam/cadence-www/global/en_US/documents/tools/pcb-design-analysis/orcad-capture-cis-tb.pdf)

### How other tools transfer connectivity

| Tool | First transfer and later updates |
|---|---|
| KiCad | In either editor, run **Update PCB from Schematic**, review the changes, then click **Update PCB**. This directly transfers footprints and nets for both initial setup and later edits. Exporting a netlist from the schematic and importing it into the board was the older workflow. [KiCad forward annotation](https://docs.kicad.org/10.0/en/eeschema/eeschema.html#update-pcb-from-schematic) |
| Altium Designer | Dynamic compilation maintains the internal connectivity model as the schematic changes. The designer explicitly requests an update between the editors, reviews and validates the ECO, then executes it. The transfer uses the internal model directly. [Altium dynamic compilation](https://www.altium.com/documentation/altium-designer/schematic/creating-circuit-connectivity) · [Altium design synchronisation](https://www.altium.com/documentation/altium-designer/sch-pcb/keeping-synchronized) |
| Autodesk Fusion Electronics | **Switch to PCB Document** opens and populates the board with footprints and airwires. The linked Electronics Design keeps the schematic and board in sync and offers a synchroniser when it detects a mismatch. [Autodesk Fusion Electronics workflow](https://www.autodesk.com/products/fusion-360/blog/fusion-electronics-getting-started/) |

### Creating and updating a linked PCB

TinyCAD automatically compiles connectivity for the selected schematic when the designer requests a PCB transfer. The designer reviews and applies the result explicitly. Linked projects transfer the compiled circuit snapshot directly to the board editor. **Export Netlist…** remains a separate operation for interchange and project output recipes.

1. **Create a board.** From the active project schematic, choose **Create PCB from Schematic…**. Use that schematic as the root, choose a project path for the new `.dpn`, and open the first-transfer preview. The preview lists components, reviewed footprint and pad mappings, and intended nets. Locate blocking issues such as unresolved devices, invalid pin maps or missing child designs in the source. **Apply** creates the linked board, records the source snapshot and opens PCB Design with the imported components ready for placement. Show airwires as their endpoints become available. Follow the [board source rules](#board-sources-and-multi-board-projects) for projects with more than one board.
2. **Open or switch to an existing board.** Open its last applied revision and show whether the linked schematic is current, has pending changes or is unavailable. TinyCAD can refresh this status in the background after schematic edits or saves. Opening a file, switching workspaces, saving and autosaving operate on the board's last applied connectivity. A standalone `.dpn` remains editable from its embedded data.
3. **Update an existing board.** Choose **Update PCB from Schematic…** from either editor. Compile the current linked root and child revisions, including open in-memory edits, against the board's last applied circuit snapshot. Preview additions, removals, device or pad-map changes, net splits and merges, and affected copper. Use the same preview and apply controls for first transfer and later updates. Bind approval to the exact source revisions and board revision reviewed, then apply the ECO atomically. If either side changes while the preview is open, refresh the proposal and ask for review again.
4. **Record the applied state.** Record the source document identity, revision and connectivity digest for the applied transfer. Place newly added components in the unplaced list and flag copper that needs review under the PCB ECO rules. An identical repeat update reports that the board is current. The PCB can reopen offline using its applied connectivity and embedded definitions.

The Project Browser provides **Create PCB from Schematic…** on registered schematics and **Update PCB from Schematic…** on linked boards. The create preview defaults to the source folder and accepts a project-relative destination. A new board starts with two copper layers, a 100 × 80 mm outline and unplaced components. Review missing or changed device bindings in the preview. For a removed component that was placed on the board, the preview can retain it explicitly as PCB-only mechanical geometry. Apply commits the board with its embedded circuit snapshot and opens the PCB layout. Select an unplaced component, choose its position, rotation and side, then place it on the board. Board rows show whether the schematic is in sync, has pending changes or is unavailable. They also identify PCB reference edits awaiting back annotation. An existing board also checks the reviewed schematic revisions and its stored board version before writing. **Undo last circuit update…** on the updated board restores its previous board and applied circuit in a new revision if the saved board still matches the completed update.

### Reference and value annotation

1. Provide **Update PCB from Schematic…** and **Update Schematic from PCB…** in linked projects. Use the selected schematic and board association. Show the source and target documents, the old and proposed values, and the exact affected instances or units before applying an ECO. Cross-probing opens the corresponding object for inspection.
2. Match by persisted component identity and schematic instance provenance. A user editing the component reference in PCB Design can back-annotate `C7 → C12` into the schematic. Update the existing component in place and preserve its UUID, footprint and pad IDs, placement, locks, routes and terminal membership. A change to independent silkscreen text is a board-only edit.
3. Apply a reference change to every schematic unit of a multipart component while preserving its unit suffixes. In a repeated child, persist an instance-specific designator keyed by the stable instance path and component identity. Show the effective reference in the instantiated schematic and use it for ERC, BOMs and netlists. Other placements retain their own references. Keep distinct physical references unique within the linked design, using the same case-insensitive comparison as schematic reference checking. Preserve authored prefixes when assigning numbers automatically.
4. Compare both sides with the last synchronised values and validate the complete proposed reference set. If both sides changed a field differently, display the two edits and let the user resolve the conflict. A missing or ambiguous link requires explicit repair. Reject duplicate references in the final set and allow a valid exchange such as `C7 ↔ C12` to apply as one change. Guard the ECO with the expected revisions of the board and affected schematic documents. Cancel leaves the files as they were before the proposal. Apply and undo update the affected documents and synchronisation state as one operation.
5. Recompile after applying the ECO. A subsequent update in either direction should produce no further reference changes. Mark older generated files stale and use effective references when regenerating BOMs and netlists. Preserve frozen release records. The schematic owns intended connectivity, and the PCB owns placement and copper. Additional reverse changes require explicit support for each field or operation.

In the Project Browser, choose **Edit PCB references…** on a linked board to save a set of PCB designators. **Update Schematic from PCB…** previews the change against the last applied circuit. Resolve conflicts in the preview, or select a listed unit to locate it in the schematic. A nested instance reference is stored on the root schematic and displayed when that instance is opened. **Find in PCB…** on a selected schematic unit locates its mapped pads in the linked board's layout. Select a mapped pad in the layout's schematic connections to return to its source instance.

**Undo last back annotation…** restores the previous schematic and the PCB's applied circuit and references. TinyCAD guards both saved versions and records a recovery journal in the local app profile before writing. Opening the project again completes recovery from an interrupted update when the two files match the journal.

| ID | Requirement | Acceptance condition | Release |
|---|---|---|---|
| SYN-09 | Forward- and back-annotate reference designators through reviewed ECOs | AT-31 and AT-32 pass without changing placement, copper or electrical identity | M1 |
| SYN-12 | Back-annotate reviewed component value edits | Preview and apply a value edit to the linked component and its schematic units. Conflicts require review and placement and copper remain unchanged | M2 |

Positional re-annotation is a follow-up to manual PCB reference edits. It should preview the proposed numbering order and respect locked designators. Pin and gate exchanges follow the separate [equivalence rules](TinyCAD_PCB_Layout_Complete_Specification.md#81-connectivity-contract) (SYN-10).


### Reviewed PCB devices

From the linked board's file actions, open **Review PCB devices**. The board needs an applied circuit snapshot with schematic sources. TinyCAD reads reviewed `.tcdevice.json` definitions in the project root and in the folder containing the selected board. Add a definition to that folder using the file picker, or export the selected version as a reusable library file.

Select the schematic component and choose a device. A legacy `Package` value suggests candidates. Use the name, reviewer, body dimensions, nominal pitch, pad count and mount filters to narrow the choices. The catalogue accepts definitions that include review provenance. TinyCAD flags conflicting definitions with the same device UUID and revision.

Assign each device terminal to a schematic signal. Inspect the highlighted footprint pad and source pin, and switch between source units for a shared signal. Preview the proposed pad, drill, assignment, artwork and model changes before applying. A confirmed review updates the board only if its stored revision still matches the preview. Each component can have its own reviewed binding, and the shared library file stays intact. See the [device file contract](pcb-format.md#reviewed-device-definitions).

## Project requirements

| ID | Requirement | Acceptance condition | Release |
|---|---|---|---|
| PRJ-01 | Use a project folder tree with a root `.tcproject` settings file, native schematic and board files, resolved assets, rules and output recipes | Copy the folder tree to a clean machine and regenerate a supported board and its outputs without fetching libraries | M1 |
| PRJ-02 | Persist stable entity UUIDs independently of names and list order | Rename/reorder and reload without losing any relationship | G0 |
| PRJ-03 | Use atomic, undoable commands for geometry and logical edits | Undo restores geometry, mappings and connectivity hashes | G0 |
| PRJ-04 | Autosave linked schematic edits with crash recovery | Forced process termination recovers to the last acknowledged schematic autosave | M1 |
| PRJ-05 | Version the XML settings file and declare required features | A copied folder opens with its document links intact. Missing links and unsupported required features are reported | M1 |
| PRJ-06 | Save As copies the project folder tree and records revision lineage. Compare revisions using settings and project files | Copy has a distinct revision identity and traceable origin. Changes are reported by relative file path | M1 |
| PRJ-07 | Allow multiple alternative boards for one circuit revision | Each board retains independent layout/rules and visible sync status | M2 |
| PRJ-08 | Offer assembly variants separately from board alternatives | BOM, placement and assembly drawings consistently apply the selected variant | M3 |
| PRJ-09 | Provide the shared project browser described above across Circuit Design, Circuit Design + Simulation and PCB Design | Choose a root or open a settings file, expand nested folders in place, perform file operations, and verify independent Projects and Libraries visibility. Verify availability in Electron and Google Drive mode and omission in filesystem-only mode | M1 |

## Project acceptance cases

| Test ID | Scenario | Pass criterion | Main requirement groups |
|---|---|---|---|
| AT-21 | Force a crash after an acknowledged linked schematic autosave | Recovery restores that committed revision and identifies unsaved later work | PRJ |
| AT-29 | Copy a project folder with a `.tcproject`, nested schematic and board files, and generated outputs | Open at the new location via the settings file, resolve document links and regenerate BOM, netlist and PCB files in the configured subfolders. Saving a schematic updates its native file. The copied tree retains supporting files | PRJ-01, PRJ-06, PRJ-09, OUT-07 |
| AT-30 | Open a v3 hierarchy with a repeated multi-sheet child and a nested grandchild, then copy the project and rename an instance | Named ports and instance-local nets match the expected graph and v3 output. The project reopens after the copy. The rename preserves PCB IDs and cross-probes target the correct instance. Missing children, cycles and ambiguous bindings produce located diagnostics | SYN-01, SYN-11, PRJ |
| AT-31 | Rename PCB capacitor `C7` to `C12`, back-annotate, then rename it in the schematic and forward-annotate | Each preview locates the same component. Each applied rename updates cross-probing and regenerated references. Save and reopen preserve the result, and a second update is empty. Component, pad and net IDs, position, copper and connectivity digest are unchanged | SYN-02, SYN-07, SYN-09 |
| AT-32 | Back-annotate one component in a repeated child, then exercise a multipart rename, a reference exchange and conflicting edits | The selected child instance changes and its sibling retains its reference. All units of the multipart component share the new base reference. The exchange applies and undoes atomically. Divergent edits, duplicate references and stale revisions produce located conflicts without partial edits | PRJ-03, SYN-07, SYN-09, SYN-11 |
| AT-33 | Create a linked PCB from a schematic with a nested child, then edit the schematic and reopen the board | The first preview shows the expected components and nets. Applying it produces a linked board ready for placement. Reopening, saving and switching workspaces show the last applied connectivity and identify pending schematic changes. An explicit update previews and applies those changes directly. A repeat update reports that the board is current | SYN-01, SYN-03, SYN-07, SYN-11 |
| AT-34 | Prepare an update that affects routed copper, cancel it, then change the schematic while a new preview is open | Cancelling preserves the applied board revision. A stale preview requires a fresh review. The new preview identifies the affected copper, and approval updates the board and source snapshot together | SYN-03, SYN-05, SYN-07 |
| Board folders and system hierarchy | Open a project with a motherboard and a daughterboard in separate folders. Link their connector ports in the root schematic | Each update preview names its source root and each folder produces its own outputs. A change unique to the daughterboard appears only in its update. The system schematic resolves both boards and the mapped connector pins after copying the project | PRJ-05, SYN-01, SYN-11 |
| Folder tree | Choose a root, then launch TinyCAD by opening a settings file in a different folder | Each root appears at the top of the tree. Expand and collapse multiple levels, create and rename a subfolder, move files between folders and send a deleted file or folder to trash where available | PRJ-09 |
| Document tabs and Save All | Open a native design, text, Markdown, CSV, PDF and image in the same project | Switch between top-level file tabs without losing edits. Edit the supported documents and save them together. Verify PDF and image viewing, and verify that a failed save leaves that tab dirty | PRJ-09 |
| Settings and outputs | Edit the project name, author and output destinations, then generate a BOM and netlist | Reopen the settings file and verify the metadata and destinations persist. The generated files appear in the chosen project subfolders | PRJ-05, OUT-07 |
| Activity bar and drop import | Use the vertical icon column in Project mode, then drop multiple files onto a nested project folder | Keyboard users can switch between mutually exclusive panels. A PCB shows its footprint controls in the shared Libraries position. The imported files appear in the indicated folder. Check desktop copy, Drive upload, duplicate names and failure reporting | Sidebar activity bar, project tree |
| Single File startup and mode switching | Start TinyCAD with no preference, open a drawing, then enter Project mode by opening a `.tcproject` and by using **Open Project Folder…** | The initial layout matches the v4.1.0 single-file workflow. The project browser and vertical activity bar appear only after entering Project mode. Both startup preferences work, explicit project opens take precedence, and cancelled transitions preserve edits | PRJ-09 |
| Standalone PCB editing | Open a `.dpn` directly in Single File mode in Electron and the filesystem-only browser build | PCB Design opens and saves the board using its embedded data. A board with no schematic association accepts manual net and pad assignments. Reopen the edited file and verify connectivity and geometry | WEB-01, AT-28 |
| Git source control | Open a project in an existing local repository, edit native and text files, stage selected changes, commit and push to a test remote | Command-line Git sees the same index, commit and branch. The diff and history show what was committed. Unstaged edits remain available. Exercise branch switching, a merge conflict and an open tab with unsaved edits | Git source control |

## Implementation status

The [WP3 editor recovery checklist](TODO.md#editor-interface-redesign) tracks the shared editor and its Single File behavior. The [WP6 project browser checklist](TODO.md#wp6--project-browser-acceptance) tracks end-to-end project acceptance.
