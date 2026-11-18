import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { componentInventory } from './mysql-dump.mjs';
import { applyUSResistor } from './symbol-artwork.mjs';

const require = createRequire(import.meta.url);
const { DOMParser, XMLSerializer } = require('common-xml-features');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const xmlText = (value) =>
  value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
let sqlite;

export async function librarySqlite() {
  if (!sqlite)
    sqlite = require('sql.js')({
      wasmBinary: readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')),
    });
  return sqlite;
}

function nodes(parent, tag) {
  return Array.from(
    { length: parent.getElementsByTagName(tag).length },
    (_, index) => parent.getElementsByTagName(tag)[index],
  );
}
function coordinates(value) {
  const result = (Array.isArray(value) ? value : String(value).split(',')).map(
    Number,
  );
  if (result.length !== 2 || result.some((number) => !Number.isFinite(number)))
    throw new Error(`Invalid coordinates: ${value}`);
  return result;
}
function samePosition(node, expected) {
  const actual = coordinates(node.getAttribute('pos'));
  return coordinates(expected).every(
    (value, index) => Math.abs(value - actual[index]) < 1e-6,
  );
}

export function sourceComponent(data, selector, defaultAuthor) {
  if (!selector || typeof selector !== 'object')
    throw new Error('A component source selector is required.');
  const candidates = componentInventory(
    data,
    selector.author || defaultAuthor,
  ).filter((entry) =>
    selector.nameId !== undefined
      ? entry.nameId === selector.nameId
      : entry.name === selector.name &&
        (selector.description === undefined ||
          entry.description === selector.description),
  );
  if (candidates.length !== 1)
    throw new Error(
      `Source selector must match exactly one visible component (${
        candidates.length
      } matches): ${JSON.stringify(selector)}`,
    );
  const entry = candidates[0];
  return {
    entry,
    name: data.names.get(entry.nameId),
    symbol: data.symbols.get(entry.symbolId),
  };
}

export function transformSymbol(xml, component) {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  if (
    !['TinyCAD', 'TinyCADSheets'].includes(document.documentElement?.nodeName)
  )
    throw new Error(`Invalid TinyCAD XML for ${component.id}`);
  const changes = [];
  for (const edit of component.pins || []) {
    const matches = nodes(document, 'PIN').filter(
      (pin) =>
        (edit.at === undefined || samePosition(pin, edit.at)) &&
        (edit.matchNumber === undefined ||
          pin.getAttribute('number') === edit.matchNumber) &&
        (edit.matchName === undefined || pin.textContent === edit.matchName),
    );
    if (matches.length !== 1)
      throw new Error(
        `Pin edit for ${component.id} must match one pin, matched ${matches.length}.`,
      );
    const pin = matches[0];
    const before = {
      number: pin.getAttribute('number'),
      name: pin.textContent,
      at: pin.getAttribute('pos'),
    };
    if (edit.remove) pin.parentNode.removeChild(pin);
    else {
      if (edit.number !== undefined)
        pin.setAttribute('number', String(edit.number));
      if (edit.name !== undefined) {
        while (pin.firstChild) pin.removeChild(pin.firstChild);
        pin.appendChild(document.createTextNode(edit.name));
      }
      if (edit.position !== undefined)
        pin.setAttribute('pos', coordinates(edit.position).join(','));
      if (edit.length !== undefined) {
        if (!Number.isInteger(edit.length) || edit.length < 0)
          throw new Error(`Invalid pin length for ${component.id}`);
        pin.setAttribute('length', String(edit.length));
      }
      if (edit.show !== undefined) {
        if (!Number.isInteger(edit.show) || edit.show < 0 || edit.show > 3)
          throw new Error(`Invalid pin visibility for ${component.id}`);
        pin.setAttribute('show', String(edit.show));
      }
      if (edit.electrical !== undefined)
        pin.setAttribute('elec', String(edit.electrical));
    }
    changes.push({ pin: before, edit });
  }
  for (const colour of component.colours || []) {
    if (!/^#[\da-f]{6}$/i.test(colour.rgb))
      throw new Error(`Invalid RGB colour in ${component.id}`);
    const matches = nodes(document, colour.tag || 'FILL').filter(
      (node) => node.getAttribute('id') === String(colour.id),
    );
    if (matches.length !== 1)
      throw new Error(
        `Colour edit for ${component.id} must match one resource.`,
      );
    const node = matches[0].getElementsByTagName('COLOR')[0];
    if (!node) throw new Error(`Missing COLOR element in ${component.id}`);
    while (node.firstChild) node.removeChild(node.firstChild);
    const rgb = colour.rgb.slice(1);
    const bgr = (
      rgb.slice(4) +
      rgb.slice(2, 4) +
      rgb.slice(0, 2)
    ).toUpperCase();
    node.appendChild(document.createTextNode(bgr));
    changes.push({ colour });
  }
  for (const edit of component.polygons || []) {
    const matches = nodes(document, 'POLYGON').filter((node) =>
      samePosition(node, edit.at),
    );
    if (matches.length !== 1 || !['x', 'y'].includes(edit.mirror))
      throw new Error(`Invalid polygon edit for ${component.id}`);
    const points = nodes(matches[0], 'POINT');
    const axis = edit.mirror === 'x' ? 0 : 1;
    const values = points.map(
      (point) => coordinates(point.getAttribute('pos'))[axis],
    );
    const middle = (Math.min(...values) + Math.max(...values)) / 2;
    for (const point of points) {
      if (Number(point.getAttribute('arc')))
        throw new Error('Mirroring arc polygons is not supported.');
      const position = coordinates(point.getAttribute('pos'));
      position[axis] = 2 * middle - position[axis];
      point.setAttribute(
        'pos',
        position.map((value) => value.toFixed(5)).join(','),
      );
    }
    changes.push({ polygon: edit });
  }
  // Match original geometry exactly, so a changed source cannot silently patch
  // the wrong primitive. Coordinates use the XML's millimetres, not screen units.
  for (const edit of component.geometry || []) {
    if (!['RECTANGLE', 'ELLIPSE', 'POLYGON'].includes(edit.tag))
      throw new Error(`Unsupported geometry tag in ${component.id}`);
    const matches = nodes(document, edit.tag).filter((node) =>
      Object.entries(edit.match || {}).every(([key, expected]) => {
        if (!Array.isArray(expected))
          return node.getAttribute(key) === String(expected);
        const actual = coordinates(node.getAttribute(key));
        return coordinates(expected).every(
          (value, index) => Math.abs(value - actual[index]) < 1e-6,
        );
      }),
    );
    if (matches.length !== 1)
      throw new Error(
        `Geometry edit for ${component.id} must match one primitive, matched ${matches.length}.`,
      );
    const node = matches[0];
    if (edit.remove) node.parentNode.removeChild(node);
    else {
      for (const [key, value] of Object.entries(edit.set || {}))
        node.setAttribute(
          key,
          Array.isArray(value) ? coordinates(value).join(',') : String(value),
        );
      if (edit.points) {
        const points = nodes(node, 'POINT');
        if (points.length !== edit.points.length)
          throw new Error(`Geometry point count mismatch in ${component.id}`);
        points.forEach((point, index) =>
          point.setAttribute('pos', coordinates(edit.points[index]).join(',')),
        );
      }
    }
    changes.push({ geometry: edit });
  }
  if (
    component.resistorStyle !== undefined &&
    !['eu', 'us'].includes(component.resistorStyle)
  )
    throw new Error('Unknown resistor style.');
  if (component.resistorStyle === 'us') {
    applyUSResistor(document);
    changes.push({
      resistorStyle: 'us',
      base: component.baseSymbol || 'European resistor body',
    });
  }
  if (component.pinGrid !== undefined) {
    if (!Number.isFinite(component.pinGrid) || component.pinGrid <= 0)
      throw new Error(`Invalid pin grid for ${component.id}`);
    for (const pin of nodes(document, 'PIN'))
      if (
        coordinates(pin.getAttribute('pos')).some(
          (value) =>
            Math.abs(
              value / component.pinGrid - Math.round(value / component.pinGrid),
            ) > 1e-6,
        )
      )
        throw new Error(
          `Off-grid pin ${pin.getAttribute('number')} in ${component.id}`,
        );
  }
  const pins = nodes(document, 'PIN').map((pin) => ({
    number: pin.getAttribute('number'),
    name: pin.textContent || '',
    part: Number(pin.getAttribute('part') || 0),
    at: pin.getAttribute('pos'),
  }));
  for (const sheet of nodes(document, 'TinyCAD')) {
    const numbers = new Set();
    for (const pin of nodes(sheet, 'PIN')) {
      const key = `${pin.getAttribute('part') || '0'}:${pin.getAttribute(
        'number',
      )}`;
      if (!pin.getAttribute('number') || numbers.has(key))
        throw new Error(
          `Duplicate or missing pin number ${key} in ${component.id}; add an explicit pin correction to the recipe.`,
        );
      numbers.add(key);
    }
  }
  return {
    xml: changes.length ? new XMLSerializer().serializeToString(document) : xml,
    pins,
    changes,
  };
}

function attributeMap(data, id) {
  const result = new Map();
  for (const attribute of data.attributes.get(id) || []) {
    if (result.has(attribute.Name))
      throw new Error(`Duplicate attribute ${attribute.Name} in source ${id}`);
    result.set(attribute.Name, {
      AttName: attribute.Name,
      AttValue: attribute.Value ?? '',
      ShowAtt: Number(attribute.ShowAtt),
    });
  }
  return result;
}

function checkSpice(component, attributes, pins) {
  const names = new Set([...attributes.keys(), 'ref', 'refnum', 'Name']);
  const pinNames = new Set(
    pins.flatMap((pin) => [pin.number, pin.name]).filter(Boolean),
  );
  if (
    !attributes.get('$$SPICE')?.AttValue &&
    !attributes.get('$$SPICE_PROLOG')?.AttValue &&
    !attributes.get('$$SPICE_EPILOG')?.AttValue
  ) {
    throw new Error(`Component ${component.id} has no SPICE definition.`);
  }
  for (const [key, attribute] of attributes) {
    if (!['$$SPICE', '$$SPICE_PROLOG', '$$SPICE_EPILOG'].includes(key))
      continue;
    for (const match of attribute.AttValue.matchAll(/[%@]\(([^)]+)\)/g))
      if (!pinNames.has(match[1]))
        throw new Error(`Unknown SPICE pin ${match[1]} in ${component.id}`);
    for (const match of attribute.AttValue.matchAll(/\$\(([^)]+)\)/g))
      if (!names.has(match[1]))
        throw new Error(
          `Unknown SPICE attribute ${match[1]} in ${component.id}`,
        );
  }
}

/** Pure recipe application. Source/account records are never copied to output. */
export function buildLibraryModel(data, recipe, sourceHash) {
  if (
    recipe.version !== 1 ||
    typeof recipe.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(recipe.id) ||
    typeof recipe.name !== 'string' ||
    !recipe.name.trim() ||
    !Array.isArray(recipe.components) ||
    !recipe.components.length
  )
    throw new Error('Invalid library recipe.');
  const names = [];
  const symbols = [];
  const entries = [];
  const ids = new Set();
  const definitions = new Map();
  for (const component of recipe.components) {
    if (
      typeof component.id !== 'string' ||
      !component.id ||
      ids.has(component.id) ||
      (component.name !== undefined &&
        (typeof component.name !== 'string' || !component.name.trim()))
    )
      throw new Error(
        'Each recipe component requires a unique id and an optional nonempty display name.',
      );
    ids.add(component.id);
    const source = sourceComponent(data, component.source, recipe.author);
    const donor = component.spiceFrom
      ? sourceComponent(data, component.spiceFrom)
      : null;
    const transformed = transformSymbol(xmlText(source.symbol.Data), {
      ...component,
      pinGrid: component.pinGrid ?? recipe.pinGrid,
    });
    const attributes = attributeMap(data, source.entry.nameId);
    const referenceAttribute = attributes.get('Reference');
    attributes.delete('Reference');
    if (donor)
      for (const [name, attribute] of attributeMap(data, donor.entry.nameId))
        if (!['Reference', 'Package'].includes(name))
          attributes.set(name, { ...attribute });
    for (const name of component.removeAttributes || [])
      attributes.delete(name);
    for (const attribute of attributes.values()) {
      for (const [previous, replacement] of Object.entries(
        component.attributeRenames || {},
      ))
        attribute.AttValue = attribute.AttValue.replaceAll(
          `$(${previous})`,
          `$(${replacement})`,
        );
    }
    for (const [name, input] of Object.entries(component.attributes || {})) {
      const value =
        input && typeof input === 'object' ? input : { value: input };
      attributes.set(name, {
        AttName: name,
        AttValue: String(value.value ?? ''),
        ShowAtt:
          value.show ??
          attributes.get(name)?.ShowAtt ??
          (name.startsWith('$$') ? 2 : 1),
      });
    }
    // Directive-only symbols deliberately emit a comment, avoiding NO_MODEL warnings.
    if (
      recipe.requireSpice &&
      !attributes.get('$$SPICE')?.AttValue &&
      (attributes.get('$$SPICE_PROLOG')?.AttValue ||
        attributes.get('$$SPICE_EPILOG')?.AttValue)
    )
      attributes.set('$$SPICE', {
        AttName: '$$SPICE',
        AttValue: '*',
        ShowAtt: 2,
      });
    if (recipe.requireSpice)
      checkSpice(component, attributes, transformed.pins);
    const definitionHash = sha256(transformed.xml);
    if (!definitions.has(definitionHash)) {
      const id = symbols.length + 1;
      definitions.set(definitionHash, id);
      symbols.push({ SymbolId: id, Data: transformed.xml });
    }
    const name = {
      NameID: names.length + 1,
      Name: component.name || source.entry.name,
      SymbolID: definitions.get(definitionHash),
      Type: 0,
      Reference: component.reference || referenceAttribute?.AttValue || 'U?',
      ppp: Number(source.symbol.ppp),
      Description: component.description || source.name.Description,
      ShowName: component.showName ?? recipe.showName ?? 0,
      ShowRef: component.showRef ?? referenceAttribute?.ShowAtt ?? 0,
      DefRotate: Number(source.symbol.DefRotate),
      Attributes: [...attributes.values()],
    };
    names.push(name);
    const provenance = (selected) => ({
      nameId: selected.entry.nameId,
      symbolId: selected.entry.symbolId,
      author: selected.entry.author,
      name: selected.entry.name,
      description: selected.entry.description,
      xmlSha256: sha256(xmlText(selected.symbol.Data)),
    });
    entries.push({
      id: component.id,
      name: name.Name,
      nameId: name.NameID,
      symbolId: name.SymbolID,
      source: provenance(source),
      ...(donor ? { spiceFrom: provenance(donor) } : {}),
      notes: component.notes || '',
      changes: transformed.changes,
      pins: transformed.pins,
      xmlSha256: definitionHash,
    });
  }
  return {
    library: { name: recipe.name, names, symbols },
    provenance: {
      version: 1,
      id: recipe.id,
      name: recipe.name,
      sourceSha256: sourceHash,
      recipeSha256: sha256(JSON.stringify(recipe)),
      contributors: [
        ...new Set(
          entries
            .flatMap((entry) => [entry.source.author, entry.spiceFrom?.author])
            .filter(Boolean),
        ),
      ],
      notes: recipe.notes || '',
      references: recipe.references || [],
      entries,
    },
  };
}

export async function serializeLibrary(library, provenance) {
  const SQL = await librarySqlite();
  const db = new SQL.Database();
  try {
    db.run(
      'CREATE TABLE Name (NameID INTEGER PRIMARY KEY, Name TEXT, SymbolID INTEGER, Type INTEGER, Reference TEXT, ppp INTEGER, Description TEXT, ShowName INTEGER, ShowRef INTEGER, DefRotate INTEGER)',
    );
    db.run('CREATE TABLE Symbol (SymbolID INTEGER PRIMARY KEY, Data BLOB)');
    db.run(
      'CREATE TABLE Attribute (NameID INTEGER, AttName TEXT, AttValue TEXT, ShowAtt INTEGER)',
    );
    db.run(
      'CREATE TABLE TinyCADBundleInfo (Key TEXT PRIMARY KEY, Value TEXT NOT NULL)',
    );
    db.run('INSERT INTO TinyCADBundleInfo VALUES (?, ?)', [
      'provenance',
      JSON.stringify(provenance),
    ]);
    const nameStatement = db.prepare(
      'INSERT INTO Name VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const attributeStatement = db.prepare(
      'INSERT INTO Attribute VALUES (?, ?, ?, ?)',
    );
    const symbolStatement = db.prepare('INSERT INTO Symbol VALUES (?, ?)');
    for (const name of library.names) {
      nameStatement.run([
        name.NameID,
        name.Name,
        name.SymbolID,
        0,
        name.Reference,
        name.ppp,
        name.Description,
        name.ShowName,
        name.ShowRef,
        name.DefRotate,
      ]);
      for (const attribute of name.Attributes)
        attributeStatement.run([
          name.NameID,
          attribute.AttName,
          attribute.AttValue,
          attribute.ShowAtt,
        ]);
    }
    for (const symbol of library.symbols)
      symbolStatement.run([
        symbol.SymbolId,
        new TextEncoder().encode(symbol.Data),
      ]);
    [nameStatement, attributeStatement, symbolStatement].forEach((statement) =>
      statement.free(),
    );
    return db.export();
  } finally {
    db.close();
  }
}
