import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { librarySqlite } from '../lib/library-from-sql.mjs';
export async function tutorialRuntime() {
  const root = process.cwd(),
    output = path.join(root, 'build/tutorials/runtime.cjs');
  await build({
    entryPoints: ['scripts/tutorials/runtime.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    logLevel: 'error',
    plugins: [
      {
        name: 'headless',
        setup(b) {
          b.onResolve({ filter: /\/(?:startup|i18n)$/ }, ({ path: p }) => ({
            path: p.endsWith('/startup') ? 'startup' : 'i18n',
            namespace: 'stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: p }) => ({
            contents:
              p === 'startup'
                ? 'export const store={dispatch(){}};export function getStore(){return store;}'
                : 'export default {t:key=>key};',
          }));
          b.onResolve({ filter: /(^|\/)measureText$/ }, () => ({
            path: path.join(root, 'scripts/layout/renderMeasureText.ts'),
          }));
          b.onLoad(
            { filter: /src[\\/]util[\\/]font_metrics[\\/].+\.js$/ },
            async ({ path: p }) => ({
              contents: (await fs.readFile(p, 'utf8')).replace(
                /^module\.exports\s*=\s*/m,
                'export default ',
              ),
              loader: 'js',
            }),
          );
        },
      },
    ],
  });
  const api = createRequire(import.meta.url)(output);
  api.initialiseLayoutRuntime();
  return api;
}
export async function spiceLibrary() {
  const SQL = await librarySqlite(),
    db = new SQL.Database(
      await fs.readFile('bundled-libraries/spice/spice.tclib'),
    );
  const rows = (q) => {
    const r = db.exec(q)[0];
    return r
      ? r.values.map((v) =>
          Object.fromEntries(r.columns.map((k, i) => [k, v[i]])),
        )
      : [];
  };
  const entries = rows('SELECT * FROM Name').map((name) => ({
    name: {
      ...name,
      Attributes: rows('SELECT * FROM Attribute WHERE NameID=' + name.NameID),
    },
    xml: new TextDecoder().decode(
      rows('SELECT Data FROM Symbol WHERE SymbolID=' + name.SymbolID)[0].Data,
    ),
  }));
  db.close();
  return entries;
}
