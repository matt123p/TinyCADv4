import React, { useEffect, useRef, useState } from 'react';
import {
  GeminiGoogleConnection as Connection,
  connectGeminiGoogle,
  defaultGeminiProject,
  signedInGoogleUser,
  validGoogleProject,
} from '../../chat/gemini-google';
import { listProviderModels } from '../../chat/providers';
import { ProviderSettings } from '../../chat/types';

export function GeminiGoogleConnection({
  settings,
  connection,
  disabled,
  onConnected,
  onDisconnected,
}: {
  settings: ProviderSettings;
  connection?: Connection;
  disabled: boolean;
  onConnected: (connection: Connection, models: string[]) => void;
  onDisconnected: () => void;
}) {
  const [project, setProject] = useState(
    () => connection?.projectId || defaultGeminiProject(),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true),
    controller = useRef<AbortController>();
  const [googleEmail, setGoogleEmail] = useState(() =>
    signedInGoogleUser()?.getBasicProfile()?.getEmail(),
  );
  useEffect(() => {
    active.current = true;
    // The Google build may finish Drive sign-in after the chat panel mounts.
    const timer = setInterval(
      () => setGoogleEmail(signedInGoogleUser()?.getBasicProfile()?.getEmail()),
      1000,
    );
    return () => {
      active.current = false;
      clearInterval(timer);
      controller.current?.abort();
    };
  }, []);
  const connect = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setError('');
    setPending(true);
    let ready: Connection;
    try {
      ready = await connectGeminiGoogle(project, abort.signal);
      const models = await listProviderModels(
        settings,
        ready.auth,
        abort.signal,
      );
      if (!models.length)
        throw new Error(
          'No Gemini generation models are available for this account and project. Check the Gemini API and project permissions.',
        );
      if (!active.current || abort.signal.aborted) {
        ready.disconnect();
        return;
      }
      try {
        localStorage.setItem('tinycad.chat.gemini.project', ready.projectId);
      } catch {
        /* Optional non-secret preference. */
      }
      onConnected(ready, models);
    } catch (e) {
      ready?.disconnect();
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : 'Could not connect Gemini with Google.',
        );
    } finally {
      if (active.current) setPending(false);
      controller.current = undefined;
    }
  };
  return (
    <section
      className="chat-chatgpt-connection"
      aria-label="Gemini Google authorization"
    >
      <strong>Use your Google account</strong>
      <small>
        Connect the Google account already signed in to TinyCAD. Gemini uses
        this project's API quota and billing.
      </small>
      <label>
        Google Cloud project
        <input
          aria-label="Google Cloud project"
          value={project}
          disabled={disabled || pending}
          placeholder="my-google-cloud-project"
          onChange={(event) => setProject(event.target.value)}
        />
      </label>
      {googleEmail ? (
        <small>Google account: {googleEmail}</small>
      ) : (
        <small>
          Sign in to the Google Drive version of TinyCAD to enable account
          access.
        </small>
      )}
      <div className="chat-chatgpt-actions">
        <button
          type="button"
          disabled={
            disabled ||
            pending ||
            !googleEmail ||
            !validGoogleProject(project.trim())
          }
          onClick={connect}
        >
          {pending ? 'Connecting Google…' : 'Use Google account for Gemini'}
        </button>
        {pending && (
          <button type="button" onClick={() => controller.current?.abort()}>
            Cancel Google authorization
          </button>
        )}
        {connection && (
          <button
            type="button"
            disabled={disabled || pending}
            onClick={onDisconnected}
          >
            Disconnect Gemini
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="chat-account-error">
          {error}
        </p>
      )}
    </section>
  );
}
