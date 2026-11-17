import { buildServerBundle } from './build-server-bundle.mjs';
await buildServerBundle({
  entry: 'chat.ts',
  output: 'src/chat/native.bundle.js',
  drawing: true,
});
