// Exercise the Electron renderer in Playwright. HTTP is only a test transport
// for the existing account/stream mocks; production Electron uses real IPC.
export async function installElectronBridge(page) {
  await page.addInitScript(() => {
    const listeners = new Set();
    let csrf = '';
    window.electronAPI = {
      ...Object.fromEntries([
        'fileLoaded', 'recentFiles', 'libraryLoaded', 'libraryLoadFailed',
        'libraries', 'onMenuCommand', 'onMenuCommandWithData', 'onAppClosing',
        'onSimulation',
      ].map(name => [name, () => () => {}])),
      setTitle() {},
      async onlineLibraryRequest(resource) {
        const response = await fetch('https://www.tinycad.net' + resource);
        return {
          status: response.status, statusText: response.statusText,
          contentType: response.headers.get('content-type'), body: await response.text(),
        };
      },
      setMenuMode() {},
      openExternal: async url => { window.open(url, '_blank'); },
      chatSecret: async () => ({ result: { secure: false } }),
      async chatgptAccount(operation, args) {
        const session = operation === 'session';
        const response = await fetch('/api/chat/chatgpt/account', {
          method: session ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-TinyCAD-ChatGPT': csrf },
          body: session ? undefined : JSON.stringify({ operation, args }),
        });
        if (!response.ok) return { result: { available: true, connected: false } };
        const reply = await response.json();
        if (session) csrf = reply.result?.csrf || '';
        return reply;
      },
      onChatGPTStream(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      cancelChatGPTRequest() {},
      async chatgptRequest({ id, body }) {
        const response = await fetch('/api/chat/chatgpt/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-TinyCAD-ChatGPT': csrf },
          body: JSON.stringify(body),
        });
        if (!response.ok) return response.json();
        const emit = event => listeners.forEach(callback => callback({ id, ...event }));
        emit({ type: 'start', status: response.status });
        emit({ type: 'chunk', text: await response.text() });
        emit({ type: 'end' });
        return { streamed: true };
      },
    };
  });
}
