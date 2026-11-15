import { isElectron } from '../io/apiServer';
import { ChatAuth } from './types';

// Inference uses Google's Cloud OAuth permission, requested incrementally from
// TinyCAD's existing Google account. Drive login never requests this scope.
export const GEMINI_GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/cloud-platform';
export interface GeminiGoogleConnection {
  accountId: string;
  email: string;
  projectId: string;
  auth: ChatAuth;
  disconnect(): void;
}
export function signedInGoogleUser(): gapi.auth2.GoogleUser | undefined {
  if (isElectron || typeof window === 'undefined') return;
  try {
    const auth = window.gapi?.auth2?.getAuthInstance();
    const user = auth?.currentUser?.get();
    return auth?.isSignedIn?.get() && user?.getId() ? user : undefined;
  } catch {
    return;
  }
}
export function defaultGeminiProject(): string {
  try {
    return (
      localStorage.getItem('tinycad.chat.gemini.project') ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      ''
    );
  } catch {
    return process.env.GOOGLE_CLOUD_PROJECT_ID || '';
  }
}
export function validGoogleProject(projectId: string): boolean {
  return (
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    /^\d{6,30}$/.test(projectId)
  );
}
function abortable<T>(
  pending: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException('Stopped', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(pending).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
export async function connectGeminiGoogle(
  project: string,
  signal: AbortSignal,
): Promise<GeminiGoogleConnection> {
  const projectId = project.trim();
  if (!validGoogleProject(projectId))
    throw new Error(
      'Enter a Google Cloud project ID or project number for Gemini API quota and billing.',
    );
  const user = signedInGoogleUser();
  if (!user)
    throw new Error(
      'Sign in to the Google Drive version of TinyCAD first, then connect Gemini.',
    );
  const accountId = user.getId();
  signal.throwIfAborted();
  if (!user.hasGrantedScopes(GEMINI_GOOGLE_SCOPE)) {
    try {
      await abortable(user.grant({ scope: GEMINI_GOOGLE_SCOPE }), signal);
    } catch {
      throw new Error(
        'Google authorization was cancelled or declined. Connect again to allow Gemini access.',
      );
    }
  }
  signal.throwIfAborted();
  let connected = true;
  let refresh: Promise<gapi.auth2.AuthResponse> | undefined;
  const current = () => {
    const selected = signedInGoogleUser();
    if (!connected || selected?.getId() !== accountId)
      throw new Error(
        'The Google account changed or signed out. Reconnect Gemini before sending another message.',
      );
    if (!selected.hasGrantedScopes(GEMINI_GOOGLE_SCOPE))
      throw new Error(
        'Google did not grant Gemini access. Connect again and approve the requested permission.',
      );
    return selected;
  };
  const auth: ChatAuth = {
    async headers(requestSignal) {
      requestSignal.throwIfAborted();
      let selected = current();
      let token = selected.getAuthResponse(true);
      if (
        !Number.isFinite(token.expires_at) ||
        token.expires_at <= Date.now() + 60000
      ) {
        if (!refresh)
          refresh = selected.reloadAuthResponse().finally(() => {
            refresh = undefined;
          });
        try {
          token = await abortable(refresh, requestSignal);
        } catch {
          throw new Error(
            'Google authorization expired. Reconnect Gemini to continue.',
          );
        }
      }
      requestSignal.throwIfAborted();
      selected = current();
      if (
        !token.access_token ||
        token.expires_at <= Date.now() ||
        !token.scope?.split(/\s+/).includes(GEMINI_GOOGLE_SCOPE)
      )
        throw new Error(
          'Google did not return a valid Gemini permission. Reconnect Gemini.',
        );
      return {
        Authorization: `Bearer ${token.access_token}`,
        'x-goog-user-project': projectId,
      };
    },
  };
  // Verify the actual access-token scopes before enabling model discovery.
  await auth.headers(signal);
  return {
    accountId,
    email: user.getBasicProfile()?.getEmail() || 'Google account',
    projectId,
    auth,
    disconnect() {
      connected = false;
    },
  };
}

export function watchGeminiGoogleAccount(
  connection: GeminiGoogleConnection,
  invalidated: () => void,
): () => void {
  let notified = false;
  const verify = () => {
    const user = signedInGoogleUser();
    if (
      user?.getId() !== connection.accountId ||
      !user?.hasGrantedScopes(GEMINI_GOOGLE_SCOPE)
    ) {
      if (!notified) {
        notified = true;
        invalidated();
      }
    }
  };
  const auth = window.gapi?.auth2?.getAuthInstance();
  const listeners = [
    auth?.currentUser?.listen?.(verify),
    auth?.isSignedIn?.listen?.(verify),
  ];
  verify();
  return () => listeners.forEach((listener) => listener?.remove());
}
