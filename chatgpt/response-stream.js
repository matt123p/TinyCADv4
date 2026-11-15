import { ChatGPTError, inferenceError } from './runtime.js';

const fields = ['data:', 'event:', ':', 'id:', 'retry:'];
function streamFailure(response, text = '') {
  const media = response.headers.get('content-type')?.split(';')[0]?.trim();
  const contentType =
    media && /^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(media) ? media : 'missing';
  const requestId = response.headers.get('x-request-id');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    /* Never echo arbitrary bodies, prompts or credentials. */
  }
  const detail = payload?.error || payload?.response?.error;
  const error = detail?.code
    ? inferenceError(detail.code, 502, requestId)
    : new ChatGPTError(
        'invalid_stream',
        'ChatGPT returned no recognizable response stream.',
        502,
        requestId,
      );
  const param =
    typeof detail?.param === 'string' &&
    /^[a-z\d_.\[\]-]{1,100}$/i.test(detail.param)
      ? detail.param
      : undefined;
  error.message += ` Upstream HTTP ${
    response.status
  }; content type: ${contentType}.${param ? ` Parameter: ${param}.` : ''}`;
  return error;
}

// Some intermediaries strip Content-Type from valid SSE. Inspect a bounded
// prefix before opening the downstream stream rather than trusting the header.
// The client still requires response.completed before executing any tools.
export async function relayChatGPTStream(response, signal, notify) {
  if (!response.body) throw streamFailure(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    pending = '',
    started = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20 * 1024 * 1024)
        throw new ChatGPTError(
          'response_too_large',
          'ChatGPT response exceeds the limit.',
        );
      const text = decoder.decode(chunk.value, { stream: true });
      if (started) {
        notify({ type: 'chunk', text });
        continue;
      }
      pending += text;
      const prefix = pending.trimStart();
      if (fields.some((field) => prefix.startsWith(field))) {
        started = true;
        notify({ type: 'start', status: response.status });
        notify({ type: 'chunk', text: pending });
        pending = '';
      } else if (
        pending.length > 8192 ||
        (prefix && !fields.some((field) => field.startsWith(prefix)))
      ) {
        throw streamFailure(response, pending.slice(0, 8192));
      }
    }
    if (!started) throw streamFailure(response, pending);
    notify({ type: 'chunk', text: decoder.decode() });
    notify({ type: 'end' });
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
