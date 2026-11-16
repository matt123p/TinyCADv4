import { ModelOutputLimitError, isModelOutputLimit } from './errors';
import { readProviderStream } from './stream';
import { isChatGptModel, modelOutputTokens } from './models';
import { thinkingParameters } from './thinking';
import {
  Attachment,
  ChatAuth,
  ChatMessage,
  ChatTransport,
  ProviderSettings,
  ToolSpec,
} from './types';

const dataUrl = (f: Attachment) => `data:${f.mime};base64,${f.data}`;
const json = (value: unknown) => JSON.stringify(value ?? null);
const text = (s: string) => ({ type: 'text', text: s || ' ' });
export function toolPayload(result: import('./types').ToolResult): unknown {
  if (
    !result.images?.length ||
    !result.data ||
    typeof result.data !== 'object' ||
    Array.isArray(result.data)
  )
    return result.data;
  const { svg, ...data } = result.data as Record<string, unknown>;
  return svg
    ? {
        ...data,
        preview: 'PNG vision input attached; duplicate SVG text omitted.',
      }
    : data;
}
function openaiFile(f: Attachment) {
  if (f.mime.startsWith('image/'))
    return { type: 'image_url', image_url: { url: dataUrl(f) } };
  return { type: 'file', file: { filename: f.name, file_data: dataUrl(f) } };
}
function claudeFile(f: Attachment) {
  return {
    type: f.mime === 'application/pdf' ? 'document' : 'image',
    source: { type: 'base64', media_type: f.mime, data: f.data },
  };
}
export function providerRequest(
  settings: ProviderSettings,
  messages: ChatMessage[],
  system: string,
  tools: ToolSpec[],
) {
  const { provider, model, maxTokens } = settings;
  const thinking = thinkingParameters(settings);
  if (provider === 'anthropic') {
    const native: any[] = [];
    for (const m of messages) {
      const content =
        m.role === 'assistant'
          ? m.native ?? [
              ...(m.text ? [text(m.text)] : []),
              ...(m.calls || []).map((call) => ({
                type: 'tool_use',
                id: call.id,
                name: call.name,
                input: call.arguments,
              })),
            ]
          : m.role === 'tool'
          ? [
              {
                type: 'tool_result',
                tool_use_id: m.call.id,
                is_error: !!m.result.error,
                content: [
                  text(json(toolPayload(m.result))),
                  ...(m.result.images || []).map(claudeFile),
                ],
              },
            ]
          : [text(m.text), ...(m.attachments || []).map(claudeFile)];
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (native[native.length - 1]?.role === role)
        native[native.length - 1].content.push(...(content as any[]));
      else native.push({ role, content });
    }
    return {
      path: '/messages',
      body: {
        model,
        max_tokens: maxTokens,
        ...thinking,
        system,
        messages: native,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      },
    };
  }
  if (provider === 'gemini') {
    const contents: any[] = [];
    for (const m of messages) {
      const parts =
        m.role === 'assistant'
          ? m.native ?? [
              ...(m.text ? [{ text: m.text }] : []),
              ...(m.calls || []).map((call) => ({
                functionCall: {
                  id: call.id,
                  name: call.name,
                  args: call.arguments,
                },
              })),
            ]
          : m.role === 'tool'
          ? [
              {
                functionResponse: {
                  id: m.call.id,
                  name: m.call.name,
                  response: {
                    result: toolPayload(m.result),
                    error: !!m.result.error,
                  },
                },
              },
              ...(m.result.images || []).map((f) => ({
                inlineData: { mimeType: f.mime, data: f.data },
              })),
            ]
          : [
              { text: m.text || ' ' },
              ...(m.attachments || []).map((f) => ({
                inlineData: { mimeType: f.mime, data: f.data },
              })),
            ];
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (contents[contents.length - 1]?.role === role)
        contents[contents.length - 1].parts.push(...(parts as any[]));
      else contents.push({ role, parts });
    }
    return {
      path: `/models/${encodeURIComponent(model)}:generateContent`,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens, ...thinking },
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ],
      },
    };
  }
  const native: any[] = [{ role: 'system', content: system }];
  // Images are sent AFTER all parallel tool responses to keep tool-call adjacency.
  let images: Attachment[] = [];
  const flushImages = () => {
    if (images.length)
      native.push({
        role: 'user',
        content: [
          text('Tool preview images, in call order.'),
          ...images.map(openaiFile),
        ],
      });
    images = [];
  };
  for (const m of messages) {
    if (m.role !== 'tool') flushImages();
    if (m.role === 'tool') {
      native.push({
        role: 'tool',
        tool_call_id: m.call.id,
        content: json(toolPayload(m.result)),
      });
      images.push(...(m.result.images || []));
    } else if (m.role === 'assistant')
      native.push(
        m.native ?? {
          role: 'assistant',
          content: m.text || null,
          ...(m.calls?.length
            ? {
                tool_calls: m.calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: json(c.arguments) },
                })),
              }
            : {}),
        },
      );
    else
      native.push({
        role: 'user',
        content: [text(m.text), ...(m.attachments || []).map(openaiFile)],
      });
  }
  flushImages();
  return {
    path: '/chat/completions',
    body: {
      model,
      ...thinking,
      messages: native,
      ...(provider === 'openai'
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
      tools: tools.map((t) => ({ type: 'function', function: t })),
      tool_choice: 'auto',
    },
  };
}

export function parseProviderResponse(
  provider: ProviderSettings['provider'],
  body: any,
): ChatMessage {
  if (provider === 'anthropic') {
    if (body.stop_reason === 'max_tokens') throw new ModelOutputLimitError();
    if (!Array.isArray(body.content))
      throw new Error('Provider returned no message.');
    return {
      role: 'assistant',
      native: body.content,
      reasoning: body.content
        .filter(
          (p: any) => p.type === 'thinking' && typeof p.thinking === 'string',
        )
        .map((p: any) => p.thinking)
        .join('\n'),
      text: body.content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join('\n'),
      calls: body.content
        .filter((p: any) => p.type === 'tool_use')
        .map((p: any) => ({ id: p.id, name: p.name, arguments: p.input })),
    };
  }
  if (provider === 'gemini') {
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS')
      throw new ModelOutputLimitError();
    if (candidate?.finishReason && candidate.finishReason !== 'STOP')
      throw new Error(
        `Gemini stopped: ${candidate.finishReason}. Check model/output settings.`,
      );
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts))
      throw new Error(
        'Gemini returned no content. Check the model and safety response.',
      );
    return {
      role: 'assistant',
      native: parts,
      reasoning: parts
        .filter((p: any) => p.thought && typeof p.text === 'string')
        .map((p: any) => p.text)
        .join(body.streaming ? '' : '\n'),
      text: parts
        .filter((p: any) => p.text && !p.thought)
        .map((p: any) => p.text)
        .join(body.streaming ? '' : '\n'),
      calls: parts
        .filter((p: any) => p.functionCall)
        .map((p: any, i: number) => ({
          id: p.functionCall.id || `gemini-${i}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args || {},
        })),
    };
  }
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new ModelOutputLimitError();
  const message = choice?.message;
  if (!message) throw new Error('Provider returned no assistant message.');
  return {
    role: 'assistant',
    native: message,
    reasoning:
      typeof message.reasoning_content === 'string'
        ? message.reasoning_content
        : typeof message.reasoning_summary === 'string'
        ? message.reasoning_summary
        : undefined,
    text: message.content || message.refusal || '',
    calls: (message.tool_calls || []).map((c: any) => ({
      id: c.id,
      name: c.function.name,
      arguments:
        typeof c.function.arguments === 'string'
          ? JSON.parse(c.function.arguments)
          : c.function.arguments,
    })),
  };
}

function googleOAuthFailure(status: number): Error {
  return new Error(
    status === 401
      ? 'Google authorization expired or was revoked. Reconnect your Google account for Gemini.'
      : status === 403
      ? 'Google denied Gemini access. Enable the Generative Language API in the selected Google Cloud project and check billing, project permissions and the Service Usage Consumer role.'
      : status === 429
      ? 'The Google Cloud project reached a Gemini API quota or billing limit. Check the project in Google Cloud.'
      : `Google Gemini HTTP ${status}. Check the selected project and its Gemini API access.`,
  );
}
export function createTransport(
  settings: ProviderSettings,
  auth: ChatAuth,
  send: typeof fetch = fetch,
): ChatTransport {
  thinkingParameters(settings);
  const base = new URL(settings.endpoint);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(
        base.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      ))
  )
    throw new Error(
      'Use an HTTPS API base URL, or HTTP on localhost. Do not put credentials in the URL.',
    );
  if (
    settings.provider === 'ollama' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  )
    throw new Error(
      'Use a localhost Ollama API URL. Use OpenAI compatible for a remote server.',
    );
  if (!settings.model.trim())
    throw new Error('Enter a model ID supported by your provider.');
  if (
    !Number.isInteger(settings.maxTokens) ||
    settings.maxTokens < 256 ||
    settings.maxTokens > 131072
  )
    throw new Error('Maximum output tokens must be 256–131072.');
  let outputBudget = settings.maxTokens;
  const outputLimit = Math.max(
    settings.maxTokens,
    modelOutputTokens(settings.provider, settings.model),
  );
  return {
    async complete(messages, system, tools, signal, progress) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const request = providerRequest(
          { ...settings, maxTokens: outputBudget },
          messages,
          system,
          tools,
        );
        progress?.({
          kind: 'request',
          text: `Requesting ${settings.model} · ${
            settings.thinkingLevel || 'default'
          } thinking · ${messages.length} conversation messages`,
        });
        if (settings.provider === 'gemini')
          request.path = request.path.replace(
            ':generateContent',
            ':streamGenerateContent?alt=sse',
          );
        else (request.body as any).stream = true;
        const headers = await auth.headers(signal);
        if (settings.provider === 'anthropic') {
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }
        let response: Response;
        try {
          response = await send(
            base.href.replace(/\/$/, '') + request.path,
            {
              method: 'POST',
              redirect: 'error',
              credentials: 'omit',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: json(request.body),
              signal,
            },
          );
        } catch (e) {
          if (signal.aborted) throw e;
          throw new Error(
            settings.provider === 'ollama'
              ? 'Could not reach local Ollama. Start Ollama, check its API URL, and allow this TinyCAD origin using OLLAMA_ORIGINS. See Ollama setup instructions.'
              : 'Could not reach the provider. Check the API base URL, connectivity and browser CORS support.',
          );
        }
        if (!response.ok) {
          if (settings.provider === 'gemini' && headers.Authorization)
            throw googleOAuthFailure(response.status);
          // Do not echo arbitrary provider bodies: they may contain keys or documents.
          const retry = response.headers.get('retry-after');
          throw new Error(
            `Provider HTTP ${response.status}.${
              retry ? ` Retry after ${retry}.` : ''
            } Check the key, model and provider limits.`,
          );
        }
        try {
          progress?.({
            kind: 'response',
            text: `${settings.model} is responding`,
          });
          const body = response.headers
            .get('content-type')
            ?.includes('text/event-stream')
            ? await readProviderStream(
                response,
                settings.provider,
                signal,
                progress,
              )
            : await response.json();
          return parseProviderResponse(settings.provider, body);
        } catch (error) {
          if (!isModelOutputLimit(error)) throw error;
          if (attempt >= 2 || outputBudget >= outputLimit)
            throw new ModelOutputLimitError(
              'The model could not finish within its output limit. Completed edits are preserved. Try a smaller step or a lower thinking level.',
            );
          outputBudget = Math.min(outputLimit, outputBudget * 2);
          progress?.({
            kind: 'retry',
            text: `The reply was cut short. Increasing the reply allowance to ${outputBudget.toLocaleString()} tokens before running any tools.`,
          });
        }
      }
      throw new ModelOutputLimitError();
    },
  };
}
export function byokAuth(
  provider: ProviderSettings['provider'],
  key: string,
): ChatAuth {
  return {
    async headers() {
      if (provider === 'ollama') return {};
      if (!key.trim()) throw new Error('Enter your API key.');
      if (provider === 'anthropic') return { 'x-api-key': key.trim() };
      if (provider === 'gemini') return { 'x-goog-api-key': key.trim() };
      return { Authorization: `Bearer ${key.trim()}` };
    },
  };
}

export async function listProviderModels(
  settings: ProviderSettings,
  auth: ChatAuth,
  signal: AbortSignal,
  send: typeof fetch = fetch,
): Promise<string[]> {
  // Reuse the same endpoint validation without making a completion request.
  createTransport(
    {
      ...settings,
      model: settings.model || 'model-list',
      thinkingLevel: 'default',
    },
    auth,
    send,
  );
  const base = settings.endpoint.replace(/\/$/, '');
  const headers = await auth.headers(signal);
  if (settings.provider === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const ids = new Set<string>();
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const query = cursor
      ? `?${new URLSearchParams({
          [settings.provider === 'gemini' ? 'pageToken' : 'after_id']: cursor,
        })}`
      : '';
    const response = await send(
      `${base}/models${query}`,
      {
        headers,
        signal,
        credentials: 'omit',
        redirect: 'error',
      },
    );
    if (!response.ok && settings.provider === 'gemini' && headers.Authorization)
      throw googleOAuthFailure(response.status);
    if (!response.ok)
      throw new Error(
        `Model list HTTP ${response.status}. Enter a model ID manually if this endpoint does not list models.`,
      );
    const data = await response.json();
    for (const model of data.data || data.models || []) {
      const id = model.id || model.name?.replace(/^models\//, '');
      if (
        typeof id === 'string' &&
        (settings.provider !== 'openai' || isChatGptModel(id)) &&
        (!model.supportedGenerationMethods ||
          model.supportedGenerationMethods.includes('generateContent'))
      )
        ids.add(id);
    }
    cursor = data.nextPageToken || (data.has_more ? data.last_id : '');
    if (!cursor) break;
  }
  return Array.from(ids).sort();
}
