import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import blobStream from 'blob-stream';
import fontUrl from 'url:/styles/fonts/LiberationSans-Regular.ttf';

const pointsPerMillimetre = 72 / 25.4;

export async function fabricationPdf(svg: string, title: string): Promise<Blob> {
  const dimensions = /^<svg[^>]* width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  if (!dimensions) throw new Error('Cannot determine the fabrication drawing scale.');
  const width = Number(dimensions[1]) * pointsPerMillimetre;
  const height = Number(dimensions[2]) * pointsPerMillimetre;
  const font = await fetch(fontUrl);
  if (!font.ok) throw new Error('Could not load the fabrication drawing font.');
  const fontBytes = await font.arrayBuffer();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [width, height],
      margin: 0,
      compress: false,
      info: { Title: title + ' · Fabrication drawing', Creator: 'TinyCAD' },
    });
    const stream = doc.pipe(blobStream());
    stream.on('error', reject);
    doc.on('error', reject);
    stream.on('finish', () => resolve(stream.toBlob('application/pdf')));
    doc.registerFont('Fabrication', fontBytes);
    SVGtoPDF(doc, svg, 0, 0, { fontCallback: () => 'Fabrication' });
    doc.end();
  });
}
