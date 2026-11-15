import { ResponseOutput } from './response-output';
import { citedText } from './citations';
import { isElectron } from '../io/apiServer';
import {
  ChatMessage,
  ChatProgress,
  ChatTransport,
  ProviderSettings,
  ToolSpec,
  Attachment,
} from './types';
import { toolPayload } from './providers';
import { thinkingParameters } from './thinking';
import { ModelOutputLimitError } from './errors';

export interface ChatGPTAccount {
  available: boolean;
  connected?: boolean;
  sharing?: boolean;
  pending?: boolean;
  loginId?: string;
  profileId?: string;
  identity?: { email?: string; name?: string };
  profiles?: { id: string; label: string; connected: boolean }[];
  error?: { message: string; code?: string };
  remoteRevoked?: boolean;
}
let csrf = '';
function failure(error: {
  message?: string;
  code?: string;
  requestId?: string;
}) {
  const message =
    error.code === 'subscription_sharing_usage_limit_exceeded'
      ? 'ChatGPT plan usage limit reached. Open Manage usage to review your app and account limits.'
      : error.code === 'subscription_sharing_usage_unavailable'
      ? 'ChatGPT usage checks are temporarily unavailable. Try again later.'
      : error.code === 'subscription_sharing_user_not_eligible'
      ? 'This ChatGPT account or workspace is not eligible. Choose another account or use an API key.'
      : error.message || 'ChatGPT could not complete this request.';
  return Object.assign(
    new Error(
      `${message}${error.requestId ? ` Request ID: ${error.requestId}` : ''}`,
    ),
    { code: error.code },
  );
}
export async function chatGPTAccount(
  operation: string,
  args?: Record<string, unknown>,
): Promise<any> {
  if (isElectron) {
    if (!window.electronAPI?.chatgptAccount)
      throw new Error('Restart TinyCAD to enable ChatGPT sign-in.');
    const reply = await window.electronAPI.chatgptAccount(operation, args);
    if (reply.error) throw failure(reply.error);
    return reply.result;
  }
  const session = operation === 'session';
  const response = await fetch('/api/chat/chatgpt/account', {
    method: session ? 'GET' : 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: session
      ? {}
      : { 'Content-Type': 'application/json', 'X-TinyCAD-ChatGPT': csrf },
    body: session ? undefined : JSON.stringify({ operation, args }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok && response.status === 404)
    throw new Error(
      'ChatGPT sign-in is available in TinyCAD Desktop and locally hosted TinyCAD. Start the local ChatGPT runtime to use it in this browser.',
    );
  let reply;
  try {
    reply = await response.json();
  } catch {
    throw new Error(
      'ChatGPT sign-in is unavailable on this TinyCAD host. Use TinyCAD Desktop or connect with an API key.',
    );
  }
  if (reply.error) throw failure(reply.error);
  if (!response.ok || !reply.result)
    throw new Error('Could not connect to ChatGPT sign-in.');
  if (session) csrf = reply.result.csrf || '';
  return reply.result;
}
export async function chatGPTStatus(): Promise<ChatGPTAccount> {
  try {
    return await chatGPTAccount('session');
  } catch {
    return { available: false };
  }
}
export function openChatGPTUsage() {
  if (isElectron)
    window.electronAPI.openExternal('https://chatgpt.com/settings/usage');
  else
    window.open(
      'https://chatgpt.com/settings/usage',
      '_blank',
      'noopener,noreferrer',
    );
}
const filePart = (file: Attachment) =>
  file.mime.startsWith('image/')
    ? {
        type: 'input_image',
        image_url: `data:${file.mime};base64,${file.data}`,
        detail: 'auto',
      }
    : {
        type: 'input_file',
        filename: file.name,
        file_data: `data:${file.mime};base64,${file.data}`,
      };
export function chatGPTRequest(
  settings: ProviderSettings,
  messages: ChatMessage[],
  instructions: string,
  tools: ToolSpec[],
) {
  const input: any[] = [];
  for (const message of messages) {
    if (message.role === 'user')
      input.push({
        role: 'user',
        content: [
          { type: 'input_text', text: message.text || ' ' },
          ...(message.attachments || []).map(filePart),
        ],
      });
    else if (message.role === 'tool')
      input.push({
        type: 'function_call_output',
        call_id: message.call.id,
        namespace: 'tinycad',
        name: message.call.name,
        output: [
          {
            type: 'input_text',
            text: JSON.stringify(toolPayload(message.result)),
          },
          ...(message.result.images || []).map(filePart),
        ],
      });
    else {
      const native = message.native as { responses?: unknown[] };
      if (native?.responses) input.push(...native.responses);
      else {
        if (message.text)
          input.push({ role: 'assistant', content: message.text });
        for (const call of message.calls || [])
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            namespace: 'tinycad',
            arguments: JSON.stringify(call.arguments),
          });
      }
    }
  }
  const effort = thinkingParameters(settings).reasoning_effort;
  return {
    model: settings.model,
    instructions,
    input,
    store: false,
    stream: true,
    include: ['reasoning.encrypted_content', 'web_search_call.action.sources'],
    reasoning: { ...(effort ? { effort } : {}), summary: 'auto' },
    tools: [
      {
        type: 'namespace',
        name: 'tinycad',
        description:
          'Read, create, render and edit the current TinyCAD circuit and symbols.',
        tools: tools.map((tool) => ({
          type: 'function',
          ...tool,
          strict: false,
        })),
      },
      { type: 'web_search' },
    ],
  };
}
async function desktopResponse(
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const bridge = window.electronAPI;
  if (!bridge?.chatgptRequest || !bridge?.onChatGPTStream)
    throw new Error('Restart TinyCAD to enable ChatGPT sign-in.');
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let stream: ReadableStreamDefaultController<Uint8Array>,
      started = false,
      ended = false;
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      if (ended) return;
      ended = true;
      if (started) stream.error(error);
      else reject(error);
      cleanup();
    };
    const abort = () => {
      bridge.cancelChatGPTRequest(id);
      fail(new DOMException('Stopped', 'AbortError'));
    };
    unsubscribe = bridge.onChatGPTStream((event) => {
      if (event.id !== id || ended) return;
      if (event.type === 'start') {
        started = true;
        resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
              cancel() {
                bridge.cancelChatGPTRequest(id);
                ended = true;
                cleanup();
              },
            }),
            {
              status: event.status,
              headers: { 'Content-Type': 'text/event-stream' },
            },
          ),
        );
      } else if (event.type === 'chunk' && started)
        stream.enqueue(encoder.encode(event.text || ''));
      else if (event.type === 'end' && started) {
        ended = true;
        stream.close();
        cleanup();
      }
    });
    signal.addEventListener('abort', abort, { once: true });
    bridge
      .chatgptRequest({ id, body })
      .then((reply) => {
        if (reply.error) fail(failure(reply.error));
        else if (!ended)
          fail(new Error('The ChatGPT stream ended unexpectedly.'));
      })
      .catch((error) => fail(error));
  });
}
export async function readChatGPTResponse(
  response: Response,
  signal: AbortSignal,
  progress?: (event: ChatProgress) => void,
): Promise<ChatMessage> {
  if (!response.ok) {
    let error;
    try {
      error = (await response.json()).error;
    } catch {
      /* Avoid arbitrary response bodies. */
    }
    throw failure(
      error || { message: `ChatGPT request failed (HTTP ${response.status}).` },
    );
  }
  if (
    !response.headers.get('content-type')?.includes('text/event-stream') ||
    !response.body
  )
    throw new Error('ChatGPT did not return a response stream.');
  progress?.({
    kind: 'response',
    text: 'Receiving the ChatGPT response stream',
  });
  const streamedOutput = new ResponseOutput();
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    text = '',
    reasoning = '',
    completed: any,
    total = 0,
    last = 0,
    draft = '';
  const emit = (force = false) => {
    if (!force && Date.now() - last < 80) return;
    last = Date.now();
    if (reasoning) progress?.({ kind: 'reasoning', text: reasoning });
    if (text) progress?.({ kind: 'text', text });
    if (draft) progress?.({ kind: 'tool-draft', text: draft });
  };
  const consume = (data: string) => {
    if (data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'error' || event.type === 'response.failed')
      throw failure({
        ...event.response?.error,
        ...event.error,
        code: event.code || event.response?.error?.code || event.error?.code,
      });
    streamedOutput.observe(event);
    if (event.type === 'response.incomplete')
      throw new ModelOutputLimitError(
        'ChatGPT could not complete this reply. Completed circuit edits are preserved. Try a smaller step or a lower thinking level.',
      );
    if (event.type.startsWith('response.web_search_call.')) {
      draft = event.type.endsWith('.completed')
        ? 'Web search completed'
        : 'Searching the web';
      progress?.({ kind: 'web-search', text: draft });
    }
    if (
      ['response.output_item.added', 'response.output_item.done'].includes(
        event.type,
      ) &&
      event.item?.type === 'web_search_call'
    ) {
      const action = event.item.action;
      const detail =
        action?.query || action?.queries?.join('; ') || action?.url;
      draft = `${
        event.item.status === 'completed'
          ? 'Searched the web'
          : 'Searching the web'
      }${detail ? ` · ${detail}` : ''}`;
      progress?.({ kind: 'web-search', text: draft });
    }
    if (event.type === 'response.output_text.delta') text += event.delta;
    if (event.type === 'response.reasoning_summary_text.delta')
      reasoning += event.delta;
    if (
      event.type === 'response.output_item.added' &&
      event.item?.type === 'function_call'
    ) {
      draft = `Preparing tool: ${event.item.name}`;
      progress?.({ kind: 'tool-draft', text: draft });
    }
    if (event.type === 'response.function_call_arguments.delta') {
      draft = `Receiving tool arguments · ${event.delta.length.toLocaleString()} more characters`;
    }
    if (event.type === 'response.completed') {
      if (
        event.response?.status !== 'completed' ||
        !Array.isArray(event.response?.output)
      )
        throw new Error('ChatGPT returned an incomplete response.');
      completed = event.response;
    }
    emit();
  };
  const drain = () => {
    let match: RegExpExecArray;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) consume(data);
    }
  };
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 20 * 1024 * 1024)
        throw new Error('ChatGPT response exceeds the limit.');
      buffer += decoder.decode(chunk.value, { stream: true });
      drain();
    }
    signal.throwIfAborted();
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer += '\n\n';
      drain();
    }
    if (!completed)
      throw new Error(
        'ChatGPT disconnected before completing its reply. No partial tools were executed.',
      );
    emit(true);
    const output = streamedOutput.completed(completed.output);
    if (!output.length)
      throw new Error(
        'ChatGPT returned an empty reply. Try again or choose another available model. No tools were executed for this reply.',
      );
    return {
      role: 'assistant',
      native: { responses: output },
      text: output
        .filter((item: any) => item.type === 'message')
        .flatMap((item: any) => item.content || [])
        .map((part: any) => citedText(part))
        .join('\n'),
      webSearches: output
        .filter((item: any) => item.type === 'web_search_call')
        .map((item: any) => ({
          id: item.id,
          status: item.status,
          action: item.action,
        })),
      reasoning: output
        .filter((item: any) => item.type === 'reasoning')
        .flatMap((item: any) => item.summary || [])
        .map((part: any) => part.text || '')
        .join('\n'),
      calls: output
        .filter((item: any) => item.type === 'function_call')
        .map((item: any) => {
          if (item.namespace && item.namespace !== 'tinycad')
            throw new Error('ChatGPT requested an unknown tool namespace.');
          if (item.status === 'incomplete' || !item.call_id)
            throw new Error('ChatGPT returned an incomplete tool call.');
          return {
            id: item.call_id,
            name: item.name,
            arguments: JSON.parse(item.arguments),
          };
        }),
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function createChatGPTTransport(
  settings: ProviderSettings,
  profileId?: string,
): ChatTransport {
  return {
    async complete(messages, system, tools, signal, progress) {
      progress?.({
        kind: 'request',
        text: `Requesting ${settings.model} using your ChatGPT plan · ${messages.length} conversation messages`,
      });
      const body = {
        ...chatGPTRequest(settings, messages, system, tools),
        _profileId: profileId,
      };
      const response = isElectron
        ? await desktopResponse(body, signal)
        : await fetch('/api/chat/chatgpt/responses', {
            method: 'POST',
            redirect: 'error',
            credentials: 'omit',
            headers: {
              'Content-Type': 'application/json',
              'X-TinyCAD-ChatGPT': csrf,
            },
            body: JSON.stringify(body),
            signal,
          });
      return readChatGPTResponse(response, signal, progress);
    },
  };
}
