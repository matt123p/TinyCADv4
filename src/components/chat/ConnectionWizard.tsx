import React, { useEffect, useRef, useState } from 'react';
import { ChatGPTConnection } from './ChatGPTConnection';
import { ModelPicker } from './ModelPicker';
import { ChatGPTAccount, chatGPTAccount } from '../../chat/chatgpt';
import { GeminiGoogleConnection as GoogleConnection } from '../../chat/gemini-google';
import {
  byokAuth,
  createTransport,
  listProviderModels,
} from '../../chat/providers';
import {
  CHAT_OUTPUT_TOKENS,
  defaultModel,
  isChatGptModel,
} from '../../chat/models';
import {
  ProviderKind,
  ProviderSettings,
  providerDefaults,
} from '../../chat/types';

export type ChatConnection =
  | { kind: 'api-key'; key: string }
  | { kind: 'chatgpt'; account: ChatGPTAccount }
  | { kind: 'google'; google: GoogleConnection }
  | { kind: 'local' };
export interface ConnectionSetup {
  connection: ChatConnection;
  settings: ProviderSettings;
  models: string[];
}
export const providerLabels: Record<ProviderKind, string> = {
  openai: 'ChatGPT',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  glm: 'Z.AI GLM',
  compatible: 'OpenAI compatible',
  ollama: 'Ollama (hosted locally)',
};
const keyHelp: Record<
  Exclude<ProviderKind, 'compatible' | 'ollama'>,
  { url: string; label: string; text: string }
> = {
  openai: {
    url: 'https://platform.openai.com/api-keys',
    label: 'OpenAI API keys',
    text: 'Open the OpenAI dashboard, create a secret API key in your project, and paste it below. API keys use separate API billing. To use your eligible paid ChatGPT subscription allowance instead, select Sign In with ChatGPT.',
  },
  anthropic: {
    url: 'https://platform.claude.com/settings/keys',
    label: 'Claude Console API keys',
    text: 'Sign in to the Claude Console, open API keys, and create a key for your workspace. Paste it below and make sure API billing is available.',
  },
  gemini: {
    url: 'https://aistudio.google.com/apikey',
    label: 'Google AI Studio API keys',
    text: 'Open Google AI Studio, sign in, choose or import your Google Cloud project, and create an API key. Copy it into TinyCAD. Gemini offers a free API tier for supported models, subject to availability and usage limits; paid models and higher usage require billing.',
  },
  glm: {
    url: 'https://z.ai/manage-apikey/apikey-list',
    label: 'Z.AI API keys',
    text: 'Sign in to the Z.AI developer platform, open API keys, create a key, and paste it below. Use a key with access to the GLM models you want.',
  },
};

export function ConnectionWizard({
  settings: initialSettings,
  onFinish,
  onClose,
}: {
  settings: ProviderSettings;
  onFinish: (setup: ConnectionSetup) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<ProviderKind | ''>('');
  const [settings, setSettings] = useState({
    ...initialSettings,
    thinkingLevel: 'medium',
  });
  const [method, setMethod] = useState<'account' | 'api-key'>('account');
  const [key, setKey] = useState(''),
    [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState(false),
    [modelId, setModelId] = useState('');
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    controller = useRef<AbortController>();
  const active = useRef(true),
    committed = useRef(false),
    staged = useRef<ChatConnection>();
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    active.current = true;
    const element = dialog.current,
      previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      active.current = false;
      controller.current?.abort();
      element?.close();
      previous?.focus();
      if (!committed.current) {
        if (staged.current?.kind === 'google')
          staged.current.google.disconnect();
        if (staged.current?.kind === 'chatgpt')
          void chatGPTAccount('logout').catch(() => {});
      }
    };
  }, []);
  const clearStaged = async () => {
    if (staged.current?.kind === 'chatgpt') await chatGPTAccount('logout');
    if (staged.current?.kind === 'google') staged.current.google.disconnect();
    staged.current = undefined;
    setHasKey(false);
  };
  const chooseProvider = async (next: ProviderKind) => {
    setPending(true);
    setError('');
    try {
      await clearStaged();
      if (!active.current) return;
      setProvider(next);
      setKey('');
      setShowKey(false);
      setModels([]);
      setManualModel(false);
      setModelId('');
      setMethod(next === 'openai' ? 'account' : 'api-key');
      setSettings({
        provider: next,
        ...providerDefaults[next],
        maxTokens: CHAT_OUTPUT_TOKENS,
        model: next === initialSettings.provider ? initialSettings.model : '',
        thinkingLevel: 'medium',
        thinkingBudget: 4096,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change provider.');
    } finally {
      if (active.current) setPending(false);
    }
  };
  const chooseMethod = async (next: 'account' | 'api-key') => {
    setPending(true);
    setError('');
    try {
      await clearStaged();
      if (active.current) {
        setMethod(next);
        setKey('');
        setShowKey(false);
        setModels([]);
        setManualModel(false);
        setModelId('');
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not change sign-in method.',
      );
    } finally {
      if (active.current) setPending(false);
    }
  };
  const ready = (connection: ChatConnection, available: string[]) => {
    if (!active.current) {
      if (connection.kind === 'google') connection.google.disconnect();
      return;
    }
    staged.current = connection;
    setHasKey(connection.kind === 'api-key');
    setModels(available);
    setSettings((previous) => ({
      ...previous,
      model: defaultModel(available, previous.model),
    }));
    setKey('');
    setShowKey(false);
    setError('');
    setStep(3);
  };
  const testAndNext = async () => {
    if (pending) return;
    const secret =
      key.trim() ||
      (staged.current?.kind === 'api-key' ? staged.current.key : '');
    if (!secret && settings.provider !== 'ollama') return;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 30000);
    setPending(true);
    setError('');
    try {
      let available: string[];
      if (manualModel) {
        if (!modelId.trim()) throw new Error('Enter a model ID.');
        await createTransport(
          {
            ...settings,
            model: modelId.trim(),
            maxTokens: 256,
            thinkingLevel: 'default',
          },
          byokAuth(settings.provider, secret),
        ).complete(
          [{ role: 'user', text: 'Reply with OK.' }],
          'Connection test. Reply with OK. Do not call tools.',
          [],
          abort.signal,
        );
        available = [modelId.trim()];
      } else
        available = await listProviderModels(
          settings,
          byokAuth(settings.provider, secret),
          abort.signal,
        );
      if (!available.length)
        throw new Error(
          settings.provider === 'openai'
            ? 'No Sol, Luna or Astra models are available for this key.'
            : 'No models are available for this connection.',
        );
      // Z.AI may supply a fallback catalog without verifying credentials.
      if (settings.provider === 'glm')
        await createTransport(
          {
            ...settings,
            model: defaultModel(available, settings.model),
            maxTokens: 256,
            thinkingLevel: 'default',
          },
          byokAuth(settings.provider, secret),
        ).complete(
          [{ role: 'user', text: 'Reply with OK.' }],
          'Connection test. Reply with OK. Do not call tools.',
          [],
          abort.signal,
        );
      abort.signal.throwIfAborted();
      if (active.current)
        ready(
          settings.provider === 'ollama'
            ? { kind: 'local' }
            : { kind: 'api-key', key: secret },
          available,
        );
    } catch (e) {
      if (!active.current) return;
      if (
        !abort.signal.aborted &&
        settings.provider !== 'openai' &&
        e instanceof Error &&
        /Model list HTTP (404|405)/.test(e.message)
      ) {
        setManualModel(true);
        setError(
          'This endpoint does not list models. Enter a model ID, then click Next. A short greeting will verify it.',
        );
      } else
        setError(
          abort.signal.aborted
            ? 'Connection test timed out. Try again.'
            : settings.provider === 'ollama' && e instanceof TypeError
            ? 'Could not reach local Ollama. Start Ollama, check its API URL and OLLAMA_ORIGINS setting, then try again.'
            : e instanceof Error
            ? e.message
            : 'Could not connect.',
        );
    } finally {
      clearTimeout(timeout);
      if (active.current) setPending(false);
      controller.current = undefined;
    }
  };
  const finish = async () => {
    if (
      !staged.current ||
      !settings.model ||
      pending ||
      (settings.provider === 'openai' && !isChatGptModel(settings.model))
    )
      return;
    setPending(true);
    setError('');
    committed.current = true;
    try {
      await onFinish({ connection: staged.current, settings, models });
    } catch (e) {
      committed.current = false;
      if (active.current)
        setError(e instanceof Error ? e.message : 'Could not save connection.');
    } finally {
      if (active.current) setPending(false);
    }
  };
  const accountMethod = settings.provider === 'openai' && method === 'account';
  return (
    <dialog
      ref={dialog}
      className="chat-connection-dialog"
      aria-labelledby="chat-connection-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
    >
      <div className="chat-wizard-heading">
        <h2 id="chat-connection-title">AI settings</h2>
        <button
          type="button"
          aria-label="Close AI settings"
          disabled={pending}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <ol className="chat-wizard-steps" aria-label="Connection setup steps">
        {['Provider', 'Account or API key', 'Pick Model'].map(
          (label, index) => (
            <li
              key={label}
              aria-current={step === index + 1 ? 'step' : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <h3 className={step === 2 ? 'chat-wizard-provider' : undefined}>
        {step === 2
          ? providerLabels[settings.provider]
          : `Step ${step} — ${step === 1 ? 'Choose provider' : 'Pick Model'}`}
      </h3>
      {step === 1 && (
        <>
          <div className="chat-provider-guidance">
            <p>
              If you pay for ChatGPT, you can use your eligible subscription
              allowance with this app.
            </p>
            <p>
              If you don't have a subscription, Google Gemini offers a free API
              option, subject to model availability and usage limits.
            </p>
            <p>Otherwise, use an API key from your preferred AI provider.</p>
            <p>
              To run a locally hosted LLM on your own computer, choose Ollama.
            </p>
          </div>
          <label className="chat-wizard-field">
            Provider
            <select
              aria-label="Provider"
              autoFocus
              value={provider}
              disabled={pending}
              onChange={(event) =>
                chooseProvider(event.target.value as ProviderKind)
              }
            >
              <option value="" disabled>
                Choose a provider
              </option>
              {Object.entries(providerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="chat-wizard-hint">Connect one AI provider at a time.</p>
        </>
      )}
      {step === 2 && (
        <>
          {settings.provider === 'gemini' && (
            <div className="chat-key-help">
              <p>
                {keyHelp.gemini.text}{' '}
                <a
                  href={keyHelp.gemini.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get a Gemini API key ↗
                </a>{' '}
                <a
                  href="https://ai.google.dev/gemini-api/docs/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Free tier and pricing ↗
                </a>
              </p>
            </div>
          )}
          {settings.provider === 'openai' && (
            <fieldset className="chat-auth-method">
              <legend>Connect using:</legend>
              <label>
                <input
                  type="radio"
                  name="chat-auth-method"
                  checked={method === 'account'}
                  disabled={pending}
                  onChange={() => chooseMethod('account')}
                />
                Sign In with ChatGPT
              </label>
              <label>
                <input
                  type="radio"
                  name="chat-auth-method"
                  checked={method === 'api-key'}
                  disabled={pending}
                  onChange={() => chooseMethod('api-key')}
                />
                Use API Key
              </label>
            </fieldset>
          )}
          {accountMethod ? (
            <ChatGPTConnection
              disabled={pending}
              onConnected={(account, available) =>
                ready({ kind: 'chatgpt', account }, available)
              }
              onDisconnected={() => {
                staged.current = undefined;
              }}
            />
          ) : settings.provider === 'ollama' ? (
            <>
              <div className="chat-key-help">
                <p>
                  Ollama runs models on your own computer. No API key or AI
                  subscription is needed for local models.
                </p>
                <ol>
                  <li>
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Install Ollama
                    </a>{' '}
                    and start it.
                  </li>
                  <li>
                    Download a local model that supports tools using{' '}
                    <code>ollama pull MODEL_NAME</code>. For PDFs or images,
                    choose a model with vision support.
                  </li>
                  <li>
                    Use the local API URL below, then click Next to list your
                    installed models.
                  </li>
                </ol>
                <p>
                  When using TinyCAD in a browser, allow its origin in Ollama
                  with <code>OLLAMA_ORIGINS</code> and restart Ollama.{' '}
                  {window.location.protocol.startsWith('http') && (
                    <code>{`OLLAMA_ORIGINS=${window.location.origin}`}</code>
                  )}{' '}
                  <a
                    href="https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Browser access instructions ↗
                  </a>
                </p>
                <p>
                  <a
                    href="https://docs.ollama.com/api/openai-compatibility"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ollama API setup ↗
                  </a>
                  . Use enough model context for TinyCAD's circuit tools.
                </p>
              </div>
              <label className="chat-wizard-field">
                Ollama API URL
                <input
                  type="url"
                  value={settings.endpoint}
                  disabled={pending}
                  onChange={(event) =>
                    setSettings({ ...settings, endpoint: event.target.value })
                  }
                />
              </label>
              {manualModel && (
                <label className="chat-wizard-field">
                  Model ID
                  <input
                    value={modelId}
                    disabled={pending}
                    onChange={(event) => setModelId(event.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              {settings.provider !== 'gemini' && (
                <div className="chat-key-help">
                  <p>
                    {settings.provider === 'compatible' ? (
                      <>
                        Sign in to your provider's developer dashboard, open API
                        keys, and create a secret key. Copy the key and
                        OpenAI-compatible API base URL below. For example,{' '}
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          create an OpenAI API key ↗
                        </a>
                        . Other providers supply keys through their own
                        dashboards.
                      </>
                    ) : (
                      <>
                        {keyHelp[settings.provider].text}{' '}
                        <a
                          href={keyHelp[settings.provider].url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {keyHelp[settings.provider].label} ↗
                        </a>
                      </>
                    )}
                  </p>
                </div>
              )}
              <label className="chat-wizard-field">
                API key
                <input
                  aria-label="API key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  disabled={pending}
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <label className="chat-show-key">
                <input
                  type="checkbox"
                  checked={showKey}
                  disabled={pending || !key}
                  onChange={(event) => setShowKey(event.target.checked)}
                />
                Show API key
              </label>
              {hasKey && !key && (
                <small>
                  The entered API key is kept private. Enter a new key to
                  replace it.
                </small>
              )}
              {settings.provider === 'compatible' && (
                <label className="chat-wizard-field">
                  API base URL
                  <input
                    type="url"
                    value={settings.endpoint}
                    disabled={pending}
                    onChange={(event) =>
                      setSettings({ ...settings, endpoint: event.target.value })
                    }
                  />
                </label>
              )}
              {manualModel && (
                <label className="chat-wizard-field">
                  Model ID
                  <input
                    aria-label="Model ID"
                    value={modelId}
                    disabled={pending}
                    onChange={(event) => setModelId(event.target.value)}
                  />
                </label>
              )}
              <p className="chat-wizard-hint">
                Your connection is checked when you click Next. API keys stay in
                memory.
                {settings.provider === 'glm' &&
                  ' Z.AI uses the TinyCAD relay and a short greeting to check your key.'}
              </p>
            </>
          )}
        </>
      )}
      {step === 3 && (
        <>
          <p className="chat-connection-success" role="status">
            Connected to {providerLabels[settings.provider]}.
          </p>
          <ModelPicker
            inline
            settings={settings}
            models={models}
            disabled={pending}
            onChange={(model, thinkingLevel) =>
              setSettings({ ...settings, model, thinkingLevel })
            }
          />
        </>
      )}
      {error && (
        <p role="alert" className="chat-account-error">
          {error}
        </p>
      )}
      <div className="chat-wizard-footer">
        <button type="button" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        {step > 1 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError('');
              setShowKey(false);
              setStep(step - 1);
            }}
          >
            Back
          </button>
        )}
        {step === 1 && (
          <button
            type="button"
            disabled={!provider || pending}
            onClick={() => setStep(2)}
          >
            Next
          </button>
        )}
        {step === 2 && !accountMethod && (
          <button
            type="button"
            disabled={
              pending ||
              (settings.provider !== 'ollama' && !key.trim() && !hasKey) ||
              (manualModel && !modelId.trim())
            }
            onClick={testAndNext}
          >
            {pending ? 'Connecting…' : 'Next'}
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            disabled={!settings.model || pending}
            onClick={finish}
          >
            Finish
          </button>
        )}
      </div>
    </dialog>
  );
}
