import React from 'react';
import { render } from 'react-dom';
import Text from '../../../src/components/svg/Text';
import { renderMarkdown } from '../../../src/util/markdown';
import { rasterizeMarkdown } from '../../../src/io/markdownExport';
import { updateText } from '../../../src/manipulators/updateText';
import { DocItemTypes } from '../../../src/model/dsnItem';

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
