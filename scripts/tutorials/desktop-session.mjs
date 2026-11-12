import { _electron } from 'playwright';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function desktopSession(file) {
  const profile = await mkdtemp(path.join(tmpdir(), 'tinycad-tutorial-'));
  const dist = path.join(root, 'dist');
  const mime = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.mp4': 'video/mp4',
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const file = path.resolve(
        dist,
        url.pathname === '/'
          ? 'index-electron.html'
          : decodeURIComponent(url.pathname.slice(1)),
      );
      if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
      response.setHeader(
        'Content-Type',
        mime[path.extname(file)] || 'application/octet-stream',
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  let app;
  const close = async () => {
    // Exit without the unsaved-document prompt; only the temporary profile is used.
    if (app && app.process().exitCode === null) {
      const exited = once(app.process(), 'exit');
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await exited;
    }
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const env = {
      ...process.env,
      ELECTRON_IS_DEV: '1',
      TUTORIAL_PROFILE: profile,
      TUTORIAL_APP_URL: `http://127.0.0.1:${server.address().port}`,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    // This flag applies only to the isolated recording process, where the host
    // disables user namespaces and the npm sandbox helper has no setuid bit.
    app = await _electron.launch({
      cwd: root,
      env,
      timeout: 30000,
      args: [
        '--no-sandbox',
        path.join(root, 'scripts/tutorials/video-desktop.cjs'),
        ...(file ? [path.resolve(root, file)] : []),
      ],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page
      .getByRole('button', { name: 'Open Example', exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    return { app, page, close };
  } catch (error) {
    await close();
    throw error;
  }
}
