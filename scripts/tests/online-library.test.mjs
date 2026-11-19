import test from 'node:test';
import assert from 'node:assert/strict';
import { registerOnlineLibrary } from '../../electron/onlineLibrary.js';
import { loadComponent } from './load-component.mjs';

function fixture(send) {
  let handler;
  const mainFrame = { url: 'http://localhost:1234/' };
  const webContents = { mainFrame };
  registerOnlineLibrary({
    ipcMain: { handle(channel, callback) {
      assert.equal(channel, 'online-library-request');
      handler = callback;
    } },
    app: { isPackaged: false, getAppPath: () => process.cwd() },
    getWindow: () => ({ webContents }), send,
  });
  return { handler, event: { sender: webContents, senderFrame: mainFrame } };
}

test('desktop public search and symbol downloads use main-process GET requests without cookies or CORS', async () => {
  const calls = [];
  const { handler, event } = fixture(async (url, options) => {
    calls.push({ url, options });
    return new Response(url.includes('/copy?') ? '<TinyCAD/>' : '{"total":2,"symbols":[]}', {
      headers: { 'Content-Type': url.includes('/copy?') ? 'text/xml' : 'application/json' },
    });
  });
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { electronAPI: { onlineLibraryRequest: resource => handler(event, resource) } };
    const { fetchOnlineLibrary } = loadComponent('src/io/onlineLibrary.ts', { './apiServer': { isElectron: true } });
    const search = await fetchOnlineLibrary('https://www.tinycad.net/api/search/Search?key=123&page=1');
    assert.equal((await search.json()).total, 2);
    const symbol = await fetchOnlineLibrary('https://www.tinycad.net/api/search/copy?id=1951&name=SIEMENS');
    assert.equal(await symbol.text(), '<TinyCAD/>');
    assert.match(symbol.headers.get('content-type'), /xml/);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://www.tinycad.net/api/search/Search?key=123&page=1');
    for (const { options } of calls) {
      assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
    }
  } finally { globalThis.window = originalWindow; }
});

test('desktop library bridge rejects other sites, endpoints, windows and subframes', async () => {
  const { handler, event } = fixture(() => assert.fail('Rejected requests must not fetch'));
  for (const resource of ['https://example.com/', '//example.com/api/search/search', '/api/account', '/api/search/thumbnail']) {
    await assert.rejects(handler(event, resource), /Invalid online library/);
  }
  await assert.rejects(handler({ ...event, sender: {} }, '/api/search/search'), /main frame/);
  await assert.rejects(handler({ ...event, senderFrame: { url: 'http://localhost:1234/' } }, '/api/search/search'), /main frame/);
  event.senderFrame.url = 'https://example.com/';
  await assert.rejects(handler(event, '/api/search/search'), /main frame/);
});

test('desktop library requests preserve HTTP errors and can be stopped while IPC is pending', async () => {
  const originalWindow = globalThis.window;
  try {
    const { fetchOnlineLibrary } = loadComponent('src/io/onlineLibrary.ts', { './apiServer': { isElectron: true } });
    globalThis.window = { electronAPI: { onlineLibraryRequest: async () => ({ status: 503, statusText: 'Unavailable', body: 'Try later', contentType: 'text/plain' }) } };
    const response = await fetchOnlineLibrary('/api/search/search?key=123');
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Try later');
    window.electronAPI.onlineLibraryRequest = () => new Promise(() => {});
    const controller = new AbortController();
    const pending = fetchOnlineLibrary('/api/search/search?key=123', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  } finally { globalThis.window = originalWindow; }
});

test('browser library panel searches and downloads from the API host when served by the hosted editor', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalTarget = process.env.TARGET_SYSTEM;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(url.includes('/copy?') ? '<TinyCAD/>' : '{"total":2}');
    };
    for (const target of ['filesystem', 'google']) {
      process.env.TARGET_SYSTEM = target;
      const routing = loadComponent('src/io/apiServer.ts', {});
      const library = loadComponent('src/io/onlineLibrary.ts', { './apiServer': routing });
      const { Search, FetchSymbolData } = loadComponent('src/components/libraryPanel/Search.ts', {
        '../../io/apiServer': routing,
        '../../io/onlineLibrary': library,
      });
      for (const [page, apiOrigin] of [
        ['https://online.tinycad.net/fs', 'https://www.tinycad.net'],
        ['http://localhost:1234/fs', ''],
        ['https://editor.example:8443/fs', ''],
      ]) {
        globalThis.window = { location: new URL(page) };
        calls.length = 0;
        assert.equal((await Search('NE555 #spice')).total, 2);
        const symbol = await FetchSymbolData({ symbolID: 1951, name: 'NE555' });
        assert.equal(await symbol.text(), '<TinyCAD/>');
        assert.deepEqual(calls, [
          {
            url: apiOrigin + '/api/search/Search?key=NE555+%23spice&page=1&orderBy=N',
            init: { credentials: 'include', mode: 'cors' },
          },
          {
            url: apiOrigin + '/api/search/copy?id=1951&name=NE555',
            init: { credentials: 'include', method: 'GET', mode: 'cors' },
          },
        ]);
        const thumbnail = '/api/Search/Thumbnail?size=md&id=1951';
        assert.equal(routing.onlineLibraryUrl(thumbnail), apiOrigin + thumbnail);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (originalTarget === undefined) delete process.env.TARGET_SYSTEM;
    else process.env.TARGET_SYSTEM = originalTarget;
  }
});
