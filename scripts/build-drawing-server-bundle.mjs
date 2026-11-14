import { buildServerBundle } from './build-server-bundle.mjs';
await buildServerBundle({
  entry: 'drawing.tsx',
  output: 'drawing-server.bundle.js',
  drawing: true,
});
