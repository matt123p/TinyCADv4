// Fixed-origin provider relay. This runs in Electron's main process, where
// provider CORS does not apply. No key is persisted or logged.
export async function requestGlm(
  { operation, authorization, body },
  signal,
  send = fetch,
  notify,
) {
  if (
    !['models', 'chat/completions'].includes(operation) ||
    typeof authorization !== 'string' ||
    !/^Bearer [^\r\n]+$/.test(authorization) ||
    authorization.length > 4096
  )
    throw new Error('Invalid Z.AI request.');
  if (
    operation === 'chat/completions' &&
    (typeof body !== 'string' || Buffer.byteLength(body) > 20 * 1024 * 1024)
  )
    throw new Error('Invalid request body.');
  const response = await send(`https://api.z.ai/api/paas/v4/${operation}`, {
    method: operation === 'models' ? 'GET' : 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: operation === 'models' ? undefined : body,
    signal,
    redirect: 'error',
  });
  if (!response.ok)
    return {
      status: response.status,
      body: JSON.stringify({ error: 'Z.AI request failed.' }),
    };
  const streaming =
    !!notify &&
    response.headers.get('content-type')?.includes('text/event-stream');
  if (streaming) notify({ type: 'start', status: response.status });
  const decoder = new TextDecoder();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 20 * 1024 * 1024)
      throw new Error('Z.AI response exceeds the limit.');
    if (streaming)
      notify({ type: 'chunk', text: decoder.decode(chunk, { stream: true }) });
    else chunks.push(Buffer.from(chunk));
  }
  if (streaming) {
    notify({ type: 'chunk', text: decoder.decode() });
    notify({ type: 'end' });
    return { status: response.status, body: '', streamed: true };
  }
  return {
    status: response.status,
    body: Buffer.concat(chunks).toString('utf8'),
  };
}
export function registerChatHandlers(ipcMain) {
  const pending = new Map();
  ipcMain.handle('chat-request', async (event, request) => {
    if (!request || typeof request.id !== 'string' || request.id.length > 128)
      throw new Error('Invalid request ID.');
    const id = `${event.sender.id}:${request.id}`;
    if (pending.has(id) || pending.size >= 32)
      throw new Error('Too many chat requests.');
    const controller = new AbortController();
    pending.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), 180000);
    const destroyed = () => controller.abort();
    event.sender.once('destroyed', destroyed);
    try {
      return await requestGlm(request, controller.signal, fetch, (chunk) => {
        if (!event.sender.isDestroyed())
          event.sender.send('chat-stream', { ...chunk, id: request.id });
      });
    } catch {
      throw new Error('Z.AI request failed or was stopped.');
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
      event.sender.removeListener('destroyed', destroyed);
    }
  });
  ipcMain.on('chat-cancel', (event, id) =>
    pending.get(`${event.sender.id}:${id}`)?.abort(),
  );
}
