import React from 'react';
import { render } from 'react-dom';
import Text from '../../../src/components/svg/Text';
import { layoutMarkdown } from '../../../src/util/markdown';
import { updateText } from '../../../src/manipulators/updateText';
import { DocItemTypes } from '../../../src/model/dsnItem';
import { updateTextData } from '../../../src/manipulators/updateTextArea';
import { measureText } from '../../../src/util/measureText';
import { markdownSourceRuns } from '../../../src/util/markdownSource';
import { blank, ioXML } from '../../../src/io/ioXml';
import { XMLBuilder } from '../../../src/util/xmlbuilder';
import { dsnText } from '../../../src/model/dsnItem';

function check(value, message) {
  if (!value) throw new Error(message);
}

window.runMarkdownChecks = async () => {
  const source =
    '# RC circuit\n**Bold**, *italic*, ~~removed~~, `R1`\n\n' +
    '> Measure the time constant\n\n---\n\n' +
    '- [x] Wired\n- [ ] Measured\n\n1. Set voltage\n2. Capture\n\n' +
    '| Part | Value |\n| --- | --- |\n| R1 | 10 kΩ |\n\n' +
    '[Documentation](https://tinycad.net)\n\n' +
    '```python\nif ready:\n    tau = R * C\n```';
  const root = document.createElement('main');
  document.body.appendChild(root);
  let item = new updateText({
    _id: 1,
    NodeName: DocItemTypes.Text,
    point: [10, 10],
    point_b: [530, 770],
    text: source,
    rotation: 0,
    font_name: 'Arial',
    font_size: 18,
    font_colour: '#123456',
    font_bold: false,
    font_italic: false,
    filled: true,
    fill_colour: '#ffffff',
    stroked: true,
    line_colour: '#333333',
    line_width: 1,
    line_pattern: 0,
    hatch: 0,
    rounded_rect: false,
  }).post_construction();
  function draw(overrides = {}) {
    render(
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
        <Text
          dx={0}
          dy={0}
          dr={0}
          scale_x={1}
          scale_y={1}
          parent={null}
          data={item}
          hover={false}
          selected={false}
          selected_handle={0}
          {...overrides}
        />
      </svg>,
      root,
    );
  }
  draw();
  const preview = root.querySelector('[data-markdown]');
  check(
    preview && !root.querySelector('foreignObject,image,table,a,script'),
    'Preview uses only native SVG',
  );
  check(
    Array.from(preview.querySelectorAll('*')).every(
      (node) => node.namespaceURI === 'http://www.w3.org/2000/svg',
    ),
    'Every preview node is SVG',
  );
  const heading = preview.querySelector('text');
  check(
    heading.textContent === 'RC circuit' &&
      heading.getAttribute('font-size') === '36' &&
      heading.getAttribute('font-weight') === 'bold',
    'Native heading uses relative base size',
  );
  check(
    Array.from(preview.querySelectorAll('text')).some(
      (node) =>
        node.textContent === 'Bold' &&
        node.getAttribute('font-weight') === 'bold',
    ),
    'Native bold text',
  );
  check(preview.textContent.includes('    tau'), 'Code indentation');
  check(
    preview.querySelectorAll('rect[stroke="#123456"]').length === 2,
    'Task boxes are vector rectangles',
  );
  check(
    preview.querySelector('text').getAttribute('fill') === '#123456',
    'Drawing colour',
  );
  check(
    preview.textContent.includes('| Part | Value |') &&
      preview.textContent.includes('[Documentation](https://tinycad.net)'),
    'Unsupported tables and links remain literal',
  );
  check(item.text === source, 'Rendering preserves source');
  const hostile =
    '<script>alert(1)</script><img src="https://example.com/a.png" onerror="alert(1)">';
  draw({
    data: {
      ...item,
      text: hostile + '\n\n![remote](https://example.com/a.png)',
    },
  });
  check(
    !root.querySelector('script,img,image,foreignObject,iframe,a'),
    'No HTML execution or external images',
  );
  check(
    root.textContent.includes('<script>') &&
      root.textContent.includes('![remote]'),
    'Unsupported markup is visible text',
  );
  const lines = layoutMarkdown('first\nsecond', item, 500).filter(
    (shape) => shape.kind === 'text',
  );
  check(
    lines.length === 2 && lines[1].y > lines[0].y,
    'Ordinary line breaks are retained',
  );
  check(layoutMarkdown('text', item, 0).length === 0, 'Empty width');
  for (const [source, checked] of [
    ['- [x] Done', true],
    ['- [X] Done', true],
    ['- [ ] Pending', false],
    ['- [x]', true],
    ['- [X]', true],
    ['- [ ]', false],
  ] as const) {
    const shapes = layoutMarkdown(source, item, 500);
    check(
      shapes.filter((shape) => shape.kind === 'rect' && !shape.shaded)
        .length === 1 &&
        shapes.filter((shape) => shape.kind === 'line').length ===
          (checked ? 2 : 0) &&
        !shapes.some(
          (shape) =>
            shape.kind === 'bullet' ||
            (shape.kind === 'text' && /\[[ xX]\]/.test(shape.value)),
        ),
      'Task marker renders as a vector checkbox: ' + source,
    );
  }
  const narrowPreview = layoutMarkdown(
    'averylongwordthatneedstowrap',
    item,
    50,
  ).filter((shape) => shape.kind === 'text');
  check(
    narrowPreview.length > 1 &&
      narrowPreview.every(
        (shape) => measureText(shape.size + 'px Arial', shape.value) <= 44,
      ),
    'Preview wraps long words to SVG bounds',
  );
  draw();

  draw({ selected: true, selected_handle: -2 });
  check(
    !root.querySelector('[data-markdown]'),
    'Source editing must replace preview',
  );
  check(
    root.querySelector('text') && root.textContent.includes('# RC'),
    'Editable Markdown source',
  );
  const headingSpan = root.querySelector('text tspan');
  check(
    headingSpan.textContent === '# RC circuit',
    'Heading delimiters stay editable',
  );
  check(
    getComputedStyle(headingSpan).fontSize === '36px',
    'Heading uses twice the base size',
  );
  check(
    getComputedStyle(headingSpan).fontWeight === '700',
    'Heading source is bold',
  );
  const boldSpan = Array.from(root.querySelectorAll('tspan')).find(
    (span) => span.textContent === '**Bold**',
  );
  check(
    boldSpan && getComputedStyle(boldSpan).fontWeight === '700',
    'Bold source includes markers',
  );

  const editSource =
    '# Heading\rnormal **bold** and *italic* and ~~gone~~\r```\r**code stays literal**\r```\r';
  const editItem = new updateText({
    ...item,
    text: editSource,
    font_name: 'Georgia',
    font_size: 24,
    font_italic: true,
  }).post_construction();
  draw({ data: editItem, selected: true, selected_handle: -2 });
  const spans = Array.from(root.querySelectorAll('tspan'));
  check(
    spans.every((span) => getComputedStyle(span).fontFamily === 'Georgia'),
    'Source inherits the chosen font family',
  );
  check(
    spans.every((span) => getComputedStyle(span).fontStyle === 'italic'),
    'Base italic survives Markdown formatting',
  );
  check(
    getComputedStyle(spans[0]).fontSize === '48px',
    'Heading scales with a changed base size',
  );
  check(
    editItem.textData.textBlocks.map((block) => block.value).join('') ===
      editSource,
    'Layout preserves every source character',
  );
  const codeSpan = spans.find(
    (span) => span.textContent === '**code stays literal**',
  );
  check(
    codeSpan && getComputedStyle(codeSpan).fontWeight === '400',
    'Code fences suppress inline emphasis',
  );
  const boldBlock = editItem.textData.textBlocks.find((block) =>
    block.value.includes('**bold**'),
  );
  const bold = boldBlock.sourceRuns.find(
    (run) => boldBlock.value.slice(run.start, run.end) === '**bold**',
  );
  check(bold, 'Inline bold span is retained in measured layout');
  const measured = measureText('italic bold 24px Georgia', '**bold**');
  check(
    Math.abs(
      boldBlock.caretOffsets[bold.end] -
        boldBlock.caretOffsets[bold.start] -
        measured,
    ) < 0.01,
    'Caret measures the actual styled font',
  );
  const afterBold = boldBlock.start + bold.end;
  const area = editItem.textData.textArea;
  const updater = new updateTextData(
    area.drawX,
    area.drawY,
    area.drawPoint,
    area.drawItem,
    area.dragHandle,
    area.moveHandle,
    area.drawMultiline,
    area.drawRotation,
    area.drawWidth,
    area.drawHeight,
    area.drawCentre,
    area.allowMove,
  );
  const placed = updater.mouse_click(editItem.textData, afterBold, true);
  check(
    Math.abs(placed.textEdit.x - (1 + boldBlock.caretOffsets[bold.end])) < 0.01,
    'Caret aligns after bold source',
  );
  const hit = updater.find_positon(placed, [
    editItem.point[0] + placed.textEdit.x,
    editItem.point[1] + placed.textEdit.y - 5,
  ]);
  check(
    hit === afterBold,
    'Click maps styled glyphs back to the right source offset',
  );
  const selected = {
    ...placed,
    sel_start: boldBlock.start + bold.start,
    sel_end: afterBold,
  };
  const selectionLayout = updater.create_text_blocks(selected, editSource);
  const selectionBlock = selectionLayout.textBlocks.find(
    (block) => block.start === boldBlock.start,
  );
  check(
    Math.abs(selectionBlock.sel_width - measured) < 0.01,
    'Selection aligns with bold source',
  );
  const inserted = new updateText({
    ...editItem,
    textData: placed,
  }).handleKeyPress(-2, '!'.charCodeAt(0));
  check(
    inserted.text ===
      editSource.slice(0, afterBold) + '!' + editSource.slice(afterBold),
    'Typing retains Markdown and inserts at the measured caret',
  );
  check(
    placed.textBlocks[placed.textBlocks.length - 1].value === '',
    'Trailing newline has an editable blank line',
  );
  const narrow = new updateText({
    ...editItem,
    point_b: [150, 770],
  }).post_construction();
  check(
    narrow.textData.textBlocks.map((block) => block.value).join('') ===
      editSource,
    'Wrapping preserves source',
  );
  check(
    narrow.textData.textBlocks.every((block) => block.width <= 140),
    'Styled source wraps inside the box',
  );
  const setext = new updateText({
    ...item,
    text: 'Heading\n=======\nplain **bold**',
  }).post_construction();
  check(
    setext.textData.textBlocks[0].sourceRuns[0].font_size === 36 &&
      setext.textData.textBlocks[1].sourceRuns[0].font_size === 36,
    'Setext headings retain and style underline markers',
  );
  const multiline = markdownSourceRuns('**two\nlines**', item);
  check(
    multiline.every((run) => run.font_bold),
    'Emphasis continues across source line breaks',
  );
  draw({ data: editItem });
  check(
    Array.from(root.querySelectorAll('[data-markdown] text')).every(
      (node) => node.getAttribute('font-family') === 'Georgia',
    ),
    'Preview code uses the selected base font too',
  );
  draw();
  draw({ selected: true, selected_handle: 0 });
  check(root.querySelector('.selectedHighlight'), 'Selected box highlight');
  for (const dr of [0, 1, 2, 3, 4]) {
    draw({ dr, dx: 780, dy: 780, scale_x: 2, scale_y: 2 });
    check(!root.innerHTML.includes('NaN'), 'Rotation and scale: ' + dr);
    check(root.querySelector('[data-markdown]'), 'Rotated Markdown preview');
  }
  const rotated = new updateText(item).rotate(1);
  draw({ data: rotated });
  check(
    root
      .querySelector('[data-markdown]')
      .parentElement.getAttribute('transform')
      .includes('rotate(270)'),
    'Text orientation',
  );
  draw();
  const serialized = new XMLSerializer().serializeToString(
    root.querySelector('svg'),
  );
  const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml');
  check(
    !parsed.querySelector('parsererror'),
    'Standalone SVG must be valid XML',
  );
  check(
    Array.from(parsed.querySelectorAll('*')).every(
      (node) => node.namespaceURI === 'http://www.w3.org/2000/svg',
    ),
    'Standalone drawing contains only SVG elements',
  );
  window.markdownScreenshotReady = true;
  window.showMarkdownEditor = () =>
    draw({ selected: true, selected_handle: -2 });
  window.showMarkdownPreview = () => draw();
  const savedSources = [
    source,
    '',
    '# Heading\r\n\r\n- [x] Done\r\n- [ ] Pending\r\n',
    'Unicode: Ω τ 中文 日本語 café\n<&> "quoted" &amp;\n',
    '```xml\n<node value="a & b">\n    **literal**\n</node>\n```\n\n- [x]\n- [ ]',
  ];
  window.createMarkdownFile = () => {
    const drawing = blank();
    drawing.sheets[0].items = savedSources.map((text, index) =>
      new updateText({
        ...item,
        _id: 100 + index,
        text,
        rotation: index % 4,
        font_name: 'Georgia',
        font_size: 24,
        font_bold: true,
        font_italic: true,
      }).post_construction(),
    );
    return new ioXML().to_dsn(drawing, true, true).tostring();
  };
  window.reloadMarkdownFile = (xml: string) => {
    const builder = new XMLBuilder();
    builder.fromText(xml);
    const drawing = new ioXML().from_dsn(builder);
    const loaded = drawing.sheets[0].items as dsnText[];
    check(loaded.length === savedSources.length, 'All saved notes reload');
    const normalize = (text: string) => text.replace(/\r\n?|\n/g, '\n');
    loaded.forEach((note, index) => {
      check(
        normalize(note.text) === normalize(savedSources[index]),
        'Saved Markdown source survives XML round trip: ' + index,
      );
      check(
        note.font_name === 'Georgia' && note.font_size === 24 &&
          note.font_bold && note.font_italic &&
          note.font_colour === item.font_colour && note.rotation === index % 4,
        'Base font, colour and rotation survive saving: ' + index,
      );
      check(
        JSON.stringify(note.point) === JSON.stringify(item.point) &&
          JSON.stringify(note.point_b) === JSON.stringify(item.point_b),
        'Text box bounds survive saving: ' + index,
      );
      draw({ data: note });
      check(root.querySelector('[data-markdown]'), 'Reloaded note renders');
      check(
        JSON.stringify(layoutMarkdown(note.text, note, 520)) ===
          JSON.stringify(layoutMarkdown(savedSources[index], note, 520)),
        'Reloaded Markdown produces the same vector layout: ' + index,
      );
    });
    draw();
    return new ioXML().to_dsn(drawing, true, true).tostring();
  };
  window.finishMarkdownChecks = async () => {
    const svg = root.querySelector('svg');
    check(
      !svg.querySelector('foreignObject,image'),
      'PDF receives the same vector SVG without raster conversion',
    );
    return new XMLSerializer().serializeToString(svg);
  };
  return 'Markdown formatting, source editing, safety, rotation and SVG checks passed';
};
