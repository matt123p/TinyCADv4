import { Dispatch } from 'react';
import { docDrawing } from '../state/undo/undo';
import TPrintSheet from '../components/svg/PrintSheet';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import blobStream from 'blob-stream';
import { actionSelectDialog } from '../state/dispatcher/AppDispatcher';
import { openExternalUrl } from '../util/navigation';

// Helper function to convert a Blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Remove the data:application/pdf;base64, prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Common function to generate PDF and return as blob
function generatePdfBlob(
  drawing: docDrawing['docStore']['present']['drawing'],
  title: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const sheet1 = drawing.sheets[0];

    // TinyCAD units -> PDF Points
    const units = 0.5669291338582677;

    // Create the PDF document
    const doc = new PDFDocument({
      compress: false,
      margin: 0,
      autoFirstPage: false,
      info: {
        Author: sheet1.details.author,
        Producer: 'TinyCAD.net',
        Title: title,
      },
    });

    // Write the document to a blob
    let stream = doc.pipe(blobStream());
    stream.on('error', reject);
    doc.on('error', reject);
    stream.on('finish', function () {
      let blob = stream.toBlob('application/pdf');
      resolve(blob);
    });

    const fonts = [
      // Load the fonts
      {
        name: 'Arial',
        url: require('url:/styles/fonts/LiberationSans-Regular.ttf'),
      },
      {
        name: 'Arial-Bold',
        url: require('url:/styles/fonts/LiberationSans-Bold.ttf'),
      },
      {
        name: 'Arial-Italic',
        url: require('url:/styles/fonts/LiberationSans-Italic.ttf'),
      },
      {
        name: 'Arial-BoldItalic',
        url: require('url:/styles/fonts/LiberationSans-BoldItalic.ttf'),
      },
      {
        name: 'Courier New',
        url: require('url:/styles/fonts/LiberationMono-Regular.ttf'),
      },
      {
        name: 'Courier New-Bold',
        url: require('url:/styles/fonts/LiberationMono-Bold.ttf'),
      },
      {
        name: 'Courier New-Italic',
        url: require('url:/styles/fonts/LiberationMono-Italic.ttf'),
      },
      {
        name: 'Courier New-BoldItalic',
        url: require('url:/styles/fonts/LiberationMono-BoldItalic.ttf'),
      },
      {
        name: 'Times',
        url: require('url:/styles/fonts/LiberationSerif-Regular.ttf'),
      },
      {
        name: 'Times-Bold',
        url: require('url:/styles/fonts/LiberationSerif-Bold.ttf'),
      },
      {
        name: 'Times-Italic',
        url: require('url:/styles/fonts/LiberationSerif-Italic.ttf'),
      },
      {
        name: 'Times-BoldItalic',
        url: require('url:/styles/fonts/LiberationSerif-BoldItalic.ttf'),
      },
    ];

    Promise.all(
      fonts.map((font) => {
        return fetch(font.url, {
          method: 'GET',
        })
          .then((response) => {
            if (response.status === 200) {
              return response.blob();
            } else {
              return null;
            }
          })
          .then((blob) => blob?.arrayBuffer())
          .then((arrayBuffer) => doc.registerFont(font.name, arrayBuffer));
      }),
    ).then(() => {
      for (const sheet of drawing.sheets) {
        const svg = (
          <TPrintSheet
            items={sheet.items}
            page_size={sheet.details.page_size}
            details={sheet.details}
            options={sheet.options}
            images={sheet.images}
            hatches={sheet.hatches}
            netlistTypes={drawing.netlistTypes}
          />
        );

        const element = document.createElement('div');
        const root = createRoot(element);
        try {
          // SVGtoPDF reads the rendered SVG immediately.
          flushSync(() => root.render(svg));
          const drawing = element.children[0] as SVGElement;
          doc.addPage({
            size: [
              sheet.details.page_size[0] * units,
              sheet.details.page_size[1] * units,
            ],
          });
          SVGtoPDF(doc, drawing, 0, 0, { useCSS: true });
        } finally {
          root.unmount();
        }
      }

      doc.end();
    }).catch(reject);
  });
}

export function pdfPrint(
  dispatch: Dispatch<any>,
  getState: { (): docDrawing },
) {
  // Show the print preview dialog with the drawing preview
  dispatch(actionSelectDialog('print_preview', null));
}

export function pdfExport(
  dispatch: Dispatch<any>,
  getState: { (): docDrawing },
) {
  const state = getState();
  const drawing = state.docStore.present.drawing;
  const title = state.altStore.file?.name ?? 'Symbol';
  const fileName = state.altStore.file?.name
    ? `${state.altStore.file.name.replace(/\.[^.]+$/, '')}.pdf`
    : 'drawing.pdf';

  // Check if we're running in Electron with native save dialog
  if (process.env.TARGET_SYSTEM === 'electron') {
    generatePdfBlob(drawing, title).then(async (blob) => {
      const base64 = await blobToBase64(blob);
      window.electronAPI.savePdf({ content: base64, name: fileName });
    });
  } else {
    // Fallback for web: open PDF in new tab (user can save from there)
    generatePdfBlob(drawing, title).then((blob) => {
      const url = URL.createObjectURL(blob);
      openExternalUrl(url);
    });
  }
}

export async function openPdfForPrinting(
  drawing: docDrawing['docStore']['present']['drawing'],
  title: string,
) {
  const blob = await generatePdfBlob(drawing, title);
  return window.electronAPI.openPrintPdf(await blobToBase64(blob));
}
