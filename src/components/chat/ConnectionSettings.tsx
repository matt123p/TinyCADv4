import React, { useEffect, useRef, useState } from 'react';
import { ModelPicker } from './ModelPicker';
import { providerLabels } from './ConnectionWizard';
import { ProviderSettings } from '../../chat/types';

// This view receives no API key or credential object. Secrets cannot be revealed here.
export function ConnectionSettings({
  settings,
  models,
  method,
  email,
  project,
  onSave,
  onDisconnect,
  onClose,
}: {
  settings: ProviderSettings;
  models: string[];
  method: 'api-key' | 'chatgpt' | 'google' | 'local';
  email?: string;
  project?: string;
  onSave: (settings: ProviderSettings) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : 'Could not update settings.');
    }
  };
  return (
    <dialog
      ref={dialog}
      className="chat-connection-dialog"
      aria-labelledby="chat-settings-title"
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else onClose();
      }}
    >
      <div className="chat-wizard-heading">
        <h2 id="chat-settings-title">AI settings</h2>
        <button
          type="button"
          aria-label="Close AI settings"
          disabled={pending}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <section
        className="chat-current-connection"
        aria-label="Current connection"
      >
        <h3>{providerLabels[settings.provider]}</h3>
        <p>
          {method === 'local'
            ? 'Connected to local Ollama (no API key)'
            : method === 'api-key'
            ? 'Connected using an API key'
            : method === 'chatgpt'
            ? 'Signed in with ChatGPT'
            : 'Signed in with Google'}
        </p>
        {email && <strong>{email}</strong>}
        {project && <p>Project: {project}</p>}
        {['compatible', 'ollama'].includes(settings.provider) && (
          <p>{settings.endpoint}</p>
        )}
        <button
          type="button"
          className="chat-disconnect"
          disabled={pending}
          onClick={() => run(onDisconnect)}
        >
          {method === 'local'
            ? 'Disconnect Ollama'
            : method === 'api-key'
            ? 'Clear API key'
            : 'Sign out'}
        </button>
      </section>
      <ModelPicker
        inline
        settings={draft}
        models={models}
        disabled={pending}
        onChange={(model, thinkingLevel) =>
          setDraft({ ...draft, model, thinkingLevel })
        }
      />
      {error && (
        <p className="chat-account-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-wizard-footer">
        <button type="button" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !draft.model}
          onClick={() => run(() => onSave(draft))}
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
