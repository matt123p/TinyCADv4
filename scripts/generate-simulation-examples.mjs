import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/example-generator/examples.cjs');
await build({
  stdin: {
    contents: `export { teachingExamples, createTeachingDrawing } from './src/simulation/examples'; export { ioXML } from './src/io/ioXml';`,
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
const { teachingExamples, createTeachingDrawing, ioXML } = createRequire(
  import.meta.url,
)(output);
await fs.mkdir(path.join(root, 'examples/simulation'), { recursive: true });
for (const name of teachingExamples) {
  const drawing = createTeachingDrawing(name);
  const xml = new ioXML().to_dsn(drawing, true, true).tostring();
  await fs.writeFile(
    path.join(root, 'examples/simulation', name + '.dsn'),
    xml + '\n',
  );
  console.log(`Generated examples/simulation/${name}.dsn`);
}
