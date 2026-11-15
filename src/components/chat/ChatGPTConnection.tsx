import React, { useEffect, useRef, useState } from 'react';
import { isElectron } from '../../io/apiServer';
import {
  ChatGPTAccount,
  chatGPTAccount,
  chatGPTStatus,
} from '../../chat/chatgpt';

export function ChatGPTConnection({
  disabled,
  onConnected,
  onDisconnected,
}: {
  disabled: boolean;
  onConnected: (account: ChatGPTAccount, models: string[]) => void;
  onDisconnected: (account: ChatGPTAccount) => void;
}) {
  const [account, setAccount] = useState<ChatGPTAccount>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const pendingId = useRef<string>();
  const callbacks = useRef({ onConnected, onDisconnected });
  callbacks.current = { onConnected, onDisconnected };
  useEffect(() => {
    active.current = true;
    chatGPTStatus().then((state) => {
      if (active.current) setAccount(state);
    });
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      if (pendingId.current)
        void chatGPTAccount('cancel', { loginId: pendingId.current }).catch(
          () => {},
        );
    };
  }, []);
  const useAccount = async (state: ChatGPTAccount) => {
    setAccount(state);
    if (!state.sharing) return;
    const models = (await chatGPTAccount('models')) as string[];
    if (!models.length)
      throw new Error(
        'No Sol, Luna or Astra models are available for this ChatGPT connection.',
      );
    if (active.current) callbacks.current.onConnected(state, models);
  };
  const start = async (newAccount = false, enableSharing = false) => {
    setError('');
    setConnecting(true);
    const popup = !isElectron ? window.open('about:blank', '_blank') : null;
    if (!isElectron && !popup) {
      setError('Allow the sign-in popup, then try again.');
      setConnecting(false);
      return;
    }
    try {
      if (newAccount && account?.connected) {
        const signedOut = await chatGPTAccount('logout');
        setAccount(signedOut);
        callbacks.current.onDisconnected(signedOut);
      }
      const login = await chatGPTAccount('start', {
        newAccount,
        enableSharing,
      });
      pendingId.current = login.loginId;
      if (popup) {
        const url = new URL(login.authUrl);
        if (
          url.origin !== 'https://auth.openai.com' ||
          url.pathname !== '/api/accounts/authorize'
        )
          throw new Error('ChatGPT returned an invalid sign-in address.');
        popup.opener = null;
        popup.location.href = url.href;
      }
      const poll = async () => {
        try {
          const state = (await chatGPTAccount('session')) as ChatGPTAccount;
          if (!active.current || !pendingId.current) return;
          setAccount(state);
          if (state.pending) {
            timer.current = setTimeout(poll, 1000);
            return;
          }
          pendingId.current = undefined;
          setConnecting(false);
          if (state.error) throw new Error(state.error.message);
          if (!state.connected)
            throw new Error('ChatGPT sign-in was cancelled or timed out.');
          await useAccount(state);
        } catch (e) {
          if (active.current) {
            setConnecting(false);
            setError(
              e instanceof Error ? e.message : 'ChatGPT sign-in failed.',
            );
          }
        }
      };
      timer.current = setTimeout(poll, 500);
    } catch (e) {
      popup?.close();
      if (pendingId.current)
        await chatGPTAccount('cancel', { loginId: pendingId.current }).catch(
          () => {},
        );
      pendingId.current = undefined;
      setConnecting(false);
      setError(e instanceof Error ? e.message : 'ChatGPT sign-in failed.');
    }
  };
  const cancel = async () => {
    const id = pendingId.current;
    pendingId.current = undefined;
    clearTimeout(timer.current);
    if (id) await chatGPTAccount('cancel', { loginId: id }).catch(() => {});
    setConnecting(false);
  };
  return (
    <section
      className="chat-chatgpt-connection"
      aria-label="Sign in with ChatGPT"
    >
      <strong>Use your ChatGPT account</strong>
      <small>
        Sign in with ChatGPT requires an eligible paid ChatGPT subscription.
        Running AI requests in TinyCAD uses your ChatGPT allowance and counts
        towards your plan limits. This option does not require an API key.
      </small>
      {account?.identity?.email && (
        <strong className="chat-account-email">{account.identity.email}</strong>
      )}
      {connecting ? (
        <div role="status">
          <span>Complete sign-in in your browser…</span>{' '}
          <button type="button" onClick={cancel}>
            Cancel sign-in
          </button>
        </div>
      ) : (
        <div className="chat-chatgpt-actions">
          {account?.identity?.email ? (
            <>
              <button
                type="button"
                data-oai-siwc-button=""
                disabled={disabled || !account.available}
                onClick={async () => {
                  if (!account.connected || !account.sharing) {
                    void start(false, account.connected && !account.sharing);
                    return;
                  }
                  setConnecting(true);
                  setError('');
                  try {
                    await useAccount(account);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : 'Could not connect.',
                    );
                  } finally {
                    if (active.current) setConnecting(false);
                  }
                }}
              >
                Continue as {account.identity.email}
              </button>
              <button
                type="button"
                disabled={disabled || !account.available}
                onClick={() => start(true)}
              >
                Sign in with a different account
              </button>
            </>
          ) : (
            <button
              type="button"
              data-oai-siwc-button=""
              disabled={disabled || !account?.available}
              onClick={() => start()}
            >
              Sign in with ChatGPT
            </button>
          )}
        </div>
      )}
      {account?.available === false && (
        <small>
          Account sign-in is available in TinyCAD Desktop and locally hosted
          TinyCAD. You can use an API key on this host.
        </small>
      )}
      {account?.connected && !account.sharing && (
        <small>
          ChatGPT plan usage is not enabled. Continue with this account to grant
          access, or select Use API Key.
        </small>
      )}
      {error && (
        <p role="alert" className="chat-account-error">
          {error}
        </p>
      )}
    </section>
  );
}
