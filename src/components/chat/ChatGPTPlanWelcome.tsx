import React, { useEffect, useRef } from 'react';
import { openChatGPTUsage } from '../../chat/chatgpt';
export function ChatGPTPlanWelcome({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="chat-plan-welcome"
      aria-label="Using your ChatGPT plan"
      onCancel={onClose}
    >
      <strong>You're using your ChatGPT plan</strong>
      <p>
        Eligible requests in TinyCAD use your ChatGPT plan or available credits.
        You can review and manage app usage in ChatGPT settings.
      </p>
      <button type="button" onClick={openChatGPTUsage}>
        Manage usage
      </button>{' '}
      <button type="button" autoFocus onClick={onClose}>
        Got it
      </button>
    </dialog>
  );
}
