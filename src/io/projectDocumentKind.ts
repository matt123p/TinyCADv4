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

export type ProjectTextKind = {
  kind: 'text';
  mime: string;
  language?: string;
  preview?: 'markdown' | 'table';
};

export type ProjectDocumentKind =
  | ProjectTextKind
  | { kind: 'image' | 'pdf'; mime: string };

const languageByExtension: Record<string, string> = {
  bashrc: 'bash',
  zshrc: 'bash',
  zsh: 'bash',
  fish: 'bash',
  cjs: 'javascript',
  mjs: 'javascript',
  jsx: 'javascript',
  cts: 'typescript',
  mts: 'typescript',
  tsx: 'typescript',
  jsonc: 'json',
  jsonl: 'json',
  ndjson: 'json',
  tcproject: 'xml',
  xhtml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  plist: 'xml',
  rss: 'xml',
  atom: 'xml',
  cfg: 'ini',
  desktop: 'ini',
  editorconfig: 'ini',
  gitconfig: 'ini',
  properties: 'ini',
  env: 'ini',
};

export function projectDocumentKind(name: string): ProjectDocumentKind {
  const lower = name.toLowerCase();
  const suffix = /\.([a-z0-9]+)$/.exec(lower)?.[1];
  if (suffix === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (Object.hasOwn(images, suffix))
    return { kind: 'image', mime: images[suffix] };
  if (
    suffix === 'md' ||
    suffix === 'markdown' ||
    suffix === 'mdown' ||
    suffix === 'mkd'
  )
    return {
      kind: 'text',
      mime: 'text/markdown',
      language: 'markdown',
      preview: 'markdown',
    };
  if (
    suffix === 'csv' ||
    suffix === 'tsv' ||
    suffix === 'tab' ||
    suffix === 'psv' ||
    suffix === 'ssv'
  )
    return {
      kind: 'text',
      mime:
        suffix === 'csv'
          ? 'text/csv'
          : suffix === 'tsv' || suffix === 'tab'
          ? 'text/tab-separated-values'
          : 'text/plain',
      preview: 'table',
    };

  const language = Object.hasOwn(languageByExtension, suffix)
    ? languageByExtension[suffix]
    : suffix ?? lower;
  const mime =
    language === 'json'
      ? 'application/json'
      : language === 'xml'
      ? 'application/xml'
      : 'text/plain';
  return { kind: 'text', mime, language };
}
