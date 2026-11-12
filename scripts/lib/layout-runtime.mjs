import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

export async function layoutRuntime() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  // Tests and preview generation can run concurrently without reading a
  // half-written bundle from another process.
  const output = path.join(
    root,
    `build/layout-tools/runtime-${randomUUID()}.cjs`,
  );
  await build({
    entryPoints: [path.join(root, 'scripts/layout/runtime.tsx')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile: output,
    logLevel: 'error',
    plugins: [
      {
        name: 'headless-editor',
        setup(b) {
          b.onResolve({ filter: /\/(?:startup|i18n)$/ }, ({ path: p }) => ({
            path: p.endsWith('/startup') ? 'startup' : 'i18n',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: p }) => ({
            contents:
              p === 'startup'
                ? 'export const store={dispatch(){}};export function getStore(){return store;}'
                : 'export default {t:key=>key};',
          }));
          // Use the same conservative font metrics as the existing teaching previews.
          b.onResolve({ filter: /(^|\/)measureText$/ }, () => ({
            path: path.join(root, 'scripts/teaching/renderMeasureText.ts'),
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
  let api;
  try {
    api = createRequire(import.meta.url)(output);
  } finally {
    await fs.rm(output, { force: true });
  }
  api.initialiseGenerator();
  return api;
}
