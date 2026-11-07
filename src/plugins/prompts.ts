export interface HostPrompt {
  title: string; message: string; choices: { value: string; label: string }[];
  preview?: string; resolve: (choice: string) => void;
}
const listeners = new Set<() => void>();
const queue: HostPrompt[] = [];
export const prompts = {
  subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; },
  snapshot: () => queue[0],
  ask(title: string, message: string, choices = [{ value: 'accept', label: 'Continue' }, { value: 'cancel', label: 'Cancel' }], preview?: string) {
    return new Promise<string>(resolve => { queue.push({ title, message, choices, preview, resolve }); for (const callback of listeners) callback(); });
  },
  answer(choice: string) { const request = queue.shift(); request?.resolve(choice); for (const callback of listeners) callback(); },
};
