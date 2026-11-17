import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { SignJWT, generateKeyPair } from 'jose';
import {
  ChatGPTRuntime,
  verifyChatGPTIdentity,
} from '../../chatgpt/runtime.js';
import { createChatGPTServer } from '../../chatgpt/server.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tinycad-chatgpt-'));
  const requests = [];
  const runtime = new ChatGPTRuntime({
    storageDir: directory,
    verifyIdentity: async (token, clientId, nonce) => {
      assert.equal(token, 'signed-id');
      assert.ok(clientId.startsWith('oaiapp_'));
      assert.ok(nonce);
      return { subject: 'verified-subject', email: 'user@example.test' };
    },
    send: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).endsWith('/oauth/token'))
        return Response.json({
          access_token: 'private-access',
          refresh_token: 'private-refresh',
          id_token: 'signed-id',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct',
        });
      if (String(url).endsWith('/models'))
        return Response.json({
          models: [
            { slug: 'gpt-6.1-sol', visibility: 'list' },
            { slug: 'gpt-4o', visibility: 'list' },
            { slug: 'gpt-6.1-astra', visibility: 'hidden' },
          ],
        });
      if (String(url).endsWith('/openid-configuration'))
        return Response.json({
          revocation_endpoint: 'https://auth.openai.com/revoke',
        });
      if (String(url).endsWith('/revoke')) return new Response('');
      return new Response(
        'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
    ...options,
  });
  t.after(async () => {
    if (runtime.pending) runtime.cancel(runtime.pending.id);
    await rm(directory, { recursive: true, force: true });
  });
  return { runtime, directory, requests };
}
async function complete(runtime, extra = {}) {
  const login = await runtime.start();
  const auth = new URL(login.authUrl);
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({
    state: auth.searchParams.get('state'),
    code: 'one-time-code',
    client_id: 'oaiapp_tinycad',
    ...extra,
  });
  return { login, auth, response: await fetch(callback) };
}
test('SIWC verifies signature, issuer, audience, expiration and nonce before trusting identity', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const sign = (claims = {}) =>
    new SignJWT({
      sub: 'verified',
      nonce: 'nonce',
      email: 'user@example.test',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://auth.openai.com')
      .setAudience('oaiapp_tinycad')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  const token = await sign();
  assert.equal(
    (await verifyChatGPTIdentity(token, 'oaiapp_tinycad', 'nonce', publicKey))
      .subject,
    'verified',
  );
  await assert.rejects(
    verifyChatGPTIdentity(token, 'wrong-audience', 'nonce', publicKey),
  );
  await assert.rejects(
    verifyChatGPTIdentity(token, 'oaiapp_tinycad', 'wrong-nonce', publicKey),
  );
  const other = await generateKeyPair('RS256');
  await assert.rejects(
    verifyChatGPTIdentity(token, 'oaiapp_tinycad', 'nonce', other.publicKey),
  );
  const expired = await new SignJWT({ sub: 'verified', nonce: 'nonce' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://auth.openai.com')
    .setAudience('oaiapp_tinycad')
    .setIssuedAt()
    .setExpirationTime(1)
    .sign(privateKey);
  await assert.rejects(
    verifyChatGPTIdentity(expired, 'oaiapp_tinycad', 'nonce', publicKey),
  );
});
test('dynamic registration uses TinyCAD identity and PKCE, stores private credentials, exposes only account state', async (t) => {
  const { runtime, directory, requests } = await fixture(t);
  const { auth, response } = await complete(runtime);
  assert.equal(response.status, 200);
  assert.equal(auth.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(auth.searchParams.get('agent_name_hint'), 'TinyCAD');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.match(auth.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
  const session = await runtime.session();
  assert.equal(session.sharing, true);
  assert.equal(session.identity.email, 'user@example.test');
  assert.ok(!JSON.stringify(session).includes('private-'));
  const stored = JSON.parse(
    await readFile(join(directory, 'accounts.json'), 'utf8'),
  );
  assert.equal(stored.profiles[0].clientId, 'oaiapp_tinycad');
  assert.equal(
    (await stat(join(directory, 'accounts.json'))).mode & 0o777,
    0o600,
  );
  const tokenBody = requests[0].init.body;
  assert.equal(tokenBody.get('client_id'), 'oaiapp_tinycad');
  assert.equal(
    tokenBody.get('redirect_uri'),
    auth.searchParams.get('redirect_uri'),
  );
  assert.equal(tokenBody.get('resource'), 'https://api.openai.com/v1');
  const hostId = auth.searchParams.get('ext_agent_host_id');
  const next = new URL((await runtime.start()).authUrl);
  assert.equal(next.searchParams.get('client_id'), 'oaiapp_tinycad');
  assert.equal(next.searchParams.get('ext_agent_host_id'), hostId);
  assert.equal(next.searchParams.has('agent_name_hint'), false);
});
test('wrong-state callbacks never exchange codes, cancellation removes the listener', async (t) => {
  const { runtime, requests } = await fixture(t);
  const login = await runtime.start();
  const auth = new URL(login.authUrl),
    callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({
    state: 'invalid',
    code: 'code',
    client_id: 'oaiapp_bad',
  });
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(requests.length, 0);
  runtime.cancel(login.loginId);
  assert.equal((await runtime.session()).pending, false);
  await assert.rejects(fetch(callback));
});
test('identity-only sign-in is retained and cannot spend ChatGPT plan usage', async (t) => {
  const { runtime } = await fixture(t, {
    send: async () =>
      Response.json({
        access_token: 'private',
        id_token: 'signed-id',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid',
      }),
  });
  await complete(runtime);
  const session = await runtime.session();
  assert.equal(session.connected, true);
  assert.equal(session.sharing, false);
  await assert.rejects(
    runtime.models(new AbortController().signal),
    /Enable ChatGPT plan usage/,
  );
});
test('signed-in inference uses only public Responses API with permitted fields and model catalog', async (t) => {
  const { runtime, requests } = await fixture(t);
  await complete(runtime);
  assert.deepEqual(await runtime.models(new AbortController().signal), [
    'gpt-6.1-sol',
  ]);
  await runtime.response(
    {
      model: 'gpt-6.1-sol',
      tools: [{ type: 'web_search' }],
      input: [{ role: 'user', content: 'Hello' }],
      store: true,
      stream: false,
      max_output_tokens: 5,
      previous_response_id: 'bad',
      background: true,
    },
    new AbortController().signal,
  );
  const request = requests.at(-1);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(request.init.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.ok(body.include.includes('web_search_call.action.sources'));
  for (const key of ['max_output_tokens', 'previous_response_id', 'background'])
    assert.equal(key in body, false);
  assert.equal(request.init.headers.Authorization, 'Bearer private-access');
});
test('parallel refreshes are serialized and sign-out revokes before clearing local credentials', async (t) => {
  const { runtime, requests } = await fixture(t);
  await complete(runtime);
  await runtime.locked(async (state) => {
    state.profiles[0].credentials.expiresAt = 1;
    await runtime.save(state);
  });
  await Promise.all([
    runtime.models(new AbortController().signal),
    runtime.models(new AbortController().signal),
  ]);
  assert.equal(
    requests.filter((r) => r.init.body?.get?.('grant_type') === 'refresh_token')
      .length,
    1,
  );
  const result = await runtime.logout();
  assert.equal(result.remoteRevoked, true);
  assert.equal(result.connected, false);
  assert.ok(
    requests.some(
      (r) =>
        r.url === 'https://auth.openai.com/revoke' &&
        r.init.body.get('token_type_hint') === 'refresh_token',
    ),
  );
  const login = new URL((await runtime.start()).authUrl);
  assert.equal(login.searchParams.get('client_id'), 'oaiapp_tinycad');
  assert.equal(login.searchParams.has('id_token_hint'), false);
});
test('local browser broker rejects cross-site, DNS-rebound and missing-CSRF mutations', async (t) => {
  const { runtime } = await fixture(t);
  const server = createChatGPTServer(runtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${
    server.address().port
  }/api/chat/chatgpt/account`;
  assert.equal(
    (await fetch(base, { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) => {
      const request = httpRequest(
        base,
        { headers: { Host: 'evil.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end();
    }),
    403,
  );
  assert.equal(
    (
      await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"operation":"logout"}',
      })
    ).status,
    403,
  );
  const session = await (await fetch(base)).json();
  assert.ok(session.result.csrf);
  const valid = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TinyCAD-ChatGPT': session.result.csrf,
    },
    body: '{"operation":"logout"}',
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.has('Access-Control-Allow-Origin'), false);
});

test('a pinned ChatGPT account cannot silently switch to another registration for inference', async (t) => {
  const { runtime, requests } = await fixture(t);
  await complete(runtime);
  const before = requests.length;
  await assert.rejects(
    runtime.response(
      { model: 'gpt-6.1-sol', input: [], _profileId: 'another-profile' },
      new AbortController().signal,
    ),
    /active ChatGPT account changed/,
  );
  assert.equal(requests.length, before);
});
test('failed token exchange retains registration so retry does not create another app', async (t) => {
  const { runtime } = await fixture(t, {
    send: async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
  });
  const { response, auth } = await complete(runtime);
  assert.equal(response.status, 400);
  const next = new URL((await runtime.start()).authUrl);
  assert.equal(next.searchParams.get('client_id'), 'oaiapp_tinycad');
  assert.equal(
    next.searchParams.get('ext_agent_host_id'),
    auth.searchParams.get('ext_agent_host_id'),
  );
});
test('invalid signed identity never activates the new connection', async (t) => {
  const { runtime } = await fixture(t, {
    verifyIdentity: async () => {
      throw new Error('invalid signature');
    },
  });
  assert.equal((await complete(runtime)).response.status, 400);
  assert.equal((await runtime.session()).connected, false);
});
test('Electron account IPC accepts only TinyCAD main frames and never exposes credentials', async (t) => {
  const { registerChatGPTHandlers } = await import('../../chatgpt/bridge.js');
  const { EventEmitter } = await import('node:events');
  const { pathToFileURL } = await import('node:url');
  const directory = await mkdtemp(join(tmpdir(), 'tinycad-electron-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = {},
    listeners = {};
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getAppPath: () => directory,
    getPath: () => directory,
  });
  registerChatGPTHandlers(
    {
      handle(name, handler) {
        handlers[name] = handler;
      },
      on(name, handler) {
        listeners[name] = handler;
      },
    },
    {
      app,
      shell: {
        openExternal() {
          throw new Error('Should not open a browser');
        },
      },
      safeStorage: { isEncryptionAvailable: () => false },
    },
  );
  const frame = {
    url: pathToFileURL(join(directory, 'dist', 'index-electron.html')).href,
  };
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: frame });
  const valid = await handlers['chatgpt-account'](
    { sender, senderFrame: frame },
    { operation: 'session' },
  );
  assert.equal(valid.result.available, true);
  assert.equal(valid.result.connected, false);
  const remote = { url: 'https://untrusted.example/' };
  sender.mainFrame = remote;
  assert.ok(
    (
      await handlers['chatgpt-account'](
        { sender, senderFrame: remote },
        { operation: 'session' },
      )
    ).error,
  );
  sender.mainFrame = frame;
  assert.ok(
    (
      await handlers['chatgpt-account'](
        { sender, senderFrame: { ...frame } },
        { operation: 'session' },
      )
    ).error,
    'subframe cannot use account IPC',
  );
});

test('refresh timing honors earliest_refresh_at while the current token is still valid', async (t) => {
  const { runtime, requests } = await fixture(t);
  await complete(runtime);
  await runtime.locked(async (state) => {
    state.profiles[0].credentials.expiresAt = Date.now() + 30000;
    state.profiles[0].credentials.earliestRefreshAt =
      Math.floor(Date.now() / 1000) + 20;
    await runtime.save(state);
  });
  await runtime.models(new AbortController().signal);
  assert.equal(
    requests.filter(
      (request) => request.init.body?.get?.('grant_type') === 'refresh_token',
    ).length,
    0,
  );
});

test('ChatGPT relay recognizes fragmented SSE without a Content-Type header', async () => {
  const { relayChatGPTStream } = await import(
    '../../chatgpt/response-stream.js'
  );
  const source =
    '\uFEFF: heartbeat\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"Ω"}\r\n\r\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n';
  const bytes = new TextEncoder().encode(source);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
  );
  assert.equal(response.headers.get('content-type'), null);
  const events = [];
  await relayChatGPTStream(response, new AbortController().signal, (event) =>
    events.push(event),
  );
  assert.equal(events[0].type, 'start');
  assert.equal(events.at(-1).type, 'end');
  assert.equal(
    events
      .filter((event) => event.type === 'chunk')
      .map((event) => event.text)
      .join(''),
    source.replace(/^\uFEFF/, ''),
  );
});
test('ChatGPT relay rejects JSON and HTML before starting downstream and reports safe upstream metadata', async () => {
  const { relayChatGPTStream } = await import(
    '../../chatgpt/response-stream.js'
  );
  for (const [body, contentType] of [
    ['<html>private-page-content</html>', 'text/html'],
    [
      JSON.stringify({
        error: {
          code: 'subscription_sharing_usage_limit_exceeded',
          param: 'tools[0]',
          message: 'private-token',
        },
      }),
      'application/json',
    ],
  ]) {
    const events = [];
    await assert.rejects(
      relayChatGPTStream(
        new Response(body, {
          headers: {
            'Content-Type': contentType,
            'x-request-id': 'req_diagnostic',
          },
        }),
        new AbortController().signal,
        (event) => events.push(event),
      ),
      (error) => {
        assert.equal(error.status, 502);
        assert.match(error.message, /Upstream HTTP 200/);
        assert.ok(error.message.includes(contentType));
        assert.equal(error.requestId, 'req_diagnostic');
        assert.ok(!error.message.includes('private-'));
        return true;
      },
    );
    assert.equal(events.length, 0);
  }
});
test('local HTTP broker normalizes headerless upstream SSE for the browser', async (t) => {
  const { relayChatGPTStream } = await import(
    '../../chatgpt/response-stream.js'
  );
  const runtime = {
    requests: new Set(),
    session: async () => ({ available: true, connected: true, sharing: true }),
    response: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
              ),
            );
            controller.close();
          },
        }),
      ),
  };
  const server = createChatGPTServer(runtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/chat/chatgpt`;
  const state = await (await fetch(`${base}/account`)).json();
  const response = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TinyCAD-ChatGPT': state.result.csrf,
    },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.match(await response.text(), /response.completed/);
  assert.equal(runtime.requests.size, 0);
});
test('ChatGPT relay cancellation stops reading headerless streams and incomplete prefixes fail closed', async () => {
  const { relayChatGPTStream } = await import(
    '../../chatgpt/response-stream.js'
  );
  let cancelled = false;
  const abort = new AbortController();
  const pending = relayChatGPTStream(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
    abort.signal,
    () => {},
  );
  abort.abort();
  await assert.rejects(pending, /abort|Stopped/i);
  assert.equal(cancelled, true);
  await assert.rejects(
    relayChatGPTStream(
      new Response('dat'),
      new AbortController().signal,
      () => {},
    ),
    /recognizable response stream/,
  );
});

test('older multi-account stores retain only the selected account and no account-ID suffix is displayed', async (t) => {
  const { runtime, directory } = await fixture(t);
  await complete(runtime);
  const original = await runtime.session();
  await runtime.locked(async (state) => {
    state.profiles.push({
      id: 'legacy-second',
      clientId: 'oaiapp_old',
      identity: { subject: 'old-subject', email: 'old@example.test' },
      scopes: ['chatgpt.tokens.use.direct'],
      credentials: { accessToken: 'old-private-access' },
    });
    await runtime.save(state);
  });
  const session = await runtime.session();
  assert.equal(session.profileId, original.profileId);
  assert.equal(session.profiles.length, 1);
  assert.equal(session.profiles[0].label, 'user@example.test');
  const stored = JSON.parse(
    await readFile(join(directory, 'accounts.json'), 'utf8'),
  );
  assert.equal(stored.profiles.length, 1);
  assert.ok(!JSON.stringify(stored).includes('old-private-access'));
});

test('signing in with a different account replaces the saved account instead of adding another', async (t) => {
  let identity = { subject: 'first-user', email: 'first@example.test' };
  const { runtime, directory } = await fixture(t, {
    verifyIdentity: async () => identity,
  });
  await complete(runtime);
  const original = await runtime.session();
  const login = await runtime.start({ newAccount: true });
  const auth = new URL(login.authUrl);
  assert.equal(auth.searchParams.has('id_token_hint'), false);
  assert.equal((await runtime.session()).profiles.length, 1);
  identity = { subject: 'second-user', email: 'second@example.test' };
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({
    state: auth.searchParams.get('state'),
    code: 'replacement-code',
    client_id: 'oaiapp_replacement',
  });
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  const session = await runtime.session();
  assert.equal(session.identity.email, 'second@example.test');
  assert.notEqual(session.profileId, original.profileId);
  assert.equal(session.profiles.length, 1);
  const stored = JSON.parse(
    await readFile(join(directory, 'accounts.json'), 'utf8'),
  );
  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.profiles[0].identity.email, 'second@example.test');
});

test('a fresh Electron memory-only sign-in stores registration metadata without tokens and cannot resume after restart', async (t) => {
  const { runtime, directory } = await fixture(t, { memoryCredentials: true });
  const { response } = await complete(runtime);
  assert.equal(response.status, 200);
  assert.equal((await runtime.session()).connected, true);
  assert.equal(await runtime.access(), 'private-access');
  const disk = await readFile(join(directory, 'accounts.json'), 'utf8');
  assert.equal(disk.includes('private-access'), false);
  assert.equal(disk.includes('private-refresh'), false);
  assert.equal(disk.includes('signed-id'), false);
  assert.equal(disk.includes('oaiapp_tinycad'), true);
  const restored = new ChatGPTRuntime({ storageDir: directory, memoryCredentials: true });
  assert.equal((await restored.session()).connected, false);
});
