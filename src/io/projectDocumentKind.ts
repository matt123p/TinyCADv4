const images: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

export type ProjectDocumentKind =
  | { kind: 'text'; markdown: boolean; mime: string }
  | { kind: 'image' | 'pdf'; mime: string };

export function projectDocumentKind(
  name: string,
): ProjectDocumentKind | undefined {
  const suffix = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  if (!suffix) return;
  if (suffix === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (Object.hasOwn(images, suffix))
    return { kind: 'image', mime: images[suffix] };
  if (suffix === 'md' || suffix === 'markdown')
    return { kind: 'text', markdown: true, mime: 'text/markdown' };
  if (suffix === 'csv')
    return { kind: 'text', markdown: false, mime: 'text/csv' };
  if (suffix === 'tsv')
    return { kind: 'text', markdown: false, mime: 'text/tab-separated-values' };
  if (suffix === 'txt' || suffix === 'log')
    return { kind: 'text', markdown: false, mime: 'text/plain' };
  if (suffix === 'xml' || suffix === 'tcproject' || suffix === 'json')
    return { kind: 'text', markdown: false, mime: suffix !== 'json' ? 'application/xml' : 'application/json' };
}
