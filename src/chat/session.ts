import {
  Attachment,
  ChatMessage,
  ChatProgress,
  ChatTransport,
  ToolExecutor,
  ToolSpec,
} from './types';

export class ChatSession {
  messages: ChatMessage[] = [];
  private running = false;
  changeModel() {
    if (this.running)
      throw new Error('Wait for the current reply before changing models.');
    this.messages = this.messages.map((message) => {
      const { native, ...portable } = message;
      return portable;
    });
  }
  constructor(
    private system: string | (() => string),
    private tools: ToolSpec[],
    private execute: ToolExecutor,
  ) {}
  async send(
    text: string,
    attachments: Attachment[],
    transport: ChatTransport,
    signal: AbortSignal,
    changed: (messages: ChatMessage[]) => void,
  ) {
    if (this.running) throw new Error('A chat turn is already running.');
    this.running = true;
    const turn: ChatMessage = {
      role: 'user',
      text,
      attachments,
      status: 'working',
      progress: [],
      activityStarted: Date.now(),
    };
    this.messages.push(turn);
    changed([...this.messages]);
    const markViewedImages = () => {
      for (const message of this.messages) {
        if (
          message.result?.images?.length ||
          message.attachments?.some((file) => file.mime.startsWith('image/'))
        )
          message.imagesViewed = true;
      }
    };
    const report = (event: ChatProgress) => {
      turn.currentActivity =
        event.kind === 'reasoning'
          ? `Thinking: ${event.text.slice(-180)}`
          : event.kind === 'text'
          ? `Writing: ${event.text.slice(-180)}`
          : event.text;
      if (event.kind !== 'request' && event.kind !== 'response')
        turn.lastActivity = turn.currentActivity;
      if (event.kind === 'reasoning') turn.liveReasoning = event.text;
      else if (event.kind === 'text') turn.liveText = event.text;
      else if (
        event.kind === 'tool-draft' &&
        turn.progress[turn.progress.length - 1]?.kind === 'tool-draft'
      )
        turn.progress[turn.progress.length - 1] = { ...event, at: Date.now() };
      else if (event.text !== turn.progress[turn.progress.length - 1]?.text)
        turn.progress.push({ ...event, at: Date.now() });
      changed([...this.messages]);
    };
    try {
      for (let round = 0; round < 40; round++) {
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        turn.liveReasoning = '';
        turn.liveText = '';
        report({
          kind: 'request',
          text: 'Sending the conversation, drawing tools and reference files to the model',
        });
        const answer = await transport.complete(
          this.messages,
          typeof this.system === 'function' ? this.system() : this.system,
          this.tools,
          signal,
          (event) => {
            if (event.kind === 'retry') markViewedImages();
            report(event);
          },
        );
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const unseen = this.messages.some(
          (m) =>
            !m.imagesViewed &&
            (m.result?.images?.length ||
              m.attachments?.some((f) => f.mime.startsWith('image/'))),
        );
        markViewedImages();
        if (unseen) report({ kind: 'image', text: 'Model viewed an image' });
        turn.liveReasoning = '';
        turn.liveText = '';
        if (answer.reasoning)
          turn.lastActivity = `Thinking: ${answer.reasoning.slice(-180)}`;
        this.messages.push(answer);
        changed([...this.messages]);
        if (!answer.calls?.length) {
          turn.status = 'complete';
          return;
        }
        // All calls are answered even after cancellation, preserving provider history.
        for (const call of answer.calls) {
          let result;
          try {
            if (signal.aborted)
              throw new Error(
                'Stopped before tool execution. Read current drawing before continuing.',
              );
            report({
              kind: 'tool-start',
              text: `Running ${call.name}${
                typeof call.arguments.query === 'string'
                  ? `: ${call.arguments.query}`
                  : ''
              }`,
            });
            result = await this.execute(call.name, call.arguments, signal);
          } catch (e) {
            result = {
              error: true,
              data: { error: e instanceof Error ? e.message : 'Tool failed' },
            };
          }
          report({
            kind: 'tool-end',
            text: `${result.error ? 'Failed' : 'Completed'}: ${call.name}`,
          });
          this.messages.push({ role: 'tool', call, result });
          changed([...this.messages]);
        }
      }
      throw new Error(
        'Reached 40 tool rounds. Review the drawing and send a follow-up to continue.',
      );
    } catch (error) {
      turn.status = signal.aborted ? 'stopped' : 'error';
      report({
        kind: 'error',
        text: signal.aborted
          ? 'Stopped by user'
          : `Failed: ${
              error instanceof Error ? error.message : 'Chat request failed'
            }`,
      });
      throw error;
    } finally {
      this.running = false;
      changed([...this.messages]);
    }
  }
}
