# Markdown text boxes — v4.0.11

Drawing text boxes use a small Markdown subset rendered entirely as SVG text and
shapes. The drawing canvas, SVG export, browser printing and PDF export use the
same component. PDF text stays vector-based; there is no HTML layout or screenshot
conversion in the export path.

Supported formatting:

- Headings, bold, italic and strikethrough.
- Paragraphs and ordinary line breaks.
- Numbered lists, bullet lists and read-only task lists.
- Quotations and horizontal rules.
- Inline code, fenced code blocks and indented code blocks.

Tables, links, images and raw HTML display as literal text. They do not create
tables, clickable links, embedded HTML or image requests. Code preserves whitespace
without syntax colouring. All text uses the selected base font family, weight and
italic settings, with heading sizes scaled relative to the base font size.

Select the text for editing to see styled source, including the Markdown markers.
Caret placement, selection and wrapping follow that styling. Click away to see
the formatted note. The original source is saved, so undo, copy/paste and reopening
a drawing preserve it. Resize a text box to fit the note; the formatted view clips
to its rectangle. Rotation is supported.

````markdown
# RC filter
**Time constant:** τ = R × C

- R1: 10 kΩ
- C1: 100 nF

- [x] Circuit wired
- [ ] Measurements recorded

~~~python
tau = 10_000 * 100e-9
~~~
````

Net labels, component fields and pin names keep their existing text behaviour.
Task lists use `- [x]` for checked and `- [ ]` for unchecked boxes, with an
optional label. Edit the marker to change its state; boxes are drawn as vectors
on screen and in exports.
Parsing uses [Marked](https://marked.js.org/) (MIT); rendering uses native SVG.
