import workerUrl from 'url:pdfjs-dist/build/pdf.worker.min.mjs';
import { Attachment } from './types';

export function selectPdfPages(selection: string, count: number): number[] {
  if (!selection.trim()) {
    if (count > 20)
      throw new Error(
        `This PDF has ${count} pages. Choose up to 20 PDF pages to import, e.g. 1-4,12.`,
      );
    return Array.from({ length: count }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  for (const token of selection.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error('PDF pages must be numbers or ranges, e.g. 1-4,12.');
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (start < 1 || end > count || start > end || end - start > 20)
      throw new Error(
        `PDF page range must be within 1–${count}, up to 20 pages.`,
      );
    for (let n = start; n <= end; n++) pages.add(n);
  }
  if (pages.size > 20) throw new Error('Choose up to 20 PDF pages.');
  return Array.from(pages).sort((a, b) => a - b);
}
export async function pdfImages(
  file: File,
  pages: string,
  signal: AbortSignal,
): Promise<Attachment[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const pdf = await task.promise;
    const result: Attachment[] = [];
    for (const pageNumber of selectPdfPages(pages, pdf.numPages)) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: 2000 / Math.max(base.width, base.height),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      result.push({
        name: `${file.name}, page ${pageNumber}`,
        mime: 'image/png',
        data: canvas.toDataURL('image/png').split(',')[1],
      });
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}
