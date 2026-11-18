import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Electron 44 safeStorage uses DPAPI on Windows, Keychain on macOS, and
// Secret Service/KWallet on Linux. Never accept Linux's hardcoded fallback key.
export function secureEncryption(safeStorage, platform = process.platform) {
  try {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (platform === 'linux' &&
        safeStorage.getSelectedStorageBackend?.() === 'basic_text')
    )
      return undefined;
    const encryption = {
      encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
      decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')),
    };
    // Availability alone does not guarantee an unlocked, functioning keyring.
    const probe = 'TinyCAD secure storage';
    if (encryption.decrypt(encryption.encrypt(probe)) !== probe)
      return undefined;
    return encryption;
  } catch {
    return undefined;
  }
}

export function trustedChatSender(event, app) {
  try {
    if (event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    url.search = '';
    url.hash = '';
    return (
      url.href ===
        pathToFileURL(join(app.getAppPath(), 'dist', 'index-electron.html'))
          .href ||
      (!app.isPackaged && url.origin === 'http://localhost:1234')
    );
  } catch {
    return false;
  }
}

export class ChatSecretStore {
  constructor(directory, encryption) {
    this.directory = directory;
    this.encryption = encryption;
    this.file = join(directory, 'api-key.json');
    this.memory = undefined;
    this.queue = Promise.resolve();
  }
  command(operation, value) {
    const action = this.queue.then(() => this.execute(operation, value));
    this.queue = action.catch(() => {});
    return action;
  }
  async execute(operation, value) {
    if (operation === 'status') return { secure: !!this.encryption };
    if (operation === 'clear') {
      await rm(this.file, { force: true });
      this.memory = undefined;
      return {};
    }
    if (operation === 'load') {
      if (this.memory) return this.memory;
      if (!this.encryption) return {};
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8'));
        if (saved.version !== 1 || typeof saved.data !== 'string')
          throw new Error();
        const record = JSON.parse(this.encryption.decrypt(saved.data));
        this.validate(record);
        return record;
      } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw new Error(
          'Could not unlock the saved API key. Reconnect your AI provider to replace it.',
        );
      }
    }
    if (operation !== 'save') throw new Error('Invalid secret operation.');
    this.validate(value);
    if (!this.encryption) {
      // Remove any previous encrypted key when replacing it in memory-only mode.
      await rm(this.file, { force: true });
      this.memory = { ...value };
      return { secure: false };
    }
    const data = this.encryption.encrypt(JSON.stringify(value));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, data }), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
    this.memory = undefined;
    return { secure: true };
  }
  validate(value) {
    if (
      !value ||
      !['openai', 'anthropic', 'gemini', 'compatible'].includes(
        value.provider,
      ) ||
      typeof value.endpoint !== 'string' ||
      value.endpoint.length > 4096 ||
      typeof value.key !== 'string' ||
      !value.key ||
      value.key.length > 16384 ||
      /[\r\n]/.test(value.key)
    )
      throw new Error('Invalid API credential.');
    // Store an allowlist, never arbitrary renderer state.
    for (const name of Object.keys(value))
      if (!['provider', 'endpoint', 'key'].includes(name))
        throw new Error('Invalid API credential.');
  }
}

export function registerChatSecretHandlers(ipcMain, { app, safeStorage }) {
  const store = new ChatSecretStore(
    join(app.getPath('userData'), 'chat'),
    secureEncryption(safeStorage),
  );
  ipcMain.handle('chat-secret', async (event, request) => {
    if (!trustedChatSender(event, app))
      return { error: 'Secrets are only available from TinyCAD.' };
    try {
      return {
        result: await store.command(request?.operation, request?.value),
      };
    } catch (error) {
      return {
        error:
          request?.operation === 'load'
            ? 'Could not unlock the saved API key. Reconnect your AI provider.'
            : 'Could not update protected API-key storage. Check your system keyring and try again.',
      };
    }
  });
}
