// Read phpMyAdmin/MySQL INSERT data without executing any SQL from the dump.
// Filtering by table avoids decoding unrelated application/account records.
export function* sqlStatements(text) {
  let start = 0;
  let quote = null;
  let comment = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (comment === 'line') {
      if (char === '\n') comment = null;
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = null;
        i++;
      }
      continue;
    }
    if (quote) {
      if (char === '\\' && quote !== '`') {
        i++;
        continue;
      }
      if (char === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (
      char === '#' ||
      (char === '-' && next === '-' && /\s/.test(text[i + 2] || ' '))
    ) {
      comment = 'line';
      continue;
    }
    if (char === '/' && next === '*') {
      comment = 'block';
      i++;
      continue;
    }
    if (char === ';') {
      yield text.slice(start, i);
      start = i + 1;
    }
  }
  if (quote || comment === 'block')
    throw new Error('Unterminated SQL string or comment.');
  if (text.slice(start).trim()) yield text.slice(start);
}

function skip(text, offset) {
  while (offset < text.length) {
    if (/\s/.test(text[offset])) {
      offset++;
      continue;
    }
    if (
      text[offset] === '#' ||
      text.startsWith('-- ', offset) ||
      text.startsWith('--\n', offset) ||
      text.startsWith('--\r', offset)
    ) {
      const end = text.indexOf('\n', offset);
      offset = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('/*', offset)) {
      const end = text.indexOf('*/', offset + 2);
      if (end < 0) throw new Error('Unterminated SQL comment.');
      offset = end + 2;
      continue;
    }
    break;
  }
  return offset;
}

function identifier(text, offset) {
  offset = skip(text, offset);
  if (text[offset] === '`') {
    let value = '';
    offset++;
    while (offset < text.length) {
      if (text[offset] === '`') {
        if (text[offset + 1] === '`') {
          value += '`';
          offset += 2;
          continue;
        }
        return { value, offset: offset + 1 };
      }
      value += text[offset++];
    }
    throw new Error('Unterminated SQL identifier.');
  }
  const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(offset));
  if (!match) throw new Error('Expected a SQL identifier.');
  return { value: match[0], offset: offset + match[0].length };
}

function value(text, offset) {
  offset = skip(text, offset);
  const binary = /^_[A-Za-z0-9]+\s*(?=['"])/.exec(text.slice(offset));
  if (binary) offset += binary[0].length;
  const quote = text[offset];
  if (quote === "'" || quote === '"') {
    let result = '';
    offset++;
    const escapes = { 0: '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
    while (offset < text.length) {
      const char = text[offset++];
      if (char === quote) {
        if (text[offset] === quote) {
          result += quote;
          offset++;
          continue;
        }
        return { value: result, offset };
      }
      if (char === '\\') {
        const escaped = text[offset++];
        if (escaped === undefined) throw new Error('Unterminated SQL escape.');
        result += Object.hasOwn(escapes, escaped)
          ? escapes[escaped]
          : ['%', '_'].includes(escaped)
          ? '\\' + escaped
          : escaped;
      } else result += char;
    }
    throw new Error('Unterminated SQL value.');
  }
  const token = /^[^,\s()]+/.exec(text.slice(offset))?.[0];
  if (!token) throw new Error('Expected a SQL value.');
  offset += token.length;
  if (/^NULL$/i.test(token)) return { value: null, offset };
  if (/^(TRUE|FALSE)$/i.test(token))
    return { value: /^TRUE$/i.test(token) ? 1 : 0, offset };
  if (/^0x(?:[\da-f]{2})+$/i.test(token))
    return {
      value: new Uint8Array(Buffer.from(token.slice(2), 'hex')),
      offset,
    };
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) {
    const number = Number(token);
    return {
      value:
        Number.isInteger(number) && !Number.isSafeInteger(number)
          ? token
          : number,
      offset,
    };
  }
  throw new Error(`Unsupported SQL value token: ${token.slice(0, 30)}`);
}

/** @param {string} text @param {Set<string>} tables */
export function* readMysqlRows(text, tables) {
  for (const statement of sqlStatements(text)) {
    let offset = skip(statement, 0);
    const insert = /^INSERT(?:\s+IGNORE)?\s+INTO\s+/i.exec(
      statement.slice(offset),
    );
    if (!insert) continue;
    offset += insert[0].length;
    let table = identifier(statement, offset);
    offset = skip(statement, table.offset);
    if (statement[offset] === '.') {
      table = identifier(statement, offset + 1);
      offset = skip(statement, table.offset);
    }
    const name = table.value.toLowerCase();
    if (!tables.has(name)) continue;
    if (statement[offset++] !== '(')
      throw new Error(`INSERT for ${name} must include column names.`);
    const columns = [];
    while (true) {
      const column = identifier(statement, offset);
      columns.push(column.value);
      offset = skip(statement, column.offset);
      const delimiter = statement[offset++];
      if (delimiter === ')') break;
      if (delimiter !== ',')
        throw new Error(`Invalid column list for ${name}.`);
    }
    offset = skip(statement, offset);
    const values = /^VALUES\s*/i.exec(statement.slice(offset));
    if (!values) throw new Error(`INSERT for ${name} must use literal VALUES.`);
    offset += values[0].length;
    while (true) {
      offset = skip(statement, offset);
      if (statement[offset++] !== '(')
        throw new Error(`Expected a row in ${name}.`);
      const row = [];
      while (true) {
        const field = value(statement, offset);
        row.push(field.value);
        offset = skip(statement, field.offset);
        const delimiter = statement[offset++];
        if (delimiter === ')') break;
        if (delimiter !== ',')
          throw new Error(`Invalid row delimiter in ${name}.`);
      }
      if (row.length !== columns.length)
        throw new Error(`Column count mismatch in ${name}.`);
      yield {
        table: name,
        row: Object.fromEntries(
          columns.map((column, index) => [column, row[index]]),
        ),
      };
      offset = skip(statement, offset);
      if (offset === statement.length) break;
      if (statement[offset++] !== ',')
        throw new Error(`Unexpected content after an INSERT row in ${name}.`);
    }
  }
}

export function readComponentDump(text) {
  const users = new Map();
  const symbols = new Map();
  const names = new Map();
  const attributes = new Map();
  for (const { table, row } of readMysqlRows(
    text,
    new Set(['aspnetusers', 'symbol', 'symbolname', 'symbolattribute']),
  )) {
    if (table === 'aspnetusers') users.set(row.Id, row.UserName);
    else if (table === 'symbol') symbols.set(row.SymbolID, row);
    else if (table === 'symbolname') names.set(row.NameID, row);
    else {
      if (!attributes.has(row.NameID)) attributes.set(row.NameID, []);
      attributes.get(row.NameID).push(row);
    }
  }
  return { users, symbols, names, attributes };
}

export function componentInventory(data, author) {
  const authors = author
    ? new Set(
        [...data.users]
          .filter(([, name]) => name?.toLowerCase() === author.toLowerCase())
          .map(([id]) => id),
      )
    : null;
  if (authors && !authors.size)
    throw new Error(`Unknown component author: ${author}`);
  return [...data.names.values()]
    .filter((name) => !name.Hidden && data.symbols.has(name.SymbolID))
    .filter(
      (name) =>
        !authors ||
        authors.has(name.AuthorId) ||
        authors.has(data.symbols.get(name.SymbolID).Owner_Id),
    )
    .map((name) => ({
      nameId: name.NameID,
      symbolId: name.SymbolID,
      name: name.Name,
      description: name.Description,
      author:
        data.users.get(name.AuthorId) ||
        data.users.get(data.symbols.get(name.SymbolID).Owner_Id),
      attributes: (data.attributes.get(name.NameID) || []).map((attribute) => ({
        name: attribute.Name,
        value: attribute.Value,
        show: attribute.ShowAtt,
      })),
    }));
}
