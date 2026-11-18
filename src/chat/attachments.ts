import { Attachment, ProviderKind } from './types';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export function validateAttachments(files: File[]): void {
  if (
    files.length > 6 ||
    files.reduce((n, f) => n + f.size, 0) > MAX_ATTACHMENT_BYTES
  )
    throw new Error('Attach up to six files, totaling at most 10 MiB.');
  for (const file of files)
    if (!allowed.includes(file.type))
      throw new Error(
        `${file.name}: Supported imports: PDF, PNG, JPEG and WebP.`,
      );
}
export async function readAttachments(
  files: File[],
  provider: ProviderKind = 'openai',
  pages = '',
  signal = new AbortController().signal,
): Promise<Attachment[]> {
  validateAttachments(files);
  const converted: Attachment[] = [];
  for (const file of files) {
    if (
      file.type === 'application/pdf' &&
      ['compatible', 'ollama'].includes(provider)
    ) {
      const { pdfImages } = await import('./pdf-import');
      converted.push(...(await pdfImages(file, pages, signal)));
    } else
      converted.push(
        await new Promise<Attachment>((resolve, reject) => {
          if (!allowed.includes(file.type)) {
            reject(new Error('Supported imports: PDF, PNG, JPEG and WebP.'));
            return;
          }
          const reader = new FileReader();
          reader.onerror = () =>
            reject(new Error(`Could not read ${file.name}.`));
          reader.onload = () =>
            resolve({
              name: file.name,
              mime: file.type,
              data: String(reader.result).split(',')[1],
            });
          reader.readAsDataURL(file);
        }),
      );
  }
  if (
    converted.reduce((n, f) => n + Math.ceil((f.data.length * 3) / 4), 0) >
    MAX_ATTACHMENT_BYTES
  )
    throw new Error(
      'Converted PDF images exceed 10 MiB. Choose fewer PDF pages.',
    );
  return converted;
}
