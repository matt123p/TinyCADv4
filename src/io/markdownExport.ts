import { toPng } from 'html-to-image';

/** svg-to-pdfkit cannot draw foreignObject. Rasterize only the Markdown boxes. */
export async function rasterizeMarkdown(svg: SVGElement): Promise<void> {
  for (const box of Array.from(
    svg.querySelectorAll('foreignObject[data-markdown]'),
  )) {
    const content = box.querySelector<HTMLElement>('.tinycad-markdown');
    const width = Number(box.getAttribute('width'));
    const height = Number(box.getAttribute('height'));
    if (!content || width <= 0 || height <= 0) {
      box.remove();
      continue;
    }
    const url = await toPng(content, {
      width,
      height,
      pixelRatio: 3,
      // Text boxes use the drawing's system font; avoid fetching unrelated UI fonts.
      skipFonts: true,
    });
    const image = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'image',
    );
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute('href', url);
    box.replaceWith(image);
  }
}
