import {
  desktopSecret,
  isElectron,
  chatConnectionKey as connectionKey,
} from '../../chat/desktop-storage';
import { bundledLibraries } from '../../io/bundledLibraries';
import { ConnectionSettings } from './ConnectionSettings';
import { sliderThinkingLevel } from '../../chat/thinking';
import {
  ChatConnection,
  ConnectionSetup,
  ConnectionWizard,
} from './ConnectionWizard';
import { watchGeminiGoogleAccount } from '../../chat/gemini-google';
import { ChatGPTPlanWelcome } from './ChatGPTPlanWelcome';
import {
  chatGPTAccount,
  chatGPTSignInAvailable,
  chatGPTStatus,
  createChatGPTTransport,
  openChatGPTUsage,
} from '../../chat/chatgpt';
import { ModelPicker } from './ModelPicker';
import { ChatTranscript } from './ChatTranscript';
import { thinkingLevels } from '../../chat/thinking';
import {
  CHAT_OUTPUT_TOKENS,
  isChatGptModel,
  modelLabel,
  modelOutputTokens,
} from '../../chat/models';
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { ChatSession } from '../../chat/session';
import { byokAuth, createTransport } from '../../chat/providers';
import {
  ChatMessage,
  ProviderKind,
  ProviderSettings,
  providerDefaults,
} from '../../chat/types';
import { createEditorTools } from '../../chat/tools';
import {
  checkArguments,
  projectToolSpecs,
  toolSpecs,
} from '../../chat/tool-specs';
import { editorChatSystem } from '../../chat/prompt';
import {
  MAX_ATTACHMENT_BYTES,
  readAttachments,
  validateAttachments,
} from '../../chat/attachments';
import {
  activeChatReference,
  attachmentBytes,
  chatEditingTarget,
  readProjectReference,
} from '../../chat/project-context';
import type { ChatProject } from '../../chat/project-context';
import type { docDrawing } from '../../state/undo/undo';
import { projectRequest } from '../../io/projects';
import './chat.css';

const storageKey = 'tinycad.chat.settings.v1';
function savePreferences(settings: ProviderSettings) {
  const {
    provider,
    endpoint,
    model,
    maxTokens,
    thinkingBudget,
    thinkingLevel,
  } = settings;
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      provider,
      endpoint,
      model,
      maxTokens,
      thinkingBudget,
      thinkingLevel,
    }),
  );
}
function loadSettings(): ProviderSettings {
  const fallback: ProviderSettings = {
    provider: 'openai',
    ...providerDefaults.openai,
    maxTokens: CHAT_OUTPUT_TOKENS,
    thinkingBudget: 4096,
    thinkingLevel: 'medium',
  };
  try {
    const s = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (s && Object.prototype.hasOwnProperty.call(providerDefaults, s.provider))
      return {
        provider: s.provider,
        endpoint:
          ['compatible', 'ollama'].includes(s.provider) &&
          typeof s.endpoint === 'string'
            ? s.endpoint
            : providerDefaults[s.provider as ProviderKind].endpoint,
        model:
          typeof s.model === 'string' &&
          (s.provider !== 'openai' || isChatGptModel(s.model))
            ? s.model
            : '',
        maxTokens: Number.isFinite(s.maxTokens)
          ? s.maxTokens
          : CHAT_OUTPUT_TOKENS,
        thinkingBudget: Number.isFinite(s.thinkingBudget)
          ? s.thinkingBudget
          : 4096,
        thinkingLevel: sliderThinkingLevel(s.provider, s.thinkingLevel),
      };
  } catch {
    /* Preferences are optional; keys are never stored. */
  }
  return fallback;
}
interface Download {
  name: string;
  url: string;
  image: boolean;
}
const editorTools = new Set([
  'read_drawing',
  'read_metadata',
  'read_library',
  'inspect_spice_target',
  'attach_spice_model',
  'add_library_components',
  'set_drawing',
  'edit_drawing',
  'add_to_drawing',
  'place_component',
  'insert_symbol',
  'auto_layout',
]);
const implicitDrawingTools = new Set([
  'validate_drawing',
  'read_netlist',
  'render_drawing',
  'auto_tidy_drawing',
  'export_file',
]);

export const ChatPanel: React.FC<{
  open: boolean;
  onClose: () => void;
  project?: ChatProject;
}> = ({ open, onClose, project }) => {
  const store = useStore<docDrawing>();
  const [settings, setSettings] = useState(loadSettings);
  const [connection, setConnection] = useState<ChatConnection>();
  const key = connection?.kind === 'api-key' ? connection.key : '';
  const chatGPT =
    connection?.kind === 'chatgpt' ? connection.account : undefined;
  const geminiGoogle =
    connection?.kind === 'google' ? connection.google : undefined;
  useEffect(() => () => geminiGoogle?.disconnect(), [geminiGoogle]);
  const [welcome, setWelcome] = useState(false);
  const authenticated =
    chatGPT?.sharing || !!geminiGoogle || !!key || connection?.kind === 'local';
  const [models, setModels] = useState<string[]>([]);
  const [savingConnection, setSavingConnection] = useState(false);
  const [configure, setConfigure] = useState(false);
  const [restoring, setRestoring] = useState(isElectron);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pdfPages, setPdfPages] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();
  const session = useRef<ChatSession>();
  const turnContext = useRef<{
    project?: ChatProject;
    target: ReturnType<typeof chatEditingTarget>;
    referenceView: boolean;
  }>();
  const urls = useRef<string[]>([]);
  const transcript = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    if (open)
      transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [messages.length, busy, open]);
  useEffect(() => {
    if (!geminiGoogle) return;
    return watchGeminiGoogleAccount(geminiGoogle, () => {
      geminiGoogle.disconnect();
      controller.current?.abort();
      setConnection(undefined);
      setModels([]);
      setConfigure(false);
      setError(
        'The Google account changed or signed out. Reconnect Gemini to continue.',
      );
    });
  }, [geminiGoogle]);
  const reset = () => {
    session.current = undefined;
    setMessages([]);
    setDownloads([]);
    setError('');
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
  };
  // Restore the credential only for the exact provider and endpoint saved at
  // Finish. A custom endpoint must never receive another connection's API key.
  useEffect(() => {
    if (!isElectron) return;
    let active = true;
    const restore = async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(connectionKey) || 'null');
        if (
          !saved ||
          saved.active === false ||
          saved.provider !== settings.provider ||
          saved.endpoint !== settings.endpoint
        )
          return;
        let next: ChatConnection;
        if (saved.kind === 'api-key') {
          const credential = await desktopSecret('load');
          if (
            !credential.key ||
            credential.provider !== settings.provider ||
            credential.endpoint !== settings.endpoint
          )
            return;
          next = { kind: 'api-key', key: credential.key };
        } else if (saved.kind === 'chatgpt') {
          const account = await chatGPTAccount('session');
          if (!account.connected || !account.sharing) return;
          next = { kind: 'chatgpt', account };
        } else if (saved.kind === 'local') next = { kind: 'local' };
        else return;
        if (active) {
          setConnection(next);
          setModels(
            Array.isArray(saved.models)
              ? saved.models.filter((m: unknown) => typeof m === 'string')
              : [],
          );
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : 'Could not restore the AI connection.',
          );
      } finally {
        if (active) setRestoring(false);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      savePreferences(settings);
    } catch {
      /* Optional preferences. */
    }
  }, [settings]);
  const disconnect = async () => {
    let remoteRevoked = true;
    if (connection?.kind === 'chatgpt') {
      const result = await chatGPTAccount('logout');
      remoteRevoked = result.remoteRevoked !== false;
    }
    if (isElectron) await desktopSecret('clear');
    try {
      const saved = JSON.parse(localStorage.getItem(connectionKey) || 'null');
      if (saved)
        localStorage.setItem(
          connectionKey,
          JSON.stringify({ ...saved, active: false }),
        );
    } catch {
      /* Credentials have already been cleared. */
    }
    reset();
    if (!remoteRevoked)
      setError(
        'Signed out locally, but remote sign-out was not confirmed. Disconnect TinyCAD in ChatGPT Settings.',
      );
    setConnection(undefined);
    setModels([]);
    setConfigure(false);
  };
  const finishConnection = async ({
    connection: next,
    settings: defaults,
    models: available,
  }: ConnectionSetup) => {
    setSavingConnection(true);
    try {
      if (next !== connection && next.kind !== 'chatgpt') {
        const account = await chatGPTStatus();
        if (account.connected) await chatGPTAccount('logout');
      }
      if (next !== connection) reset();
      else if (defaults.model !== settings.model)
        session.current?.changeModel();
      if (isElectron) {
        if (next.kind === 'api-key')
          await desktopSecret('save', {
            provider: defaults.provider,
            endpoint: defaults.endpoint,
            key: next.key,
          });
        else await desktopSecret('clear');
      }
      setConnection(next);
      setSettings(defaults);
      setModels(available);
      setConfigure(false);
      try {
        savePreferences(defaults);
        localStorage.setItem(
          connectionKey,
          JSON.stringify({
            kind: next.kind,
            active: true,
            provider: defaults.provider,
            endpoint: defaults.endpoint,
            models: available,
          }),
        );
      } catch {
        /* Optional non-secret preferences. */
      }
      if (next.kind === 'chatgpt' && connection?.kind !== 'chatgpt') {
        const welcomeKey = `tinycad.chat.chatgpt.welcome.${next.account.profileId}`;
        try {
          if (!localStorage.getItem(welcomeKey)) {
            setWelcome(true);
            localStorage.setItem(welcomeKey, '1');
          }
        } catch {
          setWelcome(true);
        }
      }
    } finally {
      setSavingConnection(false);
    }
  };
  const selectModel = (model: string, thinkingLevel: string) => {
    if (model !== settings.model) session.current?.changeModel();
    setSettings((previous) => ({ ...previous, model, thinkingLevel }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      busy ||
      savingConnection ||
      configure ||
      !authenticated ||
      !settings.model ||
      (!input.trim() && !files.length)
    )
      return;
    if (settings.provider === 'openai' && !isChatGptModel(settings.model)) {
      setError('Choose a Sol, Luna or Astra model.');
      return;
    }
    setBusy(true);
    setPreparingAttachments(
      files.length > 0 || (project?.active && project.active.kind !== 'text'),
    );
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    const submitted = store.getState();
    turnContext.current = {
      project,
      target: chatEditingTarget(submitted),
      referenceView:
        !!project?.active || submitted.docStore.present.view.selected_sheet < 0,
    };
    try {
      const transport = chatGPT?.sharing
        ? createChatGPTTransport(settings, chatGPT.profileId)
        : createTransport(
            {
              ...settings,
              maxTokens: modelOutputTokens(settings.provider, settings.model),
            },
            geminiGoogle?.auth || byokAuth(settings.provider, key),
          );
      // Catalog data is refreshed into the instructions for every model request.
      // A missing catalog must not prevent chatting or online-library fallback.
      await bundledLibraries.initialize().catch(() => {});
      const attachments = await readAttachments(
        files,
        settings.provider,
        pdfPages,
        abort.signal,
      );
      const context = await activeChatReference(
        project,
        submitted,
        settings.provider,
        MAX_ATTACHMENT_BYTES -
          attachments.reduce((sum, file) => sum + attachmentBytes(file), 0),
        abort.signal,
      );
      setPreparingAttachments(false);
      if (abort.signal.aborted) return;
      if (!session.current) {
        const execute = createEditorTools(store, (file) => {
          const url = URL.createObjectURL(file.blob);
          urls.current.push(url);
          setDownloads((previous) => [
            ...previous,
            { name: file.name, url, image: file.blob.type === 'image/png' },
          ]);
        });
        session.current = new ChatSession(
          () =>
            editorChatSystem({
              library: !!store.getState().docStore.present.editLibrary,
              webSearch: !!chatGPT?.sharing,
              project: !!project,
              referenceView: turnContext.current.referenceView,
              bundledLibraries:
                bundledLibraries.getSnapshot().catalog?.libraries,
            }),
          project ? [...toolSpecs, ...projectToolSpecs] : toolSpecs,
          async (name, args, signal) => {
            const current = store.getState();
            const { project: scope, target } = turnContext.current;
            if (name === 'list_project_files' || name === 'read_project_file') {
              if (
                !scope ||
                current.schematicTabs?.projectRoot !== scope.root.id
              )
                throw new Error(
                  'Open the project and send a new message to browse its files.',
                );
              checkArguments(
                args,
                projectToolSpecs.find((tool) => tool.name === name).parameters,
              );
              if (name === 'read_project_file')
                return readProjectReference(
                  scope,
                  args as Parameters<typeof readProjectReference>[1],
                  signal,
                );
              return {
                data: await projectRequest({
                  operation: 'chat-list',
                  project: scope.root.id,
                  relative: args.path as string,
                  offset: args.offset as number,
                }),
              };
            }
            if (
              editorTools.has(name) ||
              (implicitDrawingTools.has(name) &&
                !args.definition &&
                !args.componentId)
            ) {
              if (!target)
                throw new Error(
                  'No schematic or library was open when this message was sent.',
                );
              if (
                JSON.stringify(target) !==
                JSON.stringify(chatEditingTarget(current))
              )
                throw new Error(
                  'The editing target changed. Send a new message to work on the new editor.',
                );
            }
            return execute(name, args, signal);
          },
        );
      }
      try {
        savePreferences(settings);
      } catch {
        /* Non-secret preferences only. */
      }
      const prompt =
        input.trim() ||
        'Convert the attached reference into editable TinyCAD circuitry or a symbol, according to its content.';
      setInput('');
      setFiles([]);
      await session.current.send(
        prompt,
        attachments,
        transport,
        abort.signal,
        setMessages,
        context,
      );
    } catch (e) {
      setError(
        abort.signal.aborted
          ? 'Stopped. Completed edits remain in the drawing and can be undone.'
          : e instanceof Error
          ? e.message
          : 'Chat failed.',
      );
    } finally {
      controller.current = undefined;
      setPreparingAttachments(false);
      setBusy(false);
    }
  };
  return (
    <>
      <aside
        id="tinycad-chat"
        className="chat-panel"
        aria-label="TinyCAD AI assistant"
        hidden={!open}
      >
        <header>
          <strong>TinyCAD assistant</strong>
          <div>
            <button
              type="button"
              className="chat-icon-button"
              aria-label="AI settings"
              title="AI settings"
              aria-haspopup="dialog"
              disabled={busy || savingConnection || restoring}
              onClick={() => setConfigure(true)}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              >
                <path d="m9.5 3-.6 2.3-1.8 1-2.3-.6-2.5 4.3 1.7 1.7v2l-1.7 1.7 2.5 4.3 2.3-.6 1.8 1 .6 2.3h5l.6-2.3 1.8-1 2.3.6 2.5-4.3-1.7-1.7v-2l1.7-1.7-2.5-4.3-2.3.6-1.8-1L14.5 3z" />
                <circle cx="12" cy="12.7" r="3" />
              </svg>
            </button>
            <button
              type="button"
              className="chat-icon-button"
              aria-label="New chat"
              title="New chat"
              disabled={busy}
              onClick={() => {
                reset();
                setInput('');
                setFiles([]);
                setPdfPages('');
              }}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="m15 3 6 6M10 14l1-5L18 2a2.1 2.1 0 0 1 3 3l-7 7-4 2z" />
              </svg>
            </button>
            <button type="button" aria-label="Close chat" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        {configure &&
          (connection ? (
            <ConnectionSettings
              settings={settings}
              models={models}
              method={connection.kind}
              email={chatGPT?.identity?.email || geminiGoogle?.email}
              project={geminiGoogle?.projectId}
              onSave={(defaults) =>
                finishConnection({ connection, settings: defaults, models })
              }
              onDisconnect={disconnect}
              onClose={() => setConfigure(false)}
            />
          ) : (
            <ConnectionWizard
              settings={settings}
              onFinish={finishConnection}
              onClose={() => setConfigure(false)}
            />
          ))}
        <div
          ref={transcript}
          className={`chat-transcript${
            !authenticated && !messages.length
              ? ' chat-transcript-signed-out'
              : ''
          }`}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {!authenticated && !messages.length && (
            <button
              type="button"
              className="chat-sign-in"
              disabled={restoring}
              onClick={() => setConfigure(true)}
            >
              {chatGPTSignInAvailable
                ? 'Click here to Sign in to use AI'
                : 'Click here to connect AI'}
            </button>
          )}
          {authenticated && !messages.length && (
            <p>
              Describe a circuit, ask about your drawing, or attach a datasheet
              or circuit image. The assistant can read and edit the open
              circuit. Use Undo to revert an edit.
            </p>
          )}
          <ChatTranscript messages={messages} />
          {downloads.length > 0 && (
            <section aria-label="Chat files" className="chat-files">
              {downloads.map((file, i) => (
                <div key={i}>
                  <a href={file.url} download={file.name}>
                    {file.name}
                  </a>
                </div>
              ))}
            </section>
          )}
        </div>
        {error && (
          <div className="chat-error" role="alert">
            {error}
          </div>
        )}
        {welcome && <ChatGPTPlanWelcome onClose={() => setWelcome(false)} />}
        <form onSubmit={submit} className="chat-compose">
          {chatGPT?.sharing && (
            <div className="chat-plan-indicator">
              <span>
                Using ChatGPT{settings.model && ' '}
                {modelLabel(settings.model).replace(
                  /^GPT-(\d+(?:\.\d+)?) (Sol|Luna|Astra)/i,
                  '$2 $1',
                )}
              </span>
              <button type="button" onClick={openChatGPTUsage}>
                Manage usage
              </button>
            </div>
          )}
          {geminiGoogle && (
            <div className="chat-plan-indicator">
              <span>
                Using Google account · {geminiGoogle.email} ·{' '}
                {geminiGoogle.projectId}
              </span>
            </div>
          )}
          {authenticated && !settings.model && (
            <small
              id="chat-model-hint"
              className="chat-model-hint"
              role="status"
            >
              Choose a model using the model icon before sending. You can write
              your message now.
            </small>
          )}
          <textarea
            id="chat-prompt"
            aria-label="Message"
            ref={inputRef}
            value={input}
            disabled={busy || !authenticated}
            aria-describedby={
              authenticated && !settings.model ? 'chat-model-hint' : undefined
            }
            rows={3}
            placeholder="Add a 555 timer circuit, or explain this net…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="chat-attachment-status" role="status">
            {preparingAttachments ? 'Preparing attachments…' : ''}
          </div>
          {project?.active && (
            <small className="chat-model-hint">
              Active reference when sending: {project.active.name}
            </small>
          )}
          {files.map((f, i) => (
            <div key={i} className="chat-attachment">
              <span>
                {f.name}{' '}
                <small>({Math.max(1, Math.ceil(f.size / 1024))} KiB)</small>
              </span>
              <button
                type="button"
                disabled={busy || !authenticated || !settings.model}
                aria-label={`Remove ${f.name}`}
                title={`Remove ${f.name}`}
                onClick={() =>
                  setFiles((previous) => previous.filter((_, j) => i !== j))
                }
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                </svg>
              </button>
            </div>
          ))}
          {files.some((f) => f.type === 'application/pdf') &&
            ['compatible', 'ollama'].includes(settings.provider) && (
              <label>
                PDF pages (up to 20; blank = all)
                <input
                  value={pdfPages}
                  disabled={busy || !authenticated || !settings.model}
                  placeholder="1-4,12"
                  onChange={(e) => setPdfPages(e.target.value)}
                />
              </label>
            )}
          <div className="chat-compose-actions">
            <ModelPicker
              settings={settings}
              models={models}
              disabled={busy || savingConnection || !authenticated}
              onChange={selectModel}
            />
            <label
              className="chat-import"
              aria-disabled={busy || !authenticated || !settings.model}
              title={
                !authenticated
                  ? 'Connect AI before attaching files.'
                  : !settings.model
                  ? 'Choose a model before attaching files.'
                  : 'Attach up to six PDF or image files, totaling at most 10 MiB.'
              }
            >
              Import PDF/image
              <input
                aria-label="Attach PDF or image"
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={busy || !authenticated || !settings.model}
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (!selected.length) return;
                  try {
                    const next = [...files, ...selected];
                    validateAttachments(next);
                    setFiles(next);
                    setError('');
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Could not attach files.',
                    );
                  }
                }}
              />
            </label>
            {busy ? (
              <button type="button" onClick={() => controller.current?.abort()}>
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  !authenticated ||
                  !settings.model ||
                  (!input.trim() && !files.length)
                }
              >
                Send
              </button>
            )}
          </div>
        </form>
      </aside>
    </>
  );
};
