import workerUrl from 'url:pdfjs-dist/build/pdf.worker.min.mjs';
import { Attachment } from './types';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

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
async function withPdf<T>(
  bytes: Uint8Array,
  signal: AbortSignal,
  read: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
  });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    return await read(await task.promise);
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}

async function pdfPageImage(
  page: PDFPageProxy,
  name: string,
): Promise<Attachment> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: 2000 / Math.max(base.width, base.height),
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({ canvas, viewport }).promise;
    return {
      name,
      mime: 'image/png',
      data: canvas.toDataURL('image/png').split(',')[1],
    };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function pdfImages(
  file: File,
  pages: string,
  signal: AbortSignal,
) {
  return withPdf(
    new Uint8Array(await file.arrayBuffer()),
    signal,
    async (pdf) => {
      const result: Attachment[] = [];
      for (const number of selectPdfPages(pages, pdf.numPages)) {
        signal.throwIfAborted();
        const page = await pdf.getPage(number);
        try {
          result.push(await pdfPageImage(page, `${file.name}, page ${number}`));
        } finally {
          page.cleanup();
        }
      }
      return result;
    },
  );
}

export function readPdfPage(
  bytes: Uint8Array,
  name: string,
  number: number,
  image: boolean,
  signal: AbortSignal,
) {
  return withPdf(bytes.slice(), signal, async (pdf) => {
    if (number > pdf.numPages)
      throw new Error(`This PDF has ${pdf.numPages} pages.`);
    const page = await pdf.getPage(number);
    try {
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
        )
        .join('');
      const preview = image
        ? await pdfPageImage(page, `${name}, page ${number}`)
        : undefined;
      return { text, pages: pdf.numPages, preview };
    } finally {
      page.cleanup();
    }
  });
}
