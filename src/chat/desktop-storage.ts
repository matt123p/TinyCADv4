import { isElectron } from '../io/apiServer';

export async function desktopSecret(
  operation: string,
  value?: { provider: string; endpoint: string; key: string },
) {
  if (!isElectron) return {};
  if (!window.electronAPI?.chatSecret)
    throw new Error('Restart TinyCAD to enable secure API-key storage.');
  const reply = await window.electronAPI.chatSecret(operation, value);
  if (reply.error) throw new Error(reply.error);
  return reply.result || {};
}
export { isElectron };

export const chatConnectionKey = 'tinycad.chat.connection.v1';
