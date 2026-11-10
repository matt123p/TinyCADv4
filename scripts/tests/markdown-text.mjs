import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run with: node scripts/tests/markdown-text.mjs
// Uses Electron's real Chromium DOM/canvas, not a simulated HTML environment.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.tmp/markdown-text-tests');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(root, 'scripts/tests/fixtures/markdown-text.tsx')],
  outfile: path.join(output, 'test.js'),
  bundle: true,
  platform: 'browser',
  plugins: [
    {
      name: 'browser-services',
      setup(builder) {
        builder.onResolve({ filter: /\/startup$/ }, () => ({
          path: 'startup',
          namespace: 'test',
        }));
        builder.onResolve({ filter: /\/i18n$/ }, () => ({
          path: 'i18n',
          namespace: 'test',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'test' },
          ({ path: service }) => ({
            contents:
              service === 'startup'
                ? 'export const store = {dispatch(){}}; export function getStore(){return store;}'
                : 'export default { t: key => key };',
          }),
        );
      },
    },
  ],
});
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><style>${await readFile(
    path.join(root, 'styles/svg.scss'),
    'utf8',
  )}</style><script src="test.js"></script>`,
);
await writeFile(
  path.join(output, 'main.cjs'),
  `
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false,width:820,height:840,webPreferences:{offscreen:true}});
  try {
    await window.loadFile(path.join(__dirname, 'index.html'));
    console.log(await window.webContents.executeJavaScript('window.runMarkdownChecks()'));
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(__dirname,'preview.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.showMarkdownEditor(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(__dirname,'editor.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('window.showMarkdownPreview()');
    const svg = await window.webContents.executeJavaScript('window.finishMarkdownChecks()');
    const pdf = new PDFDocument({compress:false});
    for (const [name, face] of [['Arial', 'Regular'], ['Arial-Bold', 'Bold'], ['Arial-Italic', 'Italic'], ['Arial-BoldItalic', 'BoldItalic']]) pdf.registerFont(name, path.join(process.cwd(), 'styles/fonts/LiberationSans-' + face + '.ttf'));
    const buffers = [];
    pdf.on('data', chunk => buffers.push(chunk));
    const finished = new Promise(resolve => pdf.on('end', resolve));
    SVGtoPDF(pdf, svg, 0, 0);
    pdf.end(); await finished;
    const data = Buffer.concat(buffers);
    if (data.toString('latin1').includes('/Subtype /Image')) throw new Error('Markdown must not become a PDF image');
    if (!data.toString('latin1').includes('BT')) throw new Error('PDF must contain native text');
    fs.writeFileSync(path.join(__dirname,'preview.pdf'), data);
    console.log('Native vector Markdown and PDFKit export checks passed');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.join(output, 'main.cjs')], {
  cwd: root,
  env,
  encoding: 'utf8',
  timeout: 60000,
  windowsHide: true,
});
process.stdout.write(result.stdout || '');
if (result.status !== 0) {
  process.stderr.write(result.stderr || String(result.error));
  process.exitCode = 1;
}
