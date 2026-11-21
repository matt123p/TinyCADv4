import React, { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@fluentui/react-components';
import workerUrl from 'url:pdfjs-dist/build/pdf.worker.min.mjs';
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from 'pdfjs-dist';

export default function ProjectPdfViewer({
  bytes,
  name,
}: {
  bytes: Uint8Array;
  name: string;
}) {
  const canvas = useRef<HTMLCanvasElement>();
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask;
    void import('pdfjs-dist')
      .then(async (pdfjs) => {
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({
          data: bytes.slice(),
          enableXfa: false,
        });
        const proxy = await task.promise;
        if (active) setPdf(proxy);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      if (task) void task.destroy().catch(() => {});
    };
  }, [bytes]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let render: RenderTask;
    const target = canvas.current;
    void pdf
      .getPage(page)
      .then(async (source) => {
        if (!active) return;
        const base = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({
          scale: 1440 / Math.max(base.width, base.height),
        });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        render = source.render({ canvas: target, viewport });
        try {
          await render.promise;
        } finally {
          source.cleanup();
        }
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      render?.cancel();
      target.width = 0;
      target.height = 0;
    };
  }, [page, pdf]);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!pdf && !error && <Spinner label="Opening PDF…" />}
      {pdf && (
        <>
          <div className="project-preview-actions">
            <Button
              disabled={page === 1}
              onClick={() => {
                setError('');
                setPage(page - 1);
              }}
            >
              Previous page
            </Button>
            <span role="status">
              Page {page} of {pdf.numPages}
            </span>
            <Button
              disabled={page === pdf.numPages}
              onClick={() => {
                setError('');
                setPage(page + 1);
              }}
            >
              Next page
            </Button>
          </div>
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${name}, page ${page}`}
          />
        </>
      )}
    </>
  );
}
