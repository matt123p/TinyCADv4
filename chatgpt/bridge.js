import { relayChatGPTStream } from './response-stream.js';
import { ChatGPTRuntime, safeError, ChatGPTError } from './runtime.js';
import { join } from 'node:path';
import {
  secureEncryption,
  trustedChatSender,
} from '../electron/chat-secrets.js';

export async function accountCommand(runtime, operation, args = {}) {
  if (operation === 'session') return runtime.session();
  if (operation === 'start')
    return runtime.start({
      profileId: args.profileId,
      newAccount: args.newAccount === true,
      enableSharing: args.enableSharing === true,
    });
  if (operation === 'cancel') {
    runtime.cancel(args.loginId);
    return runtime.session();
  }
  if (operation === 'select' && typeof args.profileId === 'string')
    return runtime.select(args.profileId);
  if (operation === 'logout') return runtime.logout();
  if (operation === 'models') return runtime.models(AbortSignal.timeout(30000));
  throw new ChatGPTError(
    'invalid_operation',
    'Unknown ChatGPT account operation.',
  );
}
export async function relayResponse(runtime, body, controller, notify) {
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  runtime.requests.add(controller);
  try {
    const response = await runtime.response(body, controller.signal);
    await relayChatGPTStream(response, controller.signal, notify);
  } finally {
    clearTimeout(timeout);
    runtime.requests.delete(controller);
  }
}

export function registerChatGPTHandlers(ipcMain, { app, shell, safeStorage }) {
  let runtime;
  const getRuntime = () => {
    if (!runtime) {
      const encryption = secureEncryption(safeStorage);
      runtime = new ChatGPTRuntime({
        storageDir: join(app.getPath('userData'), 'chatgpt'),
        encryption,
        memoryCredentials: !encryption,
      });
    }
    return runtime;
  };
  const pending = new Map();
  let loginOwner, loginClosed;
  const detachLogin = () => {
    if (loginOwner) loginOwner.removeListener('destroyed', loginClosed);
    loginOwner = undefined;
  };
  const trusted = (event) => trustedChatSender(event, app);
  ipcMain.handle('chatgpt-account', async (event, request) => {
    if (!trusted(event))
      return {
        error: {
          message: 'ChatGPT is only available from the TinyCAD application.',
        },
      };
    try {
      const result = await accountCommand(
        getRuntime(),
        request?.operation,
        request?.args,
      );
      if (request.operation === 'start') {
        detachLogin();
        loginOwner = event.sender;
        loginClosed = () => {
          getRuntime().cancel(result.loginId);
          detachLogin();
        };
        loginOwner.once('destroyed', loginClosed);
        try {
          await shell.openExternal(result.authUrl);
        } catch (error) {
          getRuntime().cancel(result.loginId);
          detachLogin();
          throw error;
        }
      } else if (!getRuntime().pending) detachLogin();
      // Authorization URLs may contain an ID-token hint, so keep them out of IPC.
      return {
        result:
          request.operation === 'start' ? { loginId: result.loginId } : result,
      };
    } catch (error) {
      return { error: safeError(error) };
    }
  });
  ipcMain.handle('chatgpt-request', async (event, request) => {
    if (
      !trusted(event) ||
      typeof request?.id !== 'string' ||
      request.id.length > 128 ||
      pending.size >= 16 ||
      Buffer.byteLength(JSON.stringify(request.body || {})) > 20 * 1024 * 1024
    )
      return { error: { message: 'Invalid ChatGPT request.' } };
    const key = `${event.sender.id}:${request.id}`;
    if (pending.has(key))
      return { error: { message: 'Duplicate ChatGPT request.' } };
    const controller = new AbortController();
    pending.set(key, controller);
    const destroyed = () => controller.abort();
    event.sender.once('destroyed', destroyed);
    try {
      await relayResponse(getRuntime(), request.body, controller, (chunk) => {
        if (!event.sender.isDestroyed())
          event.sender.send('chatgpt-stream', { ...chunk, id: request.id });
      });
      return { streamed: true };
    } catch (error) {
      return { error: safeError(error) };
    } finally {
      pending.delete(key);
      event.sender.removeListener('destroyed', destroyed);
    }
  });
  ipcMain.on('chatgpt-cancel', (event, id) => {
    if (trusted(event)) pending.get(`${event.sender.id}:${id}`)?.abort();
  });
  app.on('before-quit', () => {
    if (runtime?.pending) runtime.cancel(runtime.pending.id);
    runtime?.stopRequests();
  });
}
