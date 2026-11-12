// Capture the real desktop application, using a separate documentation profile.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'),
  fs = require('node:fs/promises');
const file = process.argv[2] || 'tutorials/spice/circuits/divider.dzn';
const output = process.argv[3] || 'build/tutorials/app.png';
const mode = process.argv[4] || 'circuit';
app.setPath('userData', path.resolve('build/tutorials/screenshot-profile'));
app.disableHardwareAcceleration();
process.env.ELECTRON_IS_DEV = '1';
process.argv = [
  process.argv[0],
  path.resolve('electron/electron.js'),
  path.resolve(file),
];
app.on('browser-window-created', (_, win) => {
  if (win.webContents.getType() !== 'window') return;
  win.setSize(1600, 1000);
  win.webContents.on('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 4500));
      if (mode === 'simulation') {
        await win.webContents.executeJavaScript(
          "Array.from(document.querySelectorAll('div')).find(e=>e.textContent.trim()===String.fromCharCode(0x25f7)+' '+" +
            JSON.stringify(path.basename(file, '.dzn')) +
            ')?.click()',
        );
        await new Promise((r) => setTimeout(r, 1200));
      }
      console.log(
        (
          await win.webContents.executeJavaScript('document.body.innerText')
        ).slice(0, 10000),
      );
      await fs.writeFile(output, (await win.webContents.capturePage()).toPNG());
      app.exit(0);
    } catch (e) {
      console.error(e);
      app.exit(1);
    }
  });
});

const originalLoadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = function (url, ...rest) {
  if (url.startsWith('http://localhost:1234'))
    url = url.replace('http://localhost:1234', 'http://127.0.0.1:1235');
  return originalLoadURL.call(this, url, ...rest);
};
const server = require('node:http').createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'),
      relative =
        u.pathname === '/'
          ? 'index-electron.html'
          : decodeURIComponent(u.pathname.slice(1));
    const root = path.resolve('dist'),
      file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    const type =
      {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
      }[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(await fs.readFile(file));
  } catch (e) {
    res.statusCode = 404;
    res.end('Not found');
  }
});
server.listen(1235, '127.0.0.1', () =>
  import(
    require('node:url').pathToFileURL(path.resolve('electron/electron.js')).href
  ).catch((e) => {
    console.error(e);
    app.exit(1);
  }),
);
server.on('error', (e) => {
  console.error(e);
  app.exit(1);
});
