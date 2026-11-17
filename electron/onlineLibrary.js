import { trustedChatSender } from './chat-secrets.js';

const origin = 'https://www.tinycad.net';

export function registerOnlineLibrary({ ipcMain, app, getWindow, send }) {
  ipcMain.handle('online-library-request', async (event, resource) => {
    if (event.sender !== getWindow()?.webContents || !trustedChatSender(event, app))
      throw new Error('Online libraries are available only to the editor main frame.');
    if (typeof resource !== 'string' || !resource.startsWith('/'))
      throw new Error('Invalid online library request.');
    const url = new URL(resource, origin);
    if (url.origin !== origin || !['/api/search/search', '/api/search/copy'].includes(url.pathname.toLowerCase()))
      throw new Error('Invalid online library request.');
    const response = await send(url.href, {
      method: 'GET', credentials: 'omit', redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    return {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type') || 'text/plain',
      body: await response.text(),
    };
  });
}
