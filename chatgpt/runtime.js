// OpenAI's public SIWC flow for local open-source apps. No Codex client ID,
// ChatGPT cookies, backend-api routes, or API keys are used.
import { createServer } from 'node:http';
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  webcrypto,
} from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { createRemoteJWKSet, jwtVerify } from 'jose';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scopes =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class ChatGPTError extends Error {
  constructor(code, message, status = 400, requestId) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}
export function safeError(error) {
  return {
    code:
      error instanceof ChatGPTError ? error.code : 'chatgpt_connection_failed',
    message:
      error instanceof ChatGPTError
        ? error.message
        : 'ChatGPT could not complete the request. Check your connection and try again.',
    ...(error instanceof ChatGPTError && error.requestId
      ? { requestId: error.requestId }
      : {}),
  };
}
export function inferenceError(code, status = 502, requestId) {
  const messages = {
    subscription_sharing_user_not_eligible:
      'This account or workspace is not eligible for ChatGPT plan usage. Choose another account or use an API key.',
    subscription_sharing_usage_limit_exceeded:
      'ChatGPT plan usage limit reached. Open Manage usage to review your app and account limits.',
    subscription_sharing_usage_unavailable:
      'ChatGPT usage checks are temporarily unavailable. Try again later.',
    subscription_sharing_user_unavailable:
      'The ChatGPT account is temporarily unavailable. Try again later.',
    subscription_sharing_unsupported_capability:
      'This model or request capability is not supported by ChatGPT plan usage.',
    subscription_sharing_route_not_supported:
      'ChatGPT plan usage does not support this API route.',
  };
  return new ChatGPTError(
    /^[a-z0-9_]{1,100}$/.test(code || '') ? code : 'chatgpt_request_failed',
    messages[code] ||
      (status === 401
        ? 'ChatGPT did not accept this connection. Sign in again.'
        : `ChatGPT request failed (HTTP ${status}). Check your account permissions and try again.`),
    status,
    requestId,
  );
}
export async function verifyChatGPTIdentity(
  token,
  clientId,
  nonce,
  keys = jwks,
) {
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: clientId,
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  });
  if (!equal(payload.nonce, nonce)) throw new Error('Invalid nonce');
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    name: typeof payload.name === 'string' ? payload.name : '',
  };
}
export class ChatGPTRuntime {
  constructor({ storageDir, send = fetch, verifyIdentity, encryption }) {
    this.directory = storageDir;
    this.send = send;
    this.encryption = encryption;
    this.verify = verifyIdentity || verifyChatGPTIdentity;
    this.pending = null;
    this.requests = new Set();
    this.epoch = 0;
  }
  async locked(action) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.directory, {
      realpath: false,
      stale: 120000,
      retries: { retries: 120, minTimeout: 100, maxTimeout: 500 },
    });
    try {
      let state;
      try {
        const saved = JSON.parse(
          await readFile(join(this.directory, 'accounts.json'), 'utf8'),
        );
        state = saved.encrypted
          ? JSON.parse(this.encryption.decrypt(saved.data))
          : saved;
      } catch (error) {
        if (error.code !== 'ENOENT')
          throw new ChatGPTError(
            'credential_storage_unavailable',
            'Could not read the protected ChatGPT connection. Check local account storage.',
          );
        state = {
          version: 1,
          hostId: `urn:uuid:${randomUUID()}`,
          profiles: [],
        };
        await this.save(state);
      }
      // Keep only the active account when upgrading older multi-account stores.
      if (state.profiles.length > 1) {
        const profile =
          state.profiles.find((item) => item.id === state.activeId) ||
          state.profiles[0];
        state.profiles = [profile];
        state.activeId = profile.id;
        state.lastRegistration = profile.id;
        await this.save(state);
      }
      return await action(state);
    } finally {
      await release();
    }
  }
  async save(state) {
    const file = join(this.directory, 'accounts.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    const data = this.encryption
      ? {
          encrypted: true,
          data: this.encryption.encrypt(JSON.stringify(state)),
        }
      : state;
    await writeFile(temporary, JSON.stringify(data), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, file);
    await chmod(file, 0o600);
  }
  view(state) {
    const selected = state.profiles.find((p) => p.id === state.activeId);
    return {
      available: true,
      connected: !!selected?.credentials,
      sharing:
        !!selected?.credentials &&
        selected.scopes?.includes('chatgpt.tokens.use.direct'),
      profileId: selected?.id,
      identity: selected?.identity,
      profiles: state.profiles.map((p) => ({
        id: p.id,
        label: p.identity?.email || p.identity?.name || 'ChatGPT account',
        connected: !!p.credentials,
      })),
      pending: !!this.pending,
      loginId: this.pending?.id,
      ...(this.loginError ? { error: this.loginError } : {}),
    };
  }
  session() {
    return this.locked(async (state) => this.view(state));
  }
  stopRequests() {
    this.epoch++;
    for (const request of this.requests) request.abort();
  }
  async select(id) {
    if (this.pending)
      throw new ChatGPTError(
        'connection_busy',
        'Finish or cancel sign-in first.',
      );
    this.stopRequests();
    return this.locked(async (state) => {
      if (!state.profiles.some((p) => p.id === id))
        throw new ChatGPTError(
          'unknown_account',
          'Select a saved ChatGPT account.',
        );
      state.activeId = id;
      await this.save(state);
      return this.view(state);
    });
  }
  async start({ profileId, newAccount = false, enableSharing = false } = {}) {
    if (this.pending)
      throw new ChatGPTError(
        'connection_busy',
        'ChatGPT sign-in is already open.',
      );
    const pending = {
      id: randomUUID(),
      replaceAccount: newAccount,
      state: random(),
      nonce: random(),
      verifier: random(),
      controller: new AbortController(),
    };
    this.pending = pending;
    this.loginError = undefined;
    try {
      const details = await this.locked(async (state) => ({
        hostId: state.hostId,
        profile: newAccount
          ? undefined
          : state.profiles.find(
              (p) =>
                p.id ===
                (profileId || state.activeId || state.lastRegistration),
            ),
      }));
      pending.profileId = details.profile?.id;
      pending.clientId = details.profile?.clientId;
      const server = createServer(
        (request, response) => void this.callback(pending, request, response),
      );
      pending.server = server;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      pending.redirectUri = `http://127.0.0.1:${
        server.address().port
      }/auth/callback`;
      pending.timer = setTimeout(() => this.cancel(pending.id), 10 * 60 * 1000);
      pending.timer.unref();
      const url = new URL(`${issuer}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: pending.clientId || 'dynamic_agent_client',
        ...(!pending.clientId ? { agent_name_hint: 'TinyCAD' } : {}),
        ext_agent_host_id: details.hostId,
        response_type: 'code',
        redirect_uri: pending.redirectUri,
        scope: scopes,
        resource,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256')
          .update(pending.verifier)
          .digest('base64url'),
        ...(details.profile?.credentials?.idToken
          ? { id_token_hint: details.profile.credentials.idToken }
          : {}),
        ...(enableSharing ? { prompt: 'consent' } : {}),
      }).toString();
      return { loginId: pending.id, authUrl: url.href };
    } catch (error) {
      this.cancel(pending.id);
      throw error;
    }
  }
  cancel(id) {
    const pending = this.pending;
    if (!pending || pending.id !== id) return;
    this.pending = null;
    pending.controller.abort();
    clearTimeout(pending.timer);
    pending.server?.close();
    pending.server?.closeAllConnections();
  }
  async token(parameters, signal) {
    const response = await this.send(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST',
      redirect: 'error',
      body: new URLSearchParams({ ...parameters, resource }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    });
    const body = await response.json();
    if (!response.ok)
      throw new ChatGPTError(
        /^[a-z0-9_]{1,100}$/.test(body.error || '')
          ? body.error
          : 'oauth_failed',
        'ChatGPT authorization could not be renewed. Try signing in again.',
        response.status,
      );
    if (
      typeof body.access_token !== 'string' ||
      !body.access_token ||
      body.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    )
      throw new ChatGPTError(
        'invalid_token_response',
        'ChatGPT returned an invalid credential response. Sign in again.',
      );
    return body;
  }
  async callback(pending, request, response) {
    const url = new URL(request.url, pending.redirectUri);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (
      this.pending !== pending ||
      !equal(url.searchParams.get('state'), pending.state) ||
      pending.consumed
    ) {
      response.writeHead(400);
      response.end(
        'Invalid or expired sign-in. Return to TinyCAD and try again.',
      );
      return;
    }
    pending.consumed = true;
    try {
      if (url.searchParams.has('error'))
        throw new ChatGPTError(
          'authorization_declined',
          'ChatGPT sign-in was declined. You can try again or use an API key.',
        );
      const clientId = url.searchParams.get('client_id') || pending.clientId;
      if (
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        (pending.clientId && clientId !== pending.clientId)
      )
        throw new ChatGPTError(
          'invalid_registration',
          'ChatGPT returned a different or incomplete registration. Try signing in again.',
        );
      const code = url.searchParams.get('code');
      if (!code)
        throw new ChatGPTError(
          'invalid_callback',
          'ChatGPT returned no authorization code. Try signing in again.',
        );
      // Retain the issued registration even when a one-time code expires.
      const profileId = pending.profileId || randomUUID();
      await this.locked(async (state) => {
        if (!state.profiles.length || !pending.replaceAccount) {
          if (!state.profiles.some((p) => p.id === profileId))
            state.profiles.push({ id: profileId, clientId, scopes: [] });
          state.lastRegistration = profileId;
          await this.save(state);
        }
      });
      const tokens = await this.token(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: pending.verifier,
          redirect_uri: pending.redirectUri,
        },
        AbortSignal.any([
          pending.controller.signal,
          AbortSignal.timeout(60000),
        ]),
      );
      let identity;
      try {
        identity = await this.verify(tokens.id_token, clientId, pending.nonce);
      } catch {
        throw new ChatGPTError(
          'invalid_identity',
          'ChatGPT identity verification failed. Sign in again.',
        );
      }
      if (this.pending !== pending || pending.controller.signal.aborted) return;
      this.stopRequests();
      await this.locked(async (state) => {
        if (this.pending !== pending || pending.controller.signal.aborted)
          throw new Error('Cancelled');
        const profile = state.profiles.find((p) => p.id === profileId) || {
          id: profileId,
          clientId,
          scopes: [],
        };
        if (profile.identity && profile.identity.subject !== identity.subject)
          throw new ChatGPTError(
            'account_mismatch',
            'This sign-in returned a different account. Choose Sign in with a different account instead.',
          );
        profile.identity = identity;
        profile.scopes =
          typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [];
        profile.credentials = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          earliestRefreshAt: tokens.earliest_refresh_at,
        };
        state.profiles = [profile];
        state.activeId = profileId;
        state.lastRegistration = profileId;
        await this.save(state);
      });
      response.end(
        'Signed in with ChatGPT. You can close this tab and return to TinyCAD.',
      );
    } catch (error) {
      if (this.pending === pending) this.loginError = safeError(error);
      response.writeHead(400);
      response.end(
        'ChatGPT sign-in could not complete. Return to TinyCAD for details.',
      );
    } finally {
      if (this.pending === pending) {
        this.pending = null;
        clearTimeout(pending.timer);
        pending.server.close();
      }
    }
  }
  async access(signal, expectedProfileId) {
    return this.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === state.activeId);
      if (expectedProfileId && profile?.id !== expectedProfileId)
        throw new ChatGPTError(
          'account_changed',
          'The active ChatGPT account changed. Reconnect the selected account before sending another message.',
          409,
        );
      if (!profile?.credentials)
        throw new ChatGPTError(
          'sign_in_required',
          'Sign in with ChatGPT to continue.',
          401,
        );
      if (!profile.scopes?.includes('chatgpt.tokens.use.direct'))
        throw new ChatGPTError(
          'sharing_not_enabled',
          'Enable ChatGPT plan usage for this connection or use an API key.',
          403,
        );
      if (profile.credentials.expiresAt < Date.now() + 60000) {
        const earliest = profile.credentials.earliestRefreshAt;
        const refreshAt =
          typeof earliest === 'number'
            ? earliest * 1000
            : Date.parse(earliest || '');
        if (Number.isFinite(refreshAt) && refreshAt > Date.now()) {
          if (profile.credentials.expiresAt > Date.now())
            return profile.credentials.accessToken;
          throw new ChatGPTError(
            'refresh_not_ready',
            'ChatGPT cannot renew this connection yet. Try again shortly.',
            503,
          );
        }
        if (!profile.credentials.refreshToken)
          throw new ChatGPTError(
            'sign_in_required',
            'Your ChatGPT connection expired. Sign in again.',
            401,
          );
        signal?.throwIfAborted();
        let tokens;
        try {
          // Persist rotating refresh tokens even if the caller cancels.
          tokens = await this.token(
            {
              grant_type: 'refresh_token',
              client_id: profile.clientId,
              refresh_token: profile.credentials.refreshToken,
            },
            AbortSignal.timeout(60000),
          );
        } catch (error) {
          if (
            [
              'invalid_grant',
              'invalid_refresh_token',
              'token_expired',
              'refresh_token_expired',
              'refresh_token_invalidated',
              'refresh_token_reused',
            ].includes(error.code)
          ) {
            delete profile.credentials;
            profile.scopes = [];
            await this.save(state);
          }
          throw error;
        }
        profile.credentials = {
          ...profile.credentials,
          accessToken: tokens.access_token,
          refreshToken:
            tokens.refresh_token || profile.credentials.refreshToken,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          earliestRefreshAt: tokens.earliest_refresh_at,
        };
        if (typeof tokens.scope === 'string')
          profile.scopes = tokens.scope.split(/\s+/);
        await this.save(state);
        if (!profile.scopes.includes('chatgpt.tokens.use.direct'))
          throw new ChatGPTError(
            'sharing_not_enabled',
            'ChatGPT plan usage permission is no longer enabled.',
            403,
          );
      }
      return profile.credentials.accessToken;
    });
  }
  async logout() {
    if (this.pending) this.cancel(this.pending.id);
    this.stopRequests();
    let remoteRevoked = true;
    await this.locked(async (state) => {
      const profile = state.profiles.find((p) => p.id === state.activeId);
      if (profile?.credentials?.refreshToken) {
        try {
          const discovery = await this.send(
            `${issuer}/.well-known/openid-configuration`,
            { signal: AbortSignal.timeout(15000), redirect: 'error' },
          );
          const endpoint = new URL(
            (await discovery.json()).revocation_endpoint,
          );
          if (endpoint.origin !== issuer)
            throw new Error('Invalid revocation endpoint');
          const result = await this.send(endpoint.href, {
            method: 'POST',
            body: new URLSearchParams({
              token: profile.credentials.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: profile.clientId,
            }),
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
          });
          remoteRevoked = result.ok;
        } catch {
          remoteRevoked = false;
        }
      }
      if (profile) {
        delete profile.credentials;
        profile.scopes = [];
        await this.save(state);
      }
    });
    return { ...(await this.session()), remoteRevoked };
  }
  async models(signal) {
    const access = await this.access(signal);
    const response = await this.send(`${resource}/models`, {
      headers: { Authorization: `Bearer ${access}` },
      redirect: 'error',
      signal,
    });
    if (!response.ok)
      throw inferenceError(
        undefined,
        response.status,
        response.headers.get('x-request-id'),
      );
    const data = await response.json();
    return (data.models || [])
      .filter(
        (m) =>
          m.visibility === 'list' &&
          /^gpt-\d+(?:\.\d+)?-(sol|luna|astra)(?:-\d{4}-\d{2}-\d{2}|-latest)?$/i.test(
            m.slug,
          ),
      )
      .map((m) => m.slug);
  }
  async response(body, signal) {
    if (
      !body ||
      typeof body !== 'object' ||
      !Array.isArray(body.input) ||
      !/^gpt-\d+(?:\.\d+)?-(sol|luna|astra)(?:-\d{4}-\d{2}-\d{2}|-latest)?$/i.test(
        body.model || '',
      )
    )
      throw new ChatGPTError(
        'invalid_request',
        'Choose an available Sol, Luna or Astra model.',
      );
    const epoch = this.epoch;
    const access = await this.access(signal, body._profileId);
    if (epoch !== this.epoch)
      throw new ChatGPTError(
        'account_changed',
        'The active ChatGPT account changed. Send the message again.',
      );
    signal?.throwIfAborted();
    const response = await this.send(`${resource}/responses`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: body.model,
        instructions: body.instructions,
        input: body.input,
        tools: body.tools,
        reasoning: body.reasoning,
        include: [
          'reasoning.encrypted_content',
          'web_search_call.action.sources',
        ],
        store: false,
        stream: true,
      }),
      signal,
    });
    if (!response.ok) {
      let code;
      try {
        code = (await response.json()).error?.code;
      } catch {
        /* No sensitive admission bodies are echoed. */
      }
      throw inferenceError(
        code,
        response.status,
        response.headers.get('x-request-id'),
      );
    }
    return response;
  }
}
