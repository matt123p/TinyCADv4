import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareCatalog,
  initialState,
  geometry,
  rankCandidates,
  spiceArtworkSnapshot,
} from '../symbol-review/catalog.mjs';
import {
  DecisionStore,
  validateDecision,
  validateState,
  progress,
} from '../symbol-review/decisions.mjs';
import { createReviewServer } from '../symbol-review/server.mjs';
import { librarySqlite } from '../lib/library-from-sql.mjs';
// Node fetch can replace a supplied Host header. Use the HTTP client so these
// tests exercise the actual Host that a Coder proxy forwards.
function requestReview(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: options.method || 'GET', headers: options.headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode,
            json: async () => JSON.parse(text),
            text: async () => text,
          });
        });
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const xml =
  '<TinyCAD><STYLE id="1"><THICKNESS>1</THICKNESS></STYLE><PIN pos="0,0" number="1" part="0" length="7" which="0">1</PIN><PIN pos="0,8" number="2" part="0" length="7" which="0">2</PIN><RECTANGLE a="-1,1.4" b="1,6.6" style="1"/></TinyCAD>';
const escape = (value) => "'" + String(value).replaceAll("'", "''") + "'";
let directory, catalog;
test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tinycad-symbol-review-'));
  const sql = `INSERT INTO aspnetusers (Id,UserName,Email,LoginKey) VALUES ('owner','onetransistor','PRIVATE-EMAIL','PRIVATE-LOGIN');
INSERT INTO symbol (SymbolID,Data,Owner_Id,ppp,DefRotate) VALUES (900001,${escape(
    xml,
  )},'owner',1,0),(900002,${escape(
    xml.replace('pos="0,8"', 'pos="0,8.3"'),
  )},'owner',1,0);
INSERT INTO symbolname (NameID,SymbolID,Hidden,Name,Description,AuthorId) VALUES (910001,900001,0,'LDR','Light dependent resistor','owner'),(910002,900001,0,'Photoresistor','Second name, same artwork','owner'),(910003,900002,0,'LDR alternate','Off-grid sensor','owner');`;
  const file = path.join(directory, 'fixture.sql');
  await writeFile(file, sql);
  catalog = await prepareCatalog({
    root,
    sql: file,
    cache: path.join(directory, 'cache'),
  });
});
test.after(async () => rm(directory, { recursive: true, force: true }));

test('master IDs share exactly one decision across every course; reuse has explicit terminal maps', () => {
  const state = initialState(catalog),
    summary = progress(catalog, state);
  assert.equal(catalog.requirements.length, 112);
  assert.equal(Object.keys(state.decisions).length, 112);
  assert.deepEqual(
    [summary.reuse, summary.native, summary.pending],
    [35, 6, 71],
  );
  assert.equal(summary.artworkComplete, false);
  const npn = catalog.candidates.find((c) => c.id === 'spice:npn');
  assert.equal(
    npn.metrics.pins.find((p) => p.key === state.decisions.bjt_npn.pinMap['2'])
      .number,
    '3',
  );
  const pot = catalog.candidates.find((c) => c.id === 'spice:potentiometer');
  assert.equal(
    pot.metrics.pins.find(
      (p) => p.key === state.decisions.potentiometer.pinMap['2'],
    ).number,
    '3',
  );
  assert.equal(state.decisions.ground.status, 'native');
  assert.equal(state.decisions.led.variants.length, 4);
  assert.equal(state.decisions.opamp.modelReviewRequired, true);
  assert.equal(state.decisions.comparator.modelReuseAllowed, false);
  assert.equal(state.decisions.behavioural_voltage.modelReuseAllowed, false);
  assert.equal(state.decisions.capacitor_plates.candidateId, 'spice:capacitor');
  assert.equal(state.decisions.ldr.source.kind, 'derived');
  assert.deepEqual(state.decisions.ldr.variants, [
    'derived:ldr-eu',
    'derived:ldr-us',
  ]);
  assert.equal(state.decisions.jfet_n.source.baseCandidateId, 'spice:nmos');
  assert.deepEqual(state.decisions.resistor.variants, [
    'spice:resistor',
    'spice:resistor-us',
  ]);
  assert.ok(
    catalog.requirements.find((r) => r.id === 'ldr').used_by_libraries.length >
      1,
  );
  assert.throws(
    () => validateDecision(catalog, 'resistor', { status: 'pending' }),
    /fixed/,
  );
  assert.throws(
    () => validateDecision(catalog, 'not-a-symbol', { status: 'pending' }),
    /Unknown/,
  );
});
test('SQL geometry is grouped once and private account fields are not exported', async () => {
  assert.equal(catalog.candidates.filter((c) => c.kind === 'sql').length, 2);
  assert.equal(
    catalog.candidates.find((c) => c.id === 'sql:900001').names.length,
    2,
  );
  const output = await readFile(
    path.join(directory, 'cache/catalog.json'),
    'utf8',
  );
  assert.ok(!output.includes('PRIVATE-EMAIL'));
  assert.ok(!output.includes('PRIVATE-LOGIN'));
  assert.equal(
    await readFile(
      path.join(directory, 'cache/artwork/sql-900001.xml'),
      'utf8',
    ),
    xml,
  );
});
test('style measurements distinguish offset origins, bad spacing, duplicates and hidden terminals', () => {
  const original = geometry(xml);
  assert.equal(original.relativeGrid, true);
  assert.equal(original.absoluteGrid, true);
  assert.equal(original.leadMm, 1.4);
  assert.ok(Math.abs(original.bodyHeightMm - 5.2) < 1e-9);
  const translated = geometry(xml.replaceAll('pos="0,', 'pos="0.5,'));
  assert.equal(translated.relativeGrid, true);
  assert.equal(translated.absoluteGrid, false);
  assert.equal(
    geometry(xml.replace('pos="0,8"', 'pos="0,8.3"')).relativeGrid,
    false,
  );
  assert.equal(
    geometry(xml.replace('number="2"', 'number="1"')).duplicatePins,
    true,
  );
  assert.equal(
    geometry(xml.replace('which="0"', 'which="5"')).pins[0].hidden,
    true,
  );
  assert.equal(geometry('<invalid/>').valid, false);
});
test('ranking finds semantic matches and does not match ordinary prose as an AND gate', () => {
  const target = catalog.requirements.find((r) => r.id === 'ldr'),
    matches = rankCandidates(catalog, target);
  assert.equal(matches[0].id, 'sql:900001');
  assert.equal(matches[0].sourceNameId, 910001);
  assert.ok(
    matches
      .find((c) => c.id === 'sql:900002')
      .flags.includes('Relative pin spacing needs grid repair'),
  );
  assert.ok(
    !rankCandidates(
      catalog,
      catalog.requirements.find((r) => r.id === 'gate_and'),
    ).some((c) => c.id === 'spice:ua741'),
  );
  assert.equal(
    rankCandidates(catalog, target, { query: 'onetransistor does not exist' })
      .length,
    0,
  );
  assert.equal(
    rankCandidates(catalog, target, { query: '910002' })[0].sourceNameId,
    910002,
  );
  assert.equal(
    rankCandidates(catalog, target, { query: 'onetransistor LDR' })[0].id,
    'sql:900001',
  );
  assert.ok(
    rankCandidates(catalog, target, { query: '900001' }).some(
      (c) => c.id === 'sql:900001',
    ),
  );
  assert.ok(
    rankCandidates(catalog, target, { all: true }).length > matches.length,
  );
});
function chosen() {
  const c = catalog.candidates.find((c) => c.id === 'sql:900001');
  return {
    status: 'chosen',
    candidateId: c.id,
    sourceNameId: 910001,
    xmlSha256: c.xmlSha256,
    pinMap: { 1: '0:0:1', 2: '0:0:2' },
    requiresAdaptation: false,
    note: 'Thin IEC body matches SPICE.',
  };
}
test('saved choices validate source identity, logical pin semantics and explicit adaptations', () => {
  const d = validateDecision(catalog, 'thermocouple', chosen());
  assert.equal(d.source.nameId, 910001);
  assert.equal(d.modelReviewRequired, true);
  const imported = initialState(catalog);
  imported.decisions.thermocouple = { ...chosen(), source: { nameId: 123 } };
  assert.equal(
    validateState(catalog, imported).decisions.thermocouple.source.nameId,
    910001,
  );
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', {
        ...chosen(),
        pinMap: { 1: '0:0:1', 2: '0:0:1' },
      }),
    /two logical/,
  );
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', {
        ...chosen(),
        pinMap: { 1: 'unknown' },
      }),
    /Unknown source/,
  );
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', {
        ...chosen(),
        pinMap: { 1: '0:0:1' },
      }),
    /adaptation/,
  );
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', {
        ...chosen(),
        sourceNameId: 123,
      }),
    /does not belong/,
  );
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', {
        ...chosen(),
        xmlSha256: 'stale',
      }),
    /changed/,
  );
  const adapted = validateDecision(catalog, 'thermocouple', {
    ...chosen(),
    pinMap: {},
    requiresAdaptation: true,
    adaptationNotes: 'Add two named grid-aligned terminals.',
  });
  assert.equal(adapted.requiresAdaptation, true);
  assert.throws(
    () =>
      validateDecision(catalog, 'thermocouple', { status: 'needs-drawing' }),
    /Describe/,
  );
  assert.equal(
    validateDecision(catalog, 'thermocouple', {
      status: 'needs-drawing',
      note: 'No suitable source.',
    }).status,
    'needs-drawing',
  );
  assert.throws(
    () =>
      validateState(catalog, {
        ...initialState(catalog),
        inventorySha256: 'changed',
      }),
    /snapshot changed/,
  );
});
test('SPICE identity follows artwork, not SQLite packaging metadata', async () => {
  const bytes = await readFile(
    path.join(root, 'bundled-libraries/spice/spice.tclib'),
  );
  const provenance = JSON.parse(
    await readFile(
      path.join(root, 'bundled-libraries/spice/spice.provenance.json'),
      'utf8',
    ),
  );
  const original = await spiceArtworkSnapshot(bytes, provenance);
  const SQL = await librarySqlite(),
    db = new SQL.Database(new Uint8Array(bytes));
  try {
    db.run('CREATE TABLE ReviewPackagingFixture (Value TEXT)');
    const repacked = await spiceArtworkSnapshot(db.export(), provenance);
    assert.equal(repacked.fingerprint, original.fingerprint);
    const symbol = db.exec('SELECT SymbolID,Data FROM Symbol LIMIT 1')[0]
      .values[0];
    db.run('UPDATE Symbol SET Data=? WHERE SymbolID=?', [
      new TextEncoder().encode(new TextDecoder().decode(symbol[1]) + ' '),
      symbol[0],
    ]);
    assert.notEqual(
      (await spiceArtworkSnapshot(db.export(), provenance)).fingerprint,
      original.fingerprint,
    );
  } finally {
    db.close();
  }
});

test('atomic decision writes survive restart and reject stale/external overwrites', async () => {
  const file = path.join(directory, 'atomic-choices.json'),
    store = await new DecisionStore(catalog, file).open();
  await store.save('thermocouple', chosen(), 0);
  const reloaded = await new DecisionStore(catalog, file).open();
  assert.equal(reloaded.state.decisions.thermocouple.candidateId, 'sql:900001');
  assert.equal(reloaded.state.revision, 1);
  await assert.rejects(
    store.save('thermocouple', { status: 'pending' }, 0),
    /another tab/,
  );
  const before = await readFile(file, 'utf8');
  await writeFile(file, before + '\n');
  await assert.rejects(
    store.save('thermocouple', { status: 'pending' }, 1),
    /edited outside/,
  );
  assert.equal(await readFile(file, 'utf8'), before + '\n');
});
test('local and Coder HTTP workflows, global choice reuse, exports, imports and access guards', async () => {
  const store = await new DecisionStore(
    catalog,
    path.join(directory, 'http-choices.json'),
  ).open();
  const server = createReviewServer({
    catalog,
    store,
    cache: path.join(directory, 'cache'),
    root,
    proxyUri: 'https://{{port}}--review.coder.example/',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const meta = await (await requestReview(base + '/api/catalog')).json();
    assert.equal(meta.requirements.length, 112);
    const results = await (
      await requestReview(base + '/api/candidates?symbol=ldr&pins=1')
    ).json();
    assert.equal(results.candidates[0].id, 'sql:900001');
    assert.equal(
      (await requestReview(base + '/api/artwork/sql%3A900001')).status,
      200,
    );
    assert.equal(
      (await requestReview(base + '/api/artwork/..%2F..%2Fpackage.json'))
        .status,
      404,
    );
    assert.equal((await requestReview(base + '/../package.json')).status, 404);
    const headers = {
      'content-type': 'application/json',
      'x-symbol-review': '1',
    };
    assert.equal(
      (
        await requestReview(base + '/api/decisions/thermocouple', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await requestReview(base + '/api/decisions/thermocouple', {
          method: 'PUT',
          headers: { ...headers, origin: 'https://unrelated.invalid' },
          body: '{}',
        })
      ).status,
      403,
    );
    const saved = await requestReview(base + '/api/decisions/thermocouple', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: 0, decision: chosen() }),
    });
    assert.equal(saved.status, 200);
    const result = await saved.json();
    assert.equal(result.progress.chosen, 1);
    assert.equal(result.state.decisions.thermocouple.source.nameId, 910001);
    assert.equal(
      (
        await requestReview(base + '/api/decisions/thermocouple', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ revision: 0, decision: chosen() }),
        })
      ).status,
      409,
    );
    const exported = await (await requestReview(base + '/api/export')).json();
    assert.deepEqual(exported, result.state);
    const imported = await requestReview(base + '/api/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ revision: 1, state: exported }),
    });
    assert.equal(imported.status, 200);
    const native = await requestReview(base + '/api/decisions/ground', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ revision: 2, decision: { status: 'chosen' } }),
    });
    assert.equal(native.status, 400);
    const html = await requestReview(base + '/');
    assert.equal(html.status, 200);
    assert.ok((await html.text()).includes('Choose once.'));
    const forwardedHost = server.address().port + '--review.coder.example';
    const forwardedOrigin = 'https://' + forwardedHost;
    assert.equal(
      (await requestReview(base + '/', { headers: { host: forwardedHost } }))
        .status,
      200,
    );
    assert.equal(
      (
        await requestReview(base + '/app.mjs', {
          headers: { host: forwardedHost },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await requestReview(base + '/api/state', {
          headers: { host: forwardedHost },
        })
      ).status,
      200,
    );
    const forwardedHeaders = {
      ...headers,
      host: forwardedHost,
      origin: forwardedOrigin,
    };
    const forwardedSave = await requestReview(
      base + '/api/decisions/piezo_sensor',
      {
        method: 'PUT',
        headers: forwardedHeaders,
        body: JSON.stringify({
          revision: 2,
          decision: { status: 'needs-drawing', note: 'Forwarded save test.' },
        }),
      },
    );
    assert.equal(forwardedSave.status, 200);
    const forwardedState = (await forwardedSave.json()).state;
    // Some proxies rewrite Host to localhost while preserving the browser Origin.
    assert.equal(
      (
        await requestReview(base + '/api/import', {
          method: 'POST',
          headers: { ...headers, origin: forwardedOrigin },
          body: JSON.stringify({ revision: 3, state: forwardedState }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await requestReview(base + '/api/state', {
          headers: { host: forwardedHost + '.unrelated.invalid' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await requestReview(base + '/api/import', {
          method: 'POST',
          headers: {
            ...forwardedHeaders,
            origin: 'https://unrelated.invalid',
            'x-forwarded-host': forwardedHost,
          },
          body: JSON.stringify({ revision: 4, state: forwardedState }),
        })
      ).status,
      403,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('resistance-wire keeps one explicit EU or US choice; other resistor families keep both', async () => {
  const store = await new DecisionStore(
    catalog,
    path.join(directory, 'wire-style-choices.json'),
  ).open();
  const choice = (style) => {
    const c = catalog.candidates.find(
      (c) => c.id === 'spice:resistor' + (style === 'us' ? '-us' : ''),
    );
    return {
      status: 'chosen',
      candidateId: c.id,
      sourceNameId: c.bundleNameId,
      xmlSha256: c.xmlSha256,
      pinMap: { 1: '0:0:1', 2: '0:0:2' },
      requiresAdaptation: false,
    };
  };
  assert.deepEqual(
    catalog.requirements.find((r) => r.id === 'resistance_wire').artworkChoice
      .candidateIds,
    ['spice:resistor', 'spice:resistor-us'],
  );
  await store.save('resistance_wire', choice('eu'), 0);
  assert.equal(store.state.decisions.resistance_wire.resistorStyle, 'eu');
  await store.save('resistance_wire', choice('us'), 1);
  assert.equal(store.state.decisions.resistance_wire.resistorStyle, 'us');
  assert.equal(
    store.state.decisions.resistance_wire.candidateId,
    'spice:resistor-us',
  );
  assert.equal(store.state.decisions.resistance_wire.variants, undefined);
  assert.deepEqual(store.state.decisions.resistor.variants, [
    'spice:resistor',
    'spice:resistor-us',
  ]);
  await assert.rejects(
    store.save('resistance_wire', chosen(), 2),
    /European rectangle or US zigzag/,
  );
  const restored = await new DecisionStore(catalog, store.file).open();
  assert.equal(restored.state.decisions.resistance_wire.resistorStyle, 'us');
});
