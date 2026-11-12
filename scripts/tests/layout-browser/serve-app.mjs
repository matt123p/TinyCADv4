import { Parcel } from '@parcel/core';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function serveLayoutApp() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  await mkdir(path.join(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(path.join(root, '.tmp/layout-browser-'));
  let server;
  const close = async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const dist = path.join(directory, 'dist');
    // An explicit target keeps this build separate from a developer's dist and
    // cache, while production optimization exercises Parcel's worker bundling.
    const bundler = new Parcel({
      entries: path.join(root, 'scripts/tests/fixtures/layout-browser.html'),
      defaultConfig: '@parcel/config-default',
      mode: 'production',
      env: { TARGET_SYSTEM: 'filesystem' },
      shouldDisableCache: true,
      cacheDir: path.join(directory, 'cache'),
      shouldAutoInstall: false,
      logLevel: 'error',
      targets: { layoutTests: {
        context: 'browser', outputFormat: 'esmodule', distDir: dist,
        publicUrl: './', sourceMap: false, optimize: true,
      } },
    });
    await bundler.run();
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const relative = decodeURIComponent(url.pathname).replace(/^\/layout\//, '');
        const filename = path.resolve(dist, relative || 'layout-browser.html');
        if (!filename.startsWith(dist + path.sep)) { response.writeHead(403); response.end(); return; }
        response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
        response.end(await readFile(filename));
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return { baseURL: `http://127.0.0.1:${server.address().port}/layout/`, close };
  } catch (error) { await close(); throw error; }
}
