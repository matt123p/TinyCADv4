# Bundled example drawings

**Open Example** opens a modal browser occupying 80% of the app window's width
and height, above the drawing and other panels. Users browse groups, read each
group's complete Markdown description, then select a drawing to see its preview
and complete Markdown description. The group sidebar and search make it easy to
switch between subjects.

Put the content to distribute in `bundled-examples/`, then edit
`bundled-examples/config.json`. The checked-in catalog is empty so you can supply
the actual drawings, pictures, and descriptions. Both browser builds and the
desktop installer use the same catalog.

```json
{
  "$schema": "../schemas/bundled-examples.schema.json",
  "version": 1,
  "assets": ["getting-started/images/wiring.png"],
  "groups": [
    {
      "id": "getting-started",
      "title": "Get you going examples",
      "preview": "getting-started/group.png",
      "descriptionPath": "getting-started/README.md",
      "examples": [
        {
          "id": "first-circuit",
          "title": "Your first circuit",
          "path": "getting-started/first-circuit.dsn",
          "preview": "getting-started/first-circuit.png",
          "descriptionPath": "getting-started/first-circuit.md"
        }
      ]
    },
    {
      "id": "spice",
      "title": "SPICE & Simulation",
      "preview": "spice/group.webp",
      "description": "## Simulation examples\n\nFull Markdown goes here, including paragraphs, lists, tables, code, and links.",
      "examples": []
    },
    {
      "id": "cabinet-layouts",
      "title": "Cabinet Layouts",
      "preview": "cabinets/group.svg",
      "descriptionPath": "cabinets/README.md",
      "examples": []
    }
  ]
}
```

Every group and drawing requires `id`, `title`, `preview`, and exactly one of
`description` (inline Markdown) or `descriptionPath` (a UTF-8 `.md`/`.markdown`
file). Group IDs must be unique; drawing IDs must be unique within their group.
Groups contain an `examples` array and may initially be empty. Drawing entries
also require `path`, pointing to an existing `.dsn` drawing.

File paths are relative to `bundled-examples/`, use forward slashes on all
platforms, and cannot escape that directory. Previews support PNG, JPEG, WebP,
GIF, AVIF, and SVG. Supply preview images as assets; the browser does not need to
open or render a `.dsn` just to display its preview.

Descriptions support headings, lists, tables, block quotes, fenced code, links,
and images, with no excerpt or length truncation. HTML is sanitized. Web/email
links open externally; heading links scroll inside the description. Relative
image paths resolve beside the Markdown file, or from `bundled-examples/` for
inline descriptions. List additional Markdown images in the catalog's `assets`
array; images already listed as previews need not be repeated. For example,
`![Wiring](images/wiring.png)` in `getting-started/first-circuit.md` refers to
`getting-started/images/wiring.png`. Relative links to bundled images download
the image. HTTP(S) images and links also work.

Opening the browser loads the catalog and displayed previews. A group's or
drawing's description file is loaded when selected. Drawing files load only when
the user presses **Open drawing**. Errors offer retry without replacing the
current drawing; closing the browser cancels pending opening requests.

An example opens as a new, editable drawing with no reference to the bundled
source file. **Save** creates the user's own copy. Existing unsaved drawings or
libraries use the normal Save / Continue Without Saving / Cancel prompt. Cancel
returns to the selected example, with the original document preserved. Opening
an example clears the previous document's undo history.

All `start:*` and `build:*` commands stage examples automatically. The packaging
script validates the catalog, checks every referenced resource, and copies only
those resources into `dist/bundled-examples/`. Missing files, unsafe paths, and
links outside the source directory fail the build. Deploy the complete `dist/`
directory for the browser; desktop packaging already includes it. Desktop loads
these resources locally through a restricted IPC service. To stage assets alone,
run `npm run examples:package`; refresh the app after changing catalog content.

Run `npm run test:examples` for catalog validation, packaging, resource loading,
opening copies, unsaved-change handling, and desktop IPC regression checks.
