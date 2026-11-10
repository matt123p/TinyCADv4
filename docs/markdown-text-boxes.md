# Markdown text boxes

Drawing text boxes render Markdown. Select the text for editing to see the source;
click away to see the formatted result. The original source is saved in the drawing,
so editing, undo/redo and reopening a file retain the Markdown.

Headings, bold and italic text, links, images, lists, quotations, horizontal rules,
inline code and fenced code blocks are supported, together with GitHub-style tables,
strikethrough and read-only task lists. Existing single line breaks are retained.
Code blocks preserve spaces and indentation; language names can follow the opening
fence, but syntax colouring is not applied.

````markdown
## RC circuit
**Time constant:** τ = R × C

| Component | Value |
| --- | --- |
| R1 | 10 kΩ |
| C1 | 100 nF |

```python
tau = 10_000 * 100e-9
```

- [x] Draw the circuit
- [ ] Measure the time constant
````

Use the text box's existing font, colour, border and fill controls. Markdown lays
out within the box and clips at its edges; enlarge the box to fit longer notes.
Rotation is supported. Net labels, component fields and pin names keep their
existing text behaviour.

SVG export and browser printing retain formatted text. PDF export embeds each
formatted text box as a high-resolution image while keeping the circuit vector-based.
Remote images need to be accessible to the browser (including CORS for PDF export).
Embedded HTML is sanitized; scripts, event handlers, forms and custom styles are
not allowed. Links are displayed as annotations rather than interactive canvas controls.

The renderer reuses the bundle branch's [Marked](https://marked.js.org/) (MIT) and
[DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 or MPL-2.0).
PDF rendering uses [html-to-image](https://github.com/bubkoo/html-to-image) (MIT).
