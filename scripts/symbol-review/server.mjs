import { createServer } from 'node:http';
import { readFile, mkdir, copyFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareCatalog,
  rankCandidates,
  referenceId,
  digest,
  spiceArtworkSnapshot,
  derivedArtworkSnapshot,
} from './catalog.mjs';
import { DecisionStore, progress, ReviewError } from './decisions.mjs';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
async function jsonBody(request) {
  if (!String(request.headers['content-type']).startsWith('application/json'))
    throw new ReviewError('JSON content required.', 415);
  let size = 0;
  const parts = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ReviewError('Request too large.', 413);
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new ReviewError('Invalid JSON.');
  }
}
export function reviewOrigins(port, proxyUri) {
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  if (proxyUri) {
    const forwarded = new URL(
      proxyUri
        .replaceAll('{{port}}', String(port))
        .replaceAll('{port}', String(port)),
    );
    if (!['http:', 'https:'].includes(forwarded.protocol))
      throw new Error('The port-forwarding URL must use HTTP or HTTPS.');
    origins.add(forwarded.origin);
  }
  return origins;
}
export function createReviewServer({
  catalog,
  store,
  cache,
  root = ROOT,
  proxyUri = process.env.VSCODE_PROXY_URI,
}) {
  const json = (response, status, value) => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(value));
  };
  return createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      // Coder preserves the forwarded hostname, and may terminate HTTPS before
      // proxying to this loopback HTTP server. Trust the configured Coder URL,
      // rather than accepting arbitrary Host or X-Forwarded-* headers.
      const origins = reviewOrigins(request.socket.localPort, proxyUri);
      const hosts = new Set([...origins].map((origin) => new URL(origin).host));
      if (!hosts.has(request.headers.host))
        throw new ReviewError(
          'Use the local or configured Coder address.',
          403,
        );
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (!['GET', 'PUT', 'POST'].includes(request.method))
        throw new ReviewError('Method not allowed.', 405);
      if (request.method !== 'GET') {
        if (
          request.headers['x-symbol-review'] !== '1' ||
          (request.headers.origin && !origins.has(request.headers.origin))
        )
          throw new ReviewError('Save choices from the review app.', 403);
      }
      if (url.pathname === '/api/catalog' && request.method === 'GET')
        return json(response, 200, {
          version: 1,
          requirements: catalog.requirements,
          libraries: catalog.libraries,
          rules: catalog.rules,
          referenceIds: Object.fromEntries(
            catalog.requirements.map((r) => [r.id, referenceId(r)]),
          ),
          references: catalog.candidates
            .filter((c) => c.kind === 'spice' || c.kind === 'derived')
            .map((c) => ({
              ...c,
              name: c.names[0].name,
              description: c.names[0].description,
              author: c.names[0].author,
              sourceNameId: c.names[0].nameId,
            })),
          sourceCount: catalog.candidates.filter((c) => c.kind === 'sql')
            .length,
        });
      if (url.pathname === '/api/state' && request.method === 'GET')
        return json(response, 200, {
          state: store.state,
          progress: progress(catalog, store.state),
        });
      if (url.pathname === '/api/candidates' && request.method === 'GET') {
        const requirement = catalog.requirements.find(
          (r) => r.id === url.searchParams.get('symbol'),
        );
        if (!requirement) throw new ReviewError('Unknown canonical symbol.');
        const found = rankCandidates(catalog, requirement, {
          query: requirement.artworkChoice
            ? ''
            : url.searchParams.get('q') || '',
          all:
            !!requirement.artworkChoice || url.searchParams.get('all') === '1',
          includeRejected:
            store.state.decisions[requirement.id].rejectedCandidateIds,
        });
        const filtered = found.filter(
          (c) =>
            (!requirement.artworkChoice ||
              requirement.artworkChoice.candidateIds.includes(c.id)) &&
            (!!requirement.artworkChoice ||
              url.searchParams.get('rejected') === '1' ||
              !c.rejected) &&
            (url.searchParams.get('pins') !== '1' ||
              c.metrics.pinCount === requirement.pins.length),
        );
        const page = Math.max(
          0,
          Math.min(10000, Number(url.searchParams.get('page')) || 0),
        );
        return json(response, 200, {
          total: filtered.length,
          candidates: filtered.slice(page * 12, page * 12 + 12),
        });
      }
      if (
        url.pathname.startsWith('/api/candidate/') &&
        request.method === 'GET'
      ) {
        const id = decodeURIComponent(
          url.pathname.slice('/api/candidate/'.length),
        );
        const candidate = catalog.candidates.find((c) => c.id === id);
        if (!candidate) throw new ReviewError('Unknown artwork.', 404);
        const name =
          candidate.names.find(
            (n) => n.nameId === Number(url.searchParams.get('nameId')),
          ) || candidate.names[0];
        const requirement = catalog.requirements.find(
          (r) => r.id === url.searchParams.get('symbol'),
        );
        const ranked = requirement
          ? rankCandidates(catalog, requirement, { all: true }).find(
              (c) => c.id === id,
            )
          : null;
        return json(response, 200, {
          ...candidate,
          flags: ranked?.flags || [],
          name: name.name,
          description: name.description,
          author: name.author,
          sourceNameId: name.nameId,
        });
      }
      if (
        url.pathname.startsWith('/api/artwork/') &&
        request.method === 'GET'
      ) {
        const id = decodeURIComponent(
          url.pathname.slice('/api/artwork/'.length),
        );
        if (!catalog.candidates.some((c) => c.id === id))
          throw new ReviewError('Unknown artwork.', 404);
        response.writeHead(200, {
          'content-type': 'application/xml; charset=utf-8',
        });
        return response.end(
          await readFile(
            path.join(cache, 'artwork', id.replace(':', '-') + '.xml'),
          ),
        );
      }
      if (
        url.pathname.startsWith('/api/decisions/') &&
        request.method === 'PUT'
      ) {
        const id = decodeURIComponent(
            url.pathname.slice('/api/decisions/'.length),
          ),
          body = await jsonBody(request);
        const state = await store.save(id, body.decision, body.revision);
        return json(response, 200, {
          state,
          progress: progress(catalog, state),
        });
      }
      if (url.pathname === '/api/import' && request.method === 'POST') {
        const body = await jsonBody(request),
          state = await store.import(body.state, body.revision);
        return json(response, 200, {
          state,
          progress: progress(catalog, state),
        });
      }
      if (url.pathname === '/api/export' && request.method === 'GET') {
        response.setHeader(
          'content-disposition',
          'attachment; filename="symbol-choices.json"',
        );
        return json(response, 200, store.state);
      }
      const assets = {
        '/': ['tools/symbol-review/index.html', 'text/html'],
        '/app.mjs': ['tools/symbol-review/app.mjs', 'text/javascript'],
        '/style.css': ['tools/symbol-review/style.css', 'text/css'],
      };
      if (request.method === 'GET' && url.pathname === '/renderer.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' });
        return response.end(await readFile(path.join(cache, 'renderer.js')));
      }
      if (request.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        response.writeHead(200, { 'content-type': type + '; charset=utf-8' });
        return response.end(await readFile(path.join(root, file)));
      }
      throw new ReviewError('Not found.', 404);
    } catch (error) {
      if (!response.headersSent)
        json(response, error.status || 500, {
          error: error.status
            ? error.message
            : 'Unable to complete the request. Check the reviewer terminal.',
        });
      else response.end();
      if (!error.status) console.error(error);
    }
  });
}
async function main(args) {
  let sql,
    port = 4174,
    prepareOnly = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--sql') {
      sql = args.shift();
      if (!sql || sql.startsWith('--'))
        throw new Error('--sql requires a dump path.');
    } else if (flag === '--port') port = Number(args.shift());
    else if (flag === '--prepare') prepareOnly = true;
    else if (flag === '--help') {
      console.log(
        'node scripts/symbol-review/server.mjs [--sql DUMP.sql] [--port 4174] [--prepare]\nChoices: docs/symbol-libraries/symbol-choices.json; generated catalogue: .tmp/symbol-review/',
      );
      return;
    } else throw new Error('Unknown option ' + flag);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid port.');
  const cache = path.join(ROOT, '.tmp/symbol-review');
  await mkdir(cache, { recursive: true });
  let catalog;
  if (sql)
    catalog = await prepareCatalog({
      root: ROOT,
      sql: path.resolve(sql),
      cache,
    });
  else {
    try {
      catalog = JSON.parse(
        await readFile(path.join(cache, 'catalog.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const fallback = path.resolve(ROOT, '../sql/tinycad1_prod(1).sql');
      await access(fallback).catch(() => {
        throw new Error('Use --sql PATH to prepare the source catalogue.');
      });
      catalog = await prepareCatalog({ root: ROOT, sql: fallback, cache });
    }
  }
  const [inventoryBytes, currentSpice, rulesBytes, currentProvenance] =
    await Promise.all([
      readFile(path.join(ROOT, 'docs/symbol-libraries/all-symbols.json')),
      readFile(path.join(ROOT, 'bundled-libraries/spice/spice.tclib')),
      readFile(
        path.join(ROOT, 'docs/symbol-libraries/selection-rules.json'),
        'utf8',
      ),
      readFile(
        path.join(ROOT, 'bundled-libraries/spice/spice.provenance.json'),
        'utf8',
      ),
    ]);
  const spiceSnapshot = await spiceArtworkSnapshot(
    currentSpice,
    JSON.parse(currentProvenance),
  );
  const derivedSnapshot = derivedArtworkSnapshot(
    spiceSnapshot,
    JSON.parse(
      await readFile(
        path.join(ROOT, 'library-recipes/derived-symbols.json'),
        'utf8',
      ),
    ),
  );
  if (
    catalog.version !== 1 ||
    digest(inventoryBytes) !== catalog.inventorySha256 ||
    spiceSnapshot.fingerprint !== catalog.spiceSha256 ||
    derivedSnapshot.fingerprint !== catalog.derivedSha256 ||
    JSON.stringify(JSON.parse(rulesBytes)) !== JSON.stringify(catalog.rules)
  )
    throw new Error(
      'The cached inventory, SPICE bundle or style rules changed. Re-run with --sql PATH to prepare a fresh snapshot; preserve and reconcile any existing choices if artwork changed.',
    );
  // Reuse TinyCAD's real SVG renderer, including its line/pin conventions.
  const built = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts/build-server-bundle.mjs')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (built.status !== 0)
    throw new Error('Unable to build preview renderer: ' + built.stderr);
  await copyFile(
    path.join(ROOT, 'server.bundle.js'),
    path.join(cache, 'renderer.js'),
  );
  const store = await new DecisionStore(
    catalog,
    path.join(ROOT, 'docs/symbol-libraries/symbol-choices.json'),
  ).open();
  console.log(JSON.stringify(progress(catalog, store.state)));
  if (prepareOnly) {
    console.log('Prepared symbol catalogue. No course bundles were built.');
    return;
  }
  reviewOrigins(port, process.env.VSCODE_PROXY_URI);
  const server = createReviewServer({ catalog, store, cache });
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(
      'Symbol reviewer: ' +
        [...reviewOrigins(server.address().port, process.env.VSCODE_PROXY_URI)]
          .filter((origin) => !origin.includes('localhost'))
          .join(' or '),
    );
    console.log(
      'Choices are saved to docs/symbol-libraries/symbol-choices.json',
    );
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
