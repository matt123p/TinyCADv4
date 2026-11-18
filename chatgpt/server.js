// Same-origin endpoint for a browser editor hosted on the user's own machine.
// This service is loopback-only and is not a multi-user hosted sign-in backend.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChatGPTRuntime, safeError } from './runtime.js';
import { accountCommand, relayResponse } from './bridge.js';

export function createChatGPTServer(
  runtime = new ChatGPTRuntime({
    storageDir: join(homedir(), '.config', 'tinycad', 'chatgpt'),
  }),
) {
  const csrf = randomBytes(32).toString('base64url');
  const local = (value) => {
    try {
      return ['127.0.0.1', 'localhost', '[::1]'].includes(
        new URL(value).hostname,
      );
    } catch {
      return false;
    }
  };
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const json = (status, value) => {
      response.writeHead(status);
      response.end(JSON.stringify(value));
    };
    const origin = request.headers.origin;
    if (
      !local(`http://${request.headers.host}`) ||
      (origin && !local(origin)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      json(403, {
        error: { message: 'Use ChatGPT sign-in from locally hosted TinyCAD.' },
      });
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/api\/chat\/chatgpt/, '');
    try {
      if (request.method === 'GET' && path === '/account') {
        json(200, { result: { ...(await runtime.session()), csrf } });
        return;
      }
      const supplied = Buffer.from(
        String(request.headers['x-tinycad-chatgpt'] || ''),
      );
      if (
        request.method !== 'POST' ||
        supplied.length !== Buffer.byteLength(csrf) ||
        !timingSafeEqual(supplied, Buffer.from(csrf)) ||
        !request.headers['content-type']?.startsWith('application/json')
      ) {
        json(403, {
          error: { message: 'Reconnect ChatGPT in TinyCAD and try again.' },
        });
        return;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.byteLength;
        if (size > 20 * 1024 * 1024) {
          json(413, { error: { message: 'Request exceeds the file limit.' } });
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (path === '/account') {
        json(200, {
          result: await accountCommand(runtime, body.operation, body.args),
        });
        return;
      }
      if (path !== '/responses') {
        json(404, { error: { message: 'Unknown ChatGPT operation.' } });
        return;
      }
      const controller = new AbortController();
      const closed = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.on('close', closed);
      try {
        await relayResponse(runtime, body, controller, (event) => {
          if (event.type === 'start') {
            response.setHeader('Content-Type', 'text/event-stream');
            response.setHeader('X-Accel-Buffering', 'no');
            response.flushHeaders();
          } else if (event.type === 'chunk') response.write(event.text);
          else if (event.type === 'end') response.end();
        });
      } finally {
        response.removeListener('close', closed);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      json(error.status || 400, { error: safeError(error) });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createChatGPTServer();
  server.listen(43195, '127.0.0.1', () =>
    console.log('TinyCAD ChatGPT sign-in runtime ready.'),
  );
  const stop = () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
