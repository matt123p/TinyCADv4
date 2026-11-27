import { useRef, useState } from 'react';

export type TextHistoryCommand = 'undo' | 'redo';

type TextSnapshot = {
  value: string;
  start: number;
  end: number;
  direction: HTMLTextAreaElement['selectionDirection'];
  scrollLeft: number;
  scrollTop: number;
};

function snapshot(editor: HTMLTextAreaElement): TextSnapshot {
  return {
    value: editor.value,
    start: editor.selectionStart,
    end: editor.selectionEnd,
    direction: editor.selectionDirection,
    scrollLeft: editor.scrollLeft,
    scrollTop: editor.scrollTop,
  };
}

export function useProjectTextHistory(onEdit: (value: string) => void) {
  const past = useRef<TextSnapshot[]>([]);
  const future = useRef<TextSnapshot[]>([]);
  const before = useRef<TextSnapshot>();
  const group = useRef<{ type: string; caret: number; time: number }>();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function updateAvailability() {
    setCanUndo(past.current.length > 0);
    setCanRedo(future.current.length > 0);
  }

  function capture(event: InputEvent, editor: HTMLTextAreaElement) {
    if (
      event.inputType === 'historyUndo' ||
      event.inputType === 'historyRedo'
    ) {
      event.preventDefault();
      run(event.inputType === 'historyUndo' ? 'undo' : 'redo', editor);
    } else {
      before.current = snapshot(editor);
    }
  }

  function record(
    event: InputEvent,
    editor: HTMLTextAreaElement,
    value: string,
  ) {
    const previous = before.current ?? { ...snapshot(editor), value };
    before.current = undefined;
    if (editor.value === previous.value) return;
    const type = event.inputType;
    const time = performance.now();
    const typing =
      (type === 'insertText' && !event.data?.includes('\n')) ||
      type === 'insertCompositionText' ||
      type === 'deleteContentBackward' ||
      type === 'deleteContentForward';
    const related =
      typing &&
      group.current?.type === type &&
      previous.start === previous.end &&
      previous.start === group.current.caret &&
      (event.isComposing || time - group.current.time < 1000);
    if (!related) {
      past.current.push(previous);
      const maxEntries = Math.max(
        2,
        Math.min(
          100,
          Math.floor(4_000_000 / Math.max(1, previous.value.length)),
        ),
      );
      if (past.current.length > maxEntries)
        past.current.splice(0, past.current.length - maxEntries);
    }
    future.current.length = 0;
    group.current = typing
      ? { type, time, caret: editor.selectionEnd }
      : undefined;
    updateAvailability();
    onEdit(editor.value);
  }

  function run(command: TextHistoryCommand, editor: HTMLTextAreaElement) {
    group.current = undefined;
    const source = command === 'undo' ? past.current : future.current;
    const destination = command === 'undo' ? future.current : past.current;
    const target = source.pop();
    if (!target) return;
    destination.push(snapshot(editor));
    editor.value = target.value;
    editor.setSelectionRange(target.start, target.end, target.direction);
    editor.scrollLeft = target.scrollLeft;
    editor.scrollTop = target.scrollTop;
    updateAvailability();
    onEdit(target.value);
  }

  function reset() {
    past.current.length = 0;
    future.current.length = 0;
    before.current = undefined;
    group.current = undefined;
    updateAvailability();
  }

  return { capture, record, run, reset, canUndo, canRedo };
}
