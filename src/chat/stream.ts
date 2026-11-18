import { ChatProgress, ProviderKind } from './types';

// Assemble provider-native responses so signed thinking/tool blocks survive the
// next turn. Never parse or execute partial tool arguments.
export async function readProviderStream(
  response: Response,
  provider: ProviderKind,
  signal: AbortSignal,
  progress?: (event: ChatProgress) => void,
): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The provider returned an empty stream.');
  let buffer = '',
    size = 0,
    complete = false,
    reasoning = '',
    text = '',
    last = 0,
    draft = '';
  let reasoningSent = '',
    textSent = '',
    draftSent = '';
  const decoder = new TextDecoder();
  const message: any = { role: 'assistant', content: '' };
  const calls: any[] = [],
    blocks: any[] = [],
    partial: string[] = [],
    parts: any[] = [];
  let finish: string, stop: string;
  const emit = (force = false) => {
    if (!force && Date.now() - last < 80) return;
    last = Date.now();
    if (reasoning && reasoning !== reasoningSent) {
      progress?.({ kind: 'reasoning', text: reasoning });
      reasoningSent = reasoning;
    }
    if (text && text !== textSent) {
      progress?.({ kind: 'text', text });
      textSent = text;
    }
    if (draft && draft !== draftSent) {
      progress?.({ kind: 'tool-draft', text: draft });
      draftSent = draft;
    }
  };
  const event = (data: string) => {
    if (data === '[DONE]') {
      complete = true;
      return;
    }
    const chunk = JSON.parse(data);
    if (chunk.error || chunk.type === 'error')
      throw new Error('The provider reported a streaming error. Try again.');
    if (provider === 'anthropic') {
      const i = chunk.index;
      if (i !== undefined && (!Number.isInteger(i) || i < 0 || i > 255))
        throw new Error('Invalid streamed block index.');
      if (chunk.type === 'content_block_start') {
        blocks[i] = { ...chunk.content_block };
        partial[i] = '';
        if (blocks[i].type === 'tool_use')
          progress?.({
            kind: 'tool-draft',
            text: `Preparing tool: ${blocks[i].name}`,
          });
      }
      if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta,
          block = blocks[i];
        if (!block) throw new Error('Invalid provider stream.');
        if (delta.type === 'text_delta') {
          block.text = (block.text || '') + delta.text;
          text += delta.text;
        }
        if (delta.type === 'thinking_delta') {
          block.thinking = (block.thinking || '') + delta.thinking;
          reasoning += delta.thinking;
        }
        if (delta.type === 'signature_delta')
          block.signature = (block.signature || '') + delta.signature;
        if (delta.type === 'input_json_delta') {
          partial[i] += delta.partial_json;
          draft = `Preparing tool: ${block.name} · ${partial[
            i
          ].length.toLocaleString()} argument characters received`;
        }
      }
      if (chunk.type === 'message_delta') stop = chunk.delta.stop_reason;
      if (chunk.type === 'message_stop') complete = true;
    } else if (provider === 'gemini') {
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        finish = candidate.finishReason;
        complete = true;
      }
      for (const part of candidate?.content?.parts || []) {
        parts.push(part);
        if (part.text) {
          if (part.thought) reasoning += part.text;
          else text += part.text;
        }
        if (part.functionCall)
          progress?.({
            kind: 'tool-draft',
            text: `Preparing tool: ${part.functionCall.name}`,
          });
      }
    } else {
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) {
        finish = choice.finish_reason;
        complete = true;
      }
      const delta = choice?.delta;
      if (delta) {
        if (typeof delta.content === 'string') text += delta.content;
        if (typeof delta.refusal === 'string') text += delta.refusal;
        const thought = delta.reasoning_content || delta.reasoning_summary;
        if (typeof thought === 'string') reasoning += thought;
        for (const call of delta.tool_calls || []) {
          const index = call.index ?? 0;
          if (!Number.isInteger(index) || index < 0 || index > 255)
            throw new Error('Invalid streamed tool index.');
          const target = (calls[index] ||= {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
          if (call.id) target.id = call.id;
          if (call.function?.name) {
            target.function.name += call.function.name;
            progress?.({
              kind: 'tool-draft',
              text: `Preparing tool: ${target.function.name}`,
            });
          }
          if (call.function?.arguments) {
            target.function.arguments += call.function.arguments;
            draft = `Preparing tool: ${
              target.function.name
            } · ${target.function.arguments.length.toLocaleString()} argument characters received`;
          }
        }
      }
    }
    emit();
  };
  const drain = () => {
    // SSE lines are terminated by LF or CRLF; frames can cross network chunks.
    let boundary: RegExpExecArray;
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) event(data);
    }
  };
  const aborted = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20 * 1024 * 1024)
        throw new Error('Provider response exceeds the limit.');
      buffer += decoder.decode(chunk.value, { stream: true });
      drain();
    }
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer += '\n\n';
      drain();
    }
    if (!complete)
      throw new Error(
        'The provider stream ended before the reply was complete. Try again.',
      );
    emit(true);
    if (provider === 'anthropic') {
      if (!stop)
        throw new Error('The provider stream ended without a stop reason.');
      blocks.forEach((block, i) => {
        if (stop !== 'max_tokens' && block.type === 'tool_use' && partial[i])
          block.input = JSON.parse(partial[i]);
      });
      // Truncated input JSON is deliberately not parsed, allowing safe retry.
      return { content: blocks, stop_reason: stop };
    }
    if (provider === 'gemini')
      return {
        streaming: true,
        candidates: [{ content: { parts }, finishReason: finish }],
      };
    if (!finish)
      throw new Error('The provider stream ended without a finish reason.');
    message.content = text;
    if (reasoning) message.reasoning_content = reasoning;
    if (calls.length) message.tool_calls = calls;
    return { choices: [{ message, finish_reason: finish }] };
  } finally {
    signal.removeEventListener('abort', aborted);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
