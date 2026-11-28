import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { BoardWorkspaceDocument } from '../components/pcb/BoardWorkspace';

type BoardTab = { id: string; document: BoardWorkspaceDocument; mount: number };
type OpenBoards = { tabs: BoardTab[]; activeId?: string };

export function useOpenBoards() {
  const [state, setState] = useState<OpenBoards>({ tabs: [] });
  const current = useRef(state);
  const [, changed] = useReducer((value: number) => value + 1, 0);
  const get = useCallback(() => current.current, []);

  const update = useCallback((change: (state: OpenBoards) => OpenBoards) => {
    const state = change(current.current);
    current.current = state;
    setState(state);
  }, []);

  useEffect(() => {
    const unsubscribe = state.tabs.map(({ document }) =>
      document.session.subscribeChange(changed),
    );
    return () => unsubscribe.forEach((dispose) => dispose());
  }, [state.tabs]);

  const add = useCallback(
    (document: BoardWorkspaceDocument, single: boolean) => {
      const id = crypto.randomUUID();
      update(({ tabs }) => ({
        tabs: [...(single ? [] : tabs), { id, document, mount: 0 }],
        activeId: id,
      }));
      return id;
    },
    [update],
  );

  const select = useCallback(
    (id: string) => {
      update((state) =>
        state.tabs.some((item) => item.id === id)
          ? { ...state, activeId: id }
          : state,
      );
    },
    [update],
  );

  const deactivate = useCallback(() => {
    if (current.current.activeId) update((state) => ({ ...state, activeId: undefined }));
  }, [update]);

  const replace = useCallback(
    (
      id: string,
      document: BoardWorkspaceDocument,
      expected?: BoardWorkspaceDocument,
    ) => {
      update((state) => ({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === id && (!expected || tab.document === expected)
            ? {
                ...tab,
                document,
                mount:
                  tab.document.session === document.session
                    ? tab.mount
                    : tab.mount + 1,
              }
            : tab,
        ),
      }));
    },
    [update],
  );

  const remove = useCallback(
    (ids: readonly string[]) => {
      update(({ tabs, activeId }) => {
        const remaining = tabs.filter(({ id }) => !ids.includes(id));
        return {
          tabs: remaining,
          activeId: remaining.some(({ id }) => id === activeId) ? activeId : undefined,
        };
      });
    },
    [update],
  );

  return { ...state, get, add, select, deactivate, replace, remove };
}
