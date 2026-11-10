import { Lexer } from 'marked';
export { extractReleaseNotes } from './changelog.mjs';

/** Plain text for Store listings; keep readable bullets without Markdown markup. */
export function plainReleaseNotes(markdown) {
  const inline = (tokens) =>
    tokens
      .map((token) => {
        if (token.type === 'html')
          throw new Error('Use Markdown rather than HTML in release notes.');
        if (token.type === 'br') return '\n';
        if (token.tokens) return inline(token.tokens);
        return token.text ?? '';
      })
      .join('');
  const blocks = (tokens) =>
    tokens
      .map((token) => {
        switch (token.type) {
          case 'space':
          case 'def':
            return '';
          case 'heading':
          case 'paragraph':
            return `${inline(token.tokens)}\n\n`;
          case 'text':
            return `${token.tokens ? inline(token.tokens) : token.text}\n`;
          case 'code':
            return `${token.text}\n\n`;
          case 'blockquote':
            return blocks(token.tokens);
          case 'hr':
            return '\n';
          case 'list':
            return (
              token.items
                .map((item, index) => {
                  const prefix = token.ordered
                    ? `${Number(token.start) + index}. `
                    : '• ';
                  const text = blocks(item.tokens).trim();
                  return (
                    prefix +
                    (item.task ? (item.checked ? '[x] ' : '[ ] ') : '') +
                    text.replace(/\n/g, '\n  ')
                  );
                })
                .join('\n') + '\n\n'
            );
          case 'table':
            return (
              [token.header, ...token.rows]
                .map((row) =>
                  row.map((cell) => inline(cell.tokens)).join(' | '),
                )
                .join('\n') + '\n\n'
            );
          default:
            throw new Error(`Unsupported release-note block: ${token.type}`);
        }
      })
      .join('');
  return blocks(Lexer.lex(markdown))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Change only English release notes in a full MSIX submission returned by the CLI. */
export function withStoreReleaseNotes(submission, notes) {
  if (typeof notes !== 'string' || !notes.trim())
    throw new Error('Store release notes are empty.');
  if (notes.trim().length > 1500)
    throw new Error('Store release notes exceed the 1500-character limit. Shorten the changelog entry.');
  const updated = structuredClone(submission);
  const listings = updated?.Listings ?? updated?.listings;
  if (!listings || typeof listings !== 'object' || Array.isArray(listings)) {
    throw new Error('The Store submission has no listings.');
  }
  const languages = Object.keys(listings).filter((language) =>
    /^en(?:-|$)/i.test(language),
  );
  if (!languages.length)
    throw new Error(
      'No English Store listing found; English changelog notes cannot replace translated notes.',
    );
  for (const language of languages) {
    const listing = listings[language];
    const base = listing?.BaseListing ?? listing?.baseListing;
    if (!base || typeof base !== 'object' || Array.isArray(base)) {
      throw new Error(`Store listing ${language} has no base listing.`);
    }
    const key = Object.hasOwn(base, 'ReleaseNotes')
      ? 'ReleaseNotes'
      : Object.hasOwn(base, 'releaseNotes')
      ? 'releaseNotes'
      : Object.hasOwn(listing, 'BaseListing')
      ? 'ReleaseNotes'
      : 'releaseNotes';
    base[key] = notes.trim();
  }
  return { submission: updated, languages };
}
