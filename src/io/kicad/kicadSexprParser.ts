export type SExprAtom = string | number;

export interface SExprList {
  tag: string;
  values: SExprAtom[];
  children: SExprList[];
}

type Token =
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'atom'; value: string };

function isWhitespace(ch: string) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    if (ch === ';') {
      while (i < input.length && input[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === '"') {
      let value = '';
      i += 1;
      while (i < input.length) {
        const c = input[i];
        if (c === '\\') {
          const next = input[i + 1];
          if (next === '"' || next === '\\') {
            value += next;
            i += 2;
          } else if (next === 'n') {
            value += '\n';
            i += 2;
          } else if (next === 'r') {
            value += '\r';
            i += 2;
          } else if (next === 't') {
            value += '\t';
            i += 2;
          } else {
            value += next;
            i += 2;
          }
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      tokens.push({ type: 'string', value });
      continue;
    }

    let j = i;
    while (
      j < input.length &&
      !isWhitespace(input[j]) &&
      input[j] !== '(' &&
      input[j] !== ')'
    ) {
      j += 1;
    }

    const raw = input.slice(i, j);
    const n = Number(raw);
    if (raw.length > 0 && !Number.isNaN(n) && /^[-+]?\d+(\.\d+)?$/.test(raw)) {
      tokens.push({ type: 'number', value: n });
    } else {
      tokens.push({ type: 'atom', value: raw });
    }
    i = j;
  }

  return tokens;
}

function tokenAsAtom(token: Token): SExprAtom {
  if (token.type === 'string') {
    return token.value;
  }
  if (token.type === 'number') {
    return token.value;
  }
  if (token.type === 'atom') {
    return token.value;
  }
  throw new Error('Invalid atom token');
}

function parseList(tokens: Token[], start: number): [SExprList, number] {
  if (tokens[start]?.type !== 'lparen') {
    throw new Error('Expected list start');
  }

  const tagToken = tokens[start + 1];
  if (!tagToken || (tagToken.type !== 'atom' && tagToken.type !== 'string')) {
    throw new Error('Expected list tag');
  }

  const tag = String(tokenAsAtom(tagToken));
  let index = start + 2;
  const values: SExprAtom[] = [];
  const children: SExprList[] = [];

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'rparen') {
      return [{ tag, values, children }, index + 1];
    }
    if (token.type === 'lparen') {
      const [child, nextIndex] = parseList(tokens, index);
      children.push(child);
      index = nextIndex;
      continue;
    }
    values.push(tokenAsAtom(token));
    index += 1;
  }

  throw new Error(`Unclosed list for tag "${tag}"`);
}

export function parseSexpr(input: string): SExprList {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new Error('Empty KiCad symbol file');
  }

  const [root] = parseList(tokens, 0);
  return root;
}
