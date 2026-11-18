import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  readdir,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  ChatSecretStore,
  secureEncryption,
  registerChatSecretHandlers,
} from '../../electron/chat-secrets.js';
import { ChatGPTRuntime } from '../../chatgpt/runtime.js';
import { pathToFileURL } from 'node:url';

const encryption = (() => {
  const key = randomBytes(32);
  return {
    encrypt(text) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
    },
    decrypt(text) {
      const bytes = Buffer.from(text, 'base64');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString('utf8');
    },
  };
})();
const credential = {
  provider: 'compatible',
  endpoint: 'https://llm.example/v1',
  key: 'never-plaintext-api-key',
};
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tinycad-secrets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('API key survives a new process store encrypted, and clear removes the saved credential', async (t) => {
  const dir = await directory(t),
    store = new ChatSecretStore(dir, encryption);
  assert.deepEqual(await store.command('save', credential), { secure: true });
  const disk = await readFile(join(dir, 'api-key.json'), 'utf8');
  assert.equal(disk.includes(credential.key), false);
  assert.deepEqual(
    await new ChatSecretStore(dir, encryption).command('load'),
    credential,
  );
  if (process.platform !== 'win32')
    assert.equal((await stat(join(dir, 'api-key.json'))).mode & 0o777, 0o600);
  await store.command('clear');
  assert.deepEqual(await store.command('load'), {});
  assert.deepEqual(await readdir(dir), []);
});

test('without OS storage a key stays only in memory, replaces an older saved key, and disappears on restart', async (t) => {
  const dir = await directory(t);
  await new ChatSecretStore(dir, encryption).command('save', credential);
  const store = new ChatSecretStore(dir);
  assert.deepEqual(await store.command('status'), { secure: false });
  assert.deepEqual(await store.command('load'), {});
  await store.command('save', credential);
  assert.deepEqual(await store.command('load'), credential);
  assert.deepEqual(await readdir(dir), []);
  assert.deepEqual(await new ChatSecretStore(dir).command('load'), {});
  await store.command('clear');
  assert.deepEqual(await store.command('load'), {});
});

test('locked or corrupt ciphertext is retained and never returned as a key; encryption failure writes no plaintext', async (t) => {
  const dir = await directory(t);
  await new ChatSecretStore(dir, encryption).command('save', credential);
  const file = join(dir, 'api-key.json'),
    before = await readFile(file, 'utf8');
  const broken = {
    encrypt() {
      throw new Error('private provider failure');
    },
    decrypt() {
      throw new Error();
    },
  };
  const store = new ChatSecretStore(dir, broken);
  await assert.rejects(store.command('load'), /Could not unlock/);
  await assert.rejects(store.command('save', credential));
  assert.equal(await readFile(file, 'utf8'), before);
  await store.command('clear');
  assert.deepEqual(await store.command('load'), {});
});

test('secureStorage rejects unavailable keyrings and Linux basic_text and uses OS encryption otherwise', () => {
  assert.equal(
    secureEncryption({ isEncryptionAvailable: () => false }),
    undefined,
  );
  assert.equal(
    secureEncryption(
      {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text',
      },
      'linux',
    ),
    undefined,
  );
  assert.equal(
    secureEncryption({
      isEncryptionAvailable() {
        throw new Error();
      },
    }),
    undefined,
  );
  const adapter = secureEncryption({
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(encryption.encrypt(s)),
    decryptString: (b) => encryption.decrypt(b.toString()),
  });
  assert.equal(adapter.decrypt(adapter.encrypt('sensitive')), 'sensitive');
});

test('secret IPC rejects remote frames and subframes and validates API credentials', async (t) => {
  const dir = await directory(t),
    handlers = {};
  const app = { isPackaged: true, getPath: () => dir, getAppPath: () => dir };
  registerChatSecretHandlers(
    {
      handle(name, handler) {
        handlers[name] = handler;
      },
    },
    {
      app,
      safeStorage: { isEncryptionAvailable: () => false },
    },
  );
  const frame = {
    url: pathToFileURL(join(dir, 'dist', 'index-electron.html')).href,
  };
  const sender = { mainFrame: frame };
  const invoke = (senderFrame, request) =>
    handlers['chat-secret']({ sender, senderFrame }, request);
  assert.ok(
    (
      await invoke(
        { url: 'https://evil.example' },
        { operation: 'save', value: credential },
      )
    ).error,
  );
  assert.ok((await invoke({ ...frame }, { operation: 'load' })).error);
  assert.ok(
    (
      await invoke(frame, {
        operation: 'save',
        value: { ...credential, extra: 'forbidden' },
      })
    ).error,
  );
  assert.ok(
    (
      await invoke(frame, {
        operation: 'save',
        value: { ...credential, key: 'bad\r\nkey' },
      })
    ).error,
  );
  await invoke(frame, { operation: 'save', value: credential });
  assert.deepEqual(
    (await invoke(frame, { operation: 'load' })).result,
    credential,
  );
  await invoke(frame, { operation: 'clear' });
  assert.deepEqual((await invoke(frame, { operation: 'load' })).result, {});
});

const account = () => ({
  version: 1,
  hostId: 'urn:uuid:stable-host',
  activeId: 'account',
  profiles: [
    {
      id: 'account',
      clientId: 'oaiapp_tinycad',
      identity: { subject: 'subject', email: 'test@example.test' },
      scopes: ['chatgpt.tokens.use.direct'],
      credentials: {
        accessToken: 'private-oauth-access',
        refreshToken: 'private-oauth-refresh',
        expiresAt: Date.now() + 3600000,
      },
    },
  ],
});

test('legacy plaintext OAuth credentials migrate to encrypted storage and survive restart', async (t) => {
  const dir = await directory(t),
    state = account();
  await writeFile(join(dir, 'accounts.json'), JSON.stringify(state));
  const runtime = new ChatGPTRuntime({ storageDir: dir, encryption });
  assert.equal((await runtime.session()).connected, true);
  const disk = await readFile(join(dir, 'accounts.json'), 'utf8');
  assert.equal(disk.includes('private-oauth'), false);
  assert.equal(JSON.parse(disk).encrypted, true);
  const restored = new ChatGPTRuntime({ storageDir: dir, encryption });
  assert.equal(await restored.access(), 'private-oauth-access');
  assert.equal((await restored.session()).secureStorage, true);
});

test('legacy plaintext OAuth credentials become memory-only without OS storage; logout cannot resurrect them', async (t) => {
  const dir = await directory(t);
  await writeFile(join(dir, 'accounts.json'), JSON.stringify(account()));
  const runtime = new ChatGPTRuntime({
    storageDir: dir,
    memoryCredentials: true,
    send: async () => {
      throw new Error();
    },
  });
  assert.equal(await runtime.access(), 'private-oauth-access');
  assert.equal((await runtime.session()).memoryOnly, true);
  const disk = await readFile(join(dir, 'accounts.json'), 'utf8');
  assert.equal(disk.includes('private-oauth'), false);
  const restarted = new ChatGPTRuntime({
    storageDir: dir,
    memoryCredentials: true,
  });
  assert.equal((await restarted.session()).connected, false);
  assert.equal(JSON.parse(disk).hostId, 'urn:uuid:stable-host');
  assert.equal((await runtime.logout()).remoteRevoked, false);
  assert.equal((await runtime.session()).connected, false);
  await assert.rejects(runtime.access(), /Sign in/);
});

test('an unavailable keyring preserves old encrypted OAuth data until an explicit replacement or sign-out', async (t) => {
  const dir = await directory(t);
  const writer = new ChatGPTRuntime({ storageDir: dir, encryption });
  await writer.locked(async () => writer.save(account()));
  const before = await readFile(join(dir, 'accounts.json'), 'utf8');
  const runtime = new ChatGPTRuntime({
    storageDir: dir,
    memoryCredentials: true,
    send: async () => {
      throw new Error();
    },
  });
  assert.equal((await runtime.session()).connected, false);
  assert.equal(await readFile(join(dir, 'accounts.json'), 'utf8'), before);
  await runtime.locked(async () => runtime.save(account()));
  assert.equal(
    (await readFile(join(dir, 'accounts.json'), 'utf8')).includes(
      'private-oauth',
    ),
    false,
  );
  assert.equal(await runtime.access(), 'private-oauth-access');
  await runtime.logout();
  assert.equal((await runtime.session()).connected, false);
  assert.equal(
    (await new ChatGPTRuntime({ storageDir: dir, encryption }).session())
      .connected,
    false,
  );
});

test('sign-out with an unavailable keyring removes the inaccessible saved session', async (t) => {
  const dir = await directory(t),
    writer = new ChatGPTRuntime({ storageDir: dir, encryption });
  await writer.locked(async () => writer.save(account()));
  const runtime = new ChatGPTRuntime({
    storageDir: dir,
    memoryCredentials: true,
  });
  assert.equal((await runtime.logout()).remoteRevoked, false);
  const restored = new ChatGPTRuntime({ storageDir: dir, encryption });
  assert.equal((await restored.session()).connected, false);
});
