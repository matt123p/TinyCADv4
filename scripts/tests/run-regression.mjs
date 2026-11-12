import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundle actual app code while replacing browser startup services.
export async function runRegression(contents, { bundlePackages = [] } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(path.join(root, '.issue-tests-'));
  try {
    const outfile = path.join(directory, 'regressions.cjs');
    await build({
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents,
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile,
      logLevel: 'error',
      plugins: [{
        name: 'browser-services',
        setup(builder) {
          // Use the same ESM entry point as the browser build when testing undo.
          for (const name of bundlePackages) {
            builder.onResolve({ filter: new RegExp('^' + name + '$') }, () => ({ path: fileURLToPath(import.meta.resolve(name)) }));
          }
          builder.onResolve({ filter: /\/startup$/ }, () => ({ path: 'startup', namespace: 'test' }));
          builder.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'test' }));
          builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: service }) => ({
            contents: service === 'startup'
              ? 'export const store = {dispatch(){}}; export function getStore(){return store;}'
              : 'export default { t: key => key };',
          }));
        },
      }],
    });
    createRequire(import.meta.url)(outfile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
