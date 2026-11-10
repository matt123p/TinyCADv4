import React from 'react';
import { render } from 'react-dom';
import Text from '../../../src/components/svg/Text';
import { renderMarkdown } from '../../../src/util/markdown';
import { rasterizeMarkdown } from '../../../src/io/markdownExport';
import { updateText } from '../../../src/manipulators/updateText';
import { DocItemTypes } from '../../../src/model/dsnItem';
import { updateTextData } from '../../../src/manipulators/updateTextArea';
import { measureText } from '../../../src/util/measureText';
import { markdownSourceRuns } from '../../../src/util/markdownSource';

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
  for (const selector of [
    'h1',
    'strong',
    'em',
    'del',
    'code',
    'pre code.language-python',
    'blockquote',
    'hr',
    'ul',
    'ol',
    'table',
    'a',
  ]) {
    check(
      root.querySelector(selector),
      'Missing Markdown element: ' + selector,
    );
  }
  check(
    root.textContent.includes('☑') && root.textContent.includes('☐'),
    'Task list states',
  );
  check(
    root.querySelector('pre').textContent.includes('    tau'),
    'Code indentation',
  );
  check(
    getComputedStyle(root.querySelector('pre')).whiteSpace === 'pre',
    'Code whitespace style',
  );
  check(
    getComputedStyle(root.querySelector('.tinycad-markdown')).color ===
      'rgb(18, 52, 86)',
    'Drawing colour',
  );
  check(item.text === source, 'Rendering must preserve source');

  const hostile = renderMarkdown(
    '<script>alert(1)</script><img src="x" onerror="alert(1)">' +
      '<a href="javascript:alert(1)">bad</a><iframe src="https://example.com"></iframe>' +
      '<p style="position:fixed">safe</p><form><input autofocus></form>',
  );
  const safe = document.createElement('div');
  safe.innerHTML = hostile;
  check(
    !safe.querySelector('script,iframe,form,input,[onerror],[style]'),
    'HTML sanitization',
  );
  check(
    !safe.querySelector('a').hasAttribute('href'),
    'Unsafe URL sanitization',
  );
  check(
    renderMarkdown('first\nsecond').includes('<br>'),
    'Legacy annotation line breaks',
  );
  check(
    renderMarkdown('```html\n<script>bad()</script>\n```').includes(
      '&lt;script&gt;',
    ),
    'Code is escaped',
  );

  draw({ selected: true, selected_handle: -2 });
  check(
    !root.querySelector('foreignObject'),
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
    getComputedStyle(root.querySelector('pre code')).fontFamily === 'Georgia',
    'Preview code uses the selected base font too',
  );
  draw();
  draw({ selected: true, selected_handle: 0 });
  check(root.querySelector('.selectedHighlight'), 'Selected box highlight');
  for (const dr of [0, 1, 2, 3, 4]) {
    draw({ dr, dx: 780, dy: 780, scale_x: 2, scale_y: 2 });
    check(!root.innerHTML.includes('NaN'), 'Rotation and scale: ' + dr);
    check(root.querySelector('foreignObject'), 'Rotated Markdown preview');
  }
  const rotated = new updateText(item).rotate(1);
  draw({ data: rotated });
  check(
    root
      .querySelector('foreignObject')
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
    parsed.querySelector('h1').namespaceURI === 'http://www.w3.org/1999/xhtml',
    'SVG XHTML namespace',
  );
  window.markdownScreenshotReady = true;
  window.showMarkdownEditor = () =>
    draw({ selected: true, selected_handle: -2 });
  window.showMarkdownPreview = () => draw();
  window.finishMarkdownChecks = async () => {
    const svg = root.querySelector('svg');
    await rasterizeMarkdown(svg);
    check(
      !svg.querySelector('foreignObject'),
      'PDF conversion removes unsupported HTML',
    );
    const image = svg.querySelector('image');
    check(
      image?.getAttribute('href').startsWith('data:image/png;base64,'),
      'PDF text image',
    );
    const bitmap = new Image();
    bitmap.src = image.getAttribute('href');
    await bitmap.decode();
    check(
      bitmap.naturalWidth === 1560 && bitmap.naturalHeight === 2280,
      'PDF 3x resolution',
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.naturalWidth;
    canvas.height = bitmap.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    check(
      pixels.some((value, index) => index % 4 === 3 && value > 0),
      'PDF image must contain visible text',
    );
    return new XMLSerializer().serializeToString(svg);
  };
  return 'Markdown formatting, source editing, safety, rotation and SVG checks passed';
};
