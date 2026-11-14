import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const rendererRoot = path.join(workspaceRoot, 'renderer');

function exactAliasPlugin(aliases) {
  return {
    name: 'exact-alias',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const replacement = aliases[args.path];
        if (!replacement) {
          return null;
        }

        return {
          path: replacement,
        };
      });
    },
  };
}

function fontMetricsPlugin() {
  return {
    name: 'font-metrics-cjs',
    setup(build) {
      build.onLoad(
        { filter: /src[\\/]util[\\/]font_metrics[\\/].+\.js$/ },
        async (args) => {
          const source = await fs.readFile(args.path, 'utf8');
          return {
            contents: source.replace(
              /^module\.exports\s*=\s*/m,
              'export default ',
            ),
            loader: 'js',
          };
        },
      );
    },
  };
}

const aliases = {
  'common-xml-features': path.join(
    workspaceRoot,
    'node_modules',
    'common-xml-features',
    'lib',
    'common-xml-features.js',
  ),
  'react-dom/server.browser': path.join(
    workspaceRoot,
    'node_modules',
    'react-dom',
    'cjs',
    'react-dom-server-legacy.browser.production.min.js',
  ),
  'react-i18next': path.join(rendererRoot, 'react-i18next-shim.ts'),
  '../i18n': path.join(rendererRoot, 'i18n-shim.ts'),
  '../i18n/index': path.join(rendererRoot, 'i18n-shim.ts'),
  '../../i18n': path.join(rendererRoot, 'i18n-shim.ts'),
  '../../i18n/index': path.join(rendererRoot, 'i18n-shim.ts'),
  './measureText': path.join(rendererRoot, 'serverMeasureText.ts'),
  '../util/measureText': path.join(rendererRoot, 'serverMeasureText.ts'),
  '../../util/measureText': path.join(rendererRoot, 'serverMeasureText.ts'),
  '../manipulators/updateView': path.join(rendererRoot, 'updateViewShim.ts'),
  './tclib': path.join(rendererRoot, 'tclib-shim.ts'),
  '../model/tclib': path.join(rendererRoot, 'tclib-shim.ts'),
  '../../model/tclib': path.join(rendererRoot, 'tclib-shim.ts'),
};

export async function buildServerBundle({
  entry = 'index.ts',
  output = 'server.bundle.js',
  drawing = false,
} = {}) {
  const result = await esbuild.build({
    absWorkingDir: workspaceRoot,
    entryPoints: [path.join(rendererRoot, entry)],
    bundle: true,
    outfile: path.join(workspaceRoot, output),
    format: 'iife',
    platform: 'browser',
    mainFields: ['browser', 'module', 'main'],
    target: ['es2017'],
    jsx: 'transform',
    treeShaking: true,
    minify: true,
    sourcemap: false,
    metafile: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [
      exactAliasPlugin({
        ...aliases,
        ...(drawing
          ? {
              '../simulation/contracts': path.join(rendererRoot, 'simulation-contracts-shim.ts'),
              './contracts': path.join(rendererRoot, 'simulation-contracts-shim.ts'),
              './updateView': path.join(rendererRoot, 'updateViewShim.ts'),
              '../state/dispatcher/AppDispatcher': path.join(
                rendererRoot,
                'dispatcher-shim.ts',
              ),
              '../util/global_id': path.join(rendererRoot, 'serverGlobalId.ts'),
              '../../util/global_id': path.join(
                rendererRoot,
                'serverGlobalId.ts',
              ),
            }
          : {}),
      }),
      fontMetricsPlugin(),
    ],
  });

  const inputPaths = Object.keys(result.metafile.inputs);
  const forbiddenInputs = [
    'src/state/dispatcher/AppDispatcher.ts',
    'src/startup.ts',
    'sql.js',
    'src/io/tclib.ts',
    'src/io/files.tsx',
    'src/i18n/index.ts',
    'src/i18n/languages.ts',
    'src/manipulators/updateView.ts',
    'src/util/measureText.ts',
    'src/components/svg/Drawing.tsx',
    'src/components/svg/Sheet.tsx',
    'common-xml-features-browser.js',
    'renderer/react-global-shim.ts',
    'node_modules/react-dom/index.js',
    'node_modules/react-dom/client.js',
    'node_modules/react-dom/server.browser.js',
    'react-dom-server.browser.production.min.js',
    'react-dom-server.node',
    'server.node.js',
  ];

  const foundForbidden = forbiddenInputs.filter((needle) =>
    inputPaths.some((inputPath) => inputPath.includes(needle)),
  );

  if (foundForbidden.length > 0) {
    throw new Error(
      `server-bundle pulled forbidden inputs: ${foundForbidden.join(', ')}`,
    );
  }

  console.log(`${output} built with ${inputPaths.length} bundled inputs.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await buildServerBundle();
}
