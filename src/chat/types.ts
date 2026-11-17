export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'compatible'
  | 'ollama';
export interface ProviderSettings {
  provider: ProviderKind;
  endpoint: string;
  model: string;
  maxTokens: number;
  thinkingLevel?: string;
  thinkingBudget?: number;
}
// Authentication stays outside conversation/state persistence. A future OAuth
// implementation can supply short-lived credentials without changing tools or UI.
export interface ChatAuth {
  headers(signal: AbortSignal): Promise<Record<string, string>>;
}
export interface Attachment {
  name: string;
  mime: string;
  data: string;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface ToolResult {
  data: unknown;
  images?: Attachment[];
  error?: boolean;
}
export interface ChatProgress {
  kind:
    | 'error'
    | 'retry'
    | 'request'
    | 'response'
    | 'reasoning'
    | 'text'
    | 'tool-draft'
    | 'tool-start'
    | 'tool-end'
    | 'image'
    | 'web-search';
  at?: number;
  text: string;
}
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  text?: string;
  attachments?: Attachment[];
  calls?: ToolCall[];
  reasoning?: string;
  webSearches?: {
    id: string;
    status: string;
    action?: Record<string, unknown>;
  }[];
  progress?: ChatProgress[];
  liveReasoning?: string;
  liveText?: string;
  currentActivity?: string;
  lastActivity?: string;
  activityStarted?: number;
  status?: 'working' | 'complete' | 'error' | 'stopped';
  imagesViewed?: boolean;
  call?: ToolCall;
  result?: ToolResult;
  // Keep provider blocks intact, including thought signatures and provider reasoning.
  native?: unknown;
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ChatTransport {
  complete(
    messages: ChatMessage[],
    system: string,
    tools: ToolSpec[],
    signal: AbortSignal,
    progress?: (event: ChatProgress) => void,
  ): Promise<ChatMessage>;
}
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<ToolResult>;
export const providerDefaults: Record<
  ProviderKind,
  { endpoint: string; model: string }
> = {
  openai: { endpoint: 'https://api.openai.com/v1', model: '' },
  anthropic: { endpoint: 'https://api.anthropic.com/v1', model: '' },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    model: '',
  },
  compatible: { endpoint: 'http://localhost:11434/v1', model: '' },
  ollama: { endpoint: 'http://localhost:11434/v1', model: '' },
};
