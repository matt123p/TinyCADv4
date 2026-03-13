import { Dispatch } from 'react';
import { docDrawing } from '../state/undo/undo';
import TPrintSheet from '../components/svg/PrintSheet';
import React from 'react';
import { render } from 'react-dom';
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
  state: docDrawing,
): Promise<Blob> {
  return new Promise((resolve) => {
    const sheet1 = state.docStore.present.drawing.sheets[0];

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
        Title: state.altStore.file?.name ?? 'Symbol',
      },
    });

    // Write the document to a blob
    let stream = doc.pipe(blobStream());
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
      for (let si = 0; si < state.docStore.present.drawing.sheets.length; ++si) {
        const sheet = state.docStore.present.drawing.sheets[si];
        const svg = (
          <TPrintSheet
            items={sheet.items}
            page_size={sheet.details.page_size}
            details={sheet.details}
            options={sheet.options}
            images={sheet.images}
            hatches={sheet.hatches}
          />
        );

        const element = document.createElement('div');
        render(svg, element);

        doc.addPage({
          size: [
            sheet.details.page_size[0] * units,
            sheet.details.page_size[1] * units,
          ],
        });
        SVGtoPDF(doc, element.children[0] as SVGElement, 0, 0, { useCSS: true });
      }

      doc.end();
    });
  });
}

// Generate HTML content with embedded SVG for printing
function generatePrintHtml(state: docDrawing): string {
  const sheets = state.docStore.present.drawing.sheets;
  
  // Build SVG content for all sheets
  let svgContent = '';
  
  for (let si = 0; si < sheets.length; ++si) {
    const sheet = sheets[si];
    const svg = (
      <TPrintSheet
        items={sheet.items}
        page_size={sheet.details.page_size}
        details={sheet.details}
        options={sheet.options}
        images={sheet.images}
        hatches={sheet.hatches}
      />
    );

    const element = document.createElement('div');
    render(svg, element);
    
    // Add page break between sheets (except for the last one)
    const pageBreak = si < sheets.length - 1 ? 'page-break-after: always;' : '';
    svgContent += `<div style="${pageBreak}">${element.innerHTML}</div>`;
  }

  const sheet1 = sheets[0];
  const isLandscape = sheet1.details.page_size[0] > sheet1.details.page_size[1];
  
  // Create a complete HTML document for printing
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${state.altStore.file?.name ?? 'TinyCAD Drawing'}</title>
  <style>
    @page {
      size: ${isLandscape ? 'landscape' : 'portrait'};
      margin: 10mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
    }
    svg {
      max-width: 100%;
      height: auto;
      display: block;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

  return html;
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
  const fileName = state.altStore.file?.name
    ? `${state.altStore.file.name.replace(/\.[^.]+$/, '')}.pdf`
    : 'drawing.pdf';

  // Check if we're running in Electron with native save dialog
  if (process.env.TARGET_SYSTEM === 'electron') {
    generatePdfBlob(state).then(async (blob) => {
      const base64 = await blobToBase64(blob);
      window.electronAPI.savePdf({ content: base64, name: fileName });
    });
  } else {
    // Fallback for web: open PDF in new tab (user can save from there)
    generatePdfBlob(state).then((blob) => {
      const url = URL.createObjectURL(blob);
      openExternalUrl(url);
    });
  }
}
