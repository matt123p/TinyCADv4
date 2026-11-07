import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
function middlewareApp() {
  const handlers = [];
  const app = (request, response) => {
    let index = 0;
    const next = () => {
      const handler = handlers[index++];
      if (handler) handler(request, response, next);
      else {
        response.statusCode = 404;
        response.end();
      }
    };
    next();
  };
  app.use = (route, handler) => {
    if (typeof route === 'function') handlers.push(route);
    else
      handlers.push((request, response, next) => {
        if (!request.url.startsWith(route + '/')) return next();
        const original = request.url;
        request.url = request.url.slice(route.length);
        handler(request, response, () => {
          request.url = original;
          next();
        });
      });
  };
  return app;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('development proxy forwards API searches as JSON while keeping engine routes', async () => {
  let upstreamPath;
  const upstream = http.createServer((request, response) => {
    upstreamPath = request.url;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ symbols: [], total: 0 }));
  });
  const target = await listen(upstream);
  let frontend;
  try {
    const root = path.resolve('.');
    const configRequire = createRequire(path.join(root, '.proxyrc.cjs'));
    const module = { exports: {} };
    const mockedRequire = Object.assign(
      (name) =>
        name === 'node:fs'
          ? {
              ...fs,
              readFileSync(file, encoding) {
                if (path.basename(file) === '.proxyrc') {
                  const routes = JSON.parse(fs.readFileSync(file, encoding));
                  assert.ok(
                    routes['/api'],
                    'existing API proxy config must be loaded',
                  );
                  routes['/api'].target = target;
                  routes['/api'].logLevel = 'silent';
                  return JSON.stringify(routes);
                }
                return fs.readFileSync(file, encoding);
              },
            }
          : configRequire(name),
      { resolve: configRequire.resolve },
    );
    vm.runInNewContext(fs.readFileSync('.proxyrc.cjs', 'utf8'), {
      require: mockedRequire,
      module,
      __dirname: root,
    });
    const app = middlewareApp();
    module.exports(app);
    app.use((request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!DOCTYPE html><title>Renderer fallback</title>');
    });
    frontend = http.createServer(app);
    const base = await listen(frontend);
    const response = await fetch(
      base + '/api/search/Search?key=%23spice&page=1',
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { symbols: [], total: 0 });
    assert.equal(upstreamPath, '/api/search/Search?key=%23spice&page=1');
    const engineResponse = await fetch(
      base + '/engines/ngspice/not-an-engine.js',
    );
    assert.equal(engineResponse.status, 404);
  } finally {
    if (frontend) await close(frontend);
    await close(upstream);
  }
});
