import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { requestGlm, registerChatHandlers } from '../../electron/chat.js';

test('local Parcel proxy routes Z.AI before the general TinyCAD API proxy', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../.proxyrc', import.meta.url), 'utf8'),
  );
  assert.equal(Object.keys(config)[0], '/api/chat/glm');
  assert.equal(config['/api/chat/glm'].target, 'https://api.z.ai');
  assert.equal(config['/api/chat/glm'].secure, true);
  assert.equal(
    config['/api/chat/glm'].pathRewrite['^/api/chat/glm'],
    '/api/paas/v4',
  );
  assert.equal(config['/api'].target, 'https://www.tinycad.net');
});
test('Electron relay forwards only permitted operations, preserves auth, and blocks redirects', async () => {
  const result = await requestGlm(
    {
      operation: 'chat/completions',
      authorization: 'Bearer user-key',
      body: '{"model":"glm-5.3"}',
    },
    new AbortController().signal,
    async (url, init) => {
      assert.equal(url, 'https://api.z.ai/api/paas/v4/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer user-key');
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      return new Response('{"choices":[]}');
    },
  );
  assert.deepEqual(result, { status: 200, body: '{"choices":[]}' });
  for (const operation of [
    'https://attacker.example',
    '../files',
    'files',
    'models?key=secret',
  ])
    await assert.rejects(
      requestGlm(
        { operation, authorization: 'Bearer user-key' },
        new AbortController().signal,
      ),
      /Invalid/,
    );
});
test('Electron relay does not reflect provider error bodies', async () => {
  const result = await requestGlm(
    { operation: 'models', authorization: 'Bearer user-key' },
    new AbortController().signal,
    async () => new Response('private-provider-body', { status: 401 }),
  );
  assert.equal(result.status, 401);
  assert.ok(!result.body.includes('private-provider-body'));
});
test('Electron cancellation is restricted to the requesting window', async () => {
  const handlers = {},
    events = {};
  registerChatHandlers({
    handle: (name, callback) => {
      handlers[name] = callback;
    },
    on: (name, callback) => {
      events[name] = callback;
    },
  });
  const sender = Object.assign(new EventEmitter(), { id: 1 });
  const savedFetch = globalThis.fetch;
  let requestSignal;
  globalThis.fetch = async (_url, init) =>
    new Promise((resolve, reject) => {
      requestSignal = init.signal;
      init.signal.addEventListener('abort', () =>
        reject(new DOMException('Stopped', 'AbortError')),
      );
    });
  try {
    const pending = handlers['chat-request'](
      { sender },
      { id: 'owned', operation: 'models', authorization: 'Bearer key' },
    );
    assert.ok(requestSignal);
    events['chat-cancel']({ sender: { id: 2 } }, 'owned');
    assert.equal(
      requestSignal.aborted,
      false,
      'another window cannot cancel this request',
    );
    events['chat-cancel']({ sender }, 'owned');
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(pending, /failed or was stopped/);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('Electron relay emits live SSE chunks without buffering the reply', async () => {
  const events = [];
  const result = await requestGlm(
    {
      operation: 'chat/completions',
      authorization: 'Bearer key',
      body: '{"stream":true}',
    },
    new AbortController().signal,
    async () =>
      new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    (event) => events.push(event),
  );
  assert.equal(events[0].type, 'start');
  assert.ok(
    events.some(
      (event) => event.type === 'chunk' && event.text.includes('[DONE]'),
    ),
  );
  assert.equal(events.at(-1).type, 'end');
  assert.equal(result.streamed, true);
  assert.equal(result.body, '');
});
