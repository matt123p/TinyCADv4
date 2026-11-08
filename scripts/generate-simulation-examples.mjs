import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/example-generator/examples.cjs');
await build({
  stdin: {
    contents: `export { teachingExamples, createTeachingDrawing } from './src/simulation/examples'; export { createLaboratoryDrawing } from './src/simulation/laboratoryExample'; export { encodeDrawing } from './src/io/dsnCodec';`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: output,
  logLevel: 'error',
  plugins: [
    {
      name: 'isolate-editor-startup',
      setup(builder) {
        builder.onResolve({ filter: /\/(?:startup|i18n)$/ }, (args) => ({
          path: args.path.endsWith('/startup') ? 'startup' : 'i18n',
          namespace: 'fixture',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'fixture' },
          ({ path: service }) => ({
            contents:
              service === 'startup'
                ? 'export const store = {dispatch(){}}; export function getStore(){return store;}'
                : 'export default {t:key=>key};',
          }),
        );
      },
    },
  ],
});
const { teachingExamples, createTeachingDrawing, createLaboratoryDrawing, encodeDrawing } =
  createRequire(import.meta.url)(output);
// Text-layout caches need a canvas while constructing editor components; they
// are not serialized. Fixture generation only needs deterministic font metrics.
globalThis.document = {
  createElement: () => ({
    getContext: () => ({
      font: '',
      measureText: (text) => ({
        width: String(text).length * 8,
        actualBoundingBoxDescent: 3,
      }),
    }),
  }),
};
await fs.mkdir(path.join(root, 'examples/simulation'), { recursive: true });
for (const name of teachingExamples) {
  const drawing = createTeachingDrawing(name);
  const bytes = await encodeDrawing(drawing);
  await fs.writeFile(
    path.join(root, 'examples/simulation', name + '.dzn'),
    bytes,
  );
  console.log(`Generated examples/simulation/${name}.dzn`);
}
await fs.writeFile(path.join(root,'examples/simulation/virtual-laboratory.dzn'),await encodeDrawing(createLaboratoryDrawing()));
console.log('Generated examples/simulation/virtual-laboratory.dzn');
