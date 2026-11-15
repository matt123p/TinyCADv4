import { Attachment } from './types';
export async function rasterizeSvg(
  svg: string,
  pixels: number,
  signal: AbortSignal,
): Promise<Attachment> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        image.src = '';
        reject(new DOMException('Stopped', 'AbortError'));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      image.onerror = () => {
        signal.removeEventListener('abort', abort);
        reject(new Error('Could not rasterize circuit preview.'));
      };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG rendering requires canvas support.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, pixels, pixels);
    const ratio = Math.min(pixels / image.width, pixels / image.height);
    const w = image.width * ratio,
      h = image.height * ratio;
    context.drawImage(image, (pixels - w) / 2, (pixels - h) / 2, w, h);
    return {
      name: 'TinyCAD-preview.png',
      mime: 'image/png',
      data: canvas.toDataURL('image/png').split(',')[1],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
