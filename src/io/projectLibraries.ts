import type { Dispatch } from 'redux';
import { normalizeTclibLoadError, type tclib } from '../model/tclib';
import {
  actionSetLibraryData,
  actionSetLibraryList,
  actionUpdateConfig,
} from '../state/dispatcher/AppDispatcher';
import type { UserConfig } from '../state/stores/altStoreReducer';
import type { docDrawing } from '../state/undo/undo';
import {
  normalizeUserConfig,
  type ConfiguredLibraryFile,
  type NormalizedUserConfig,
} from './libraryConfig';
import { projectFilesChanged } from './projectStorage';
import { projectRequest } from './projects';

type GetState = () => docDrawing;
type Session = {
  project: string;
  lastConfig?: NormalizedUserConfig;
  saved: boolean;
  savingInitial: boolean;
};
let session: Session | undefined;
const pending = new Map<string, Promise<void>>();

function isCurrent(active: Session, getState: GetState) {
  return (
    active === session &&
    getState().schematicTabs?.projectRoot === active.project
  );
}

function applyConfig(
  config: NormalizedUserConfig,
  dispatch: Dispatch,
  getState: GetState,
) {
  const existing = new Map(
    getState().altStore.libraries.map((library) => [library.fileId, library]),
  );
  const libraries: tclib[] = config.libraries.map(
    ({ id, name }) =>
      existing.get(id) ?? {
        fileId: id,
        name,
        modified: null,
        names: [],
        symbols: [],
      },
  );
  dispatch(actionUpdateConfig(config));
  dispatch(actionSetLibraryList(libraries));
}

async function loadLibraries(
  active: Session,
  entries: ConfiguredLibraryFile[],
  dispatch: Dispatch,
  getState: GetState,
) {
  await Promise.all(
    entries.map(async ({ id, name }) => {
      let library: tclib;
      try {
        library = await projectRequest({
          operation: 'read-project-library',
          project: active.project,
          id,
        });
      } catch (error) {
        library = {
          fileId: id,
          name,
          modified: null,
          names: [],
          symbols: [],
          bad: true,
          loadError: normalizeTclibLoadError(error),
        };
      }
      if (
        isCurrent(active, getState) &&
        getState().altStore.config.libraries.some((entry) => entry.id === id)
      )
        dispatch(actionSetLibraryData(library));
    }),
  );
}

export async function startProjectLibraries(
  project: string,
  dispatch: Dispatch,
  getState: GetState,
) {
  const active: Session = { project, saved: false, savingInitial: false };
  session = active;
  applyConfig(normalizeUserConfig(null), dispatch, getState);
  await pending.get(project)?.catch((): void => {});
  const { config, saved } = await projectRequest({
    operation: 'project-library-config',
    project,
  });
  if (!isCurrent(active, getState)) return;
  const normalized = normalizeUserConfig(config);
  active.saved = saved;
  active.lastConfig = normalized;
  applyConfig(normalized, dispatch, getState);
  void loadLibraries(active, normalized.libraries, dispatch, getState);
}

export function endProjectLibraries(dispatch: Dispatch, getState: GetState) {
  session = undefined;
  applyConfig(normalizeUserConfig(null), dispatch, getState);
  window.electronAPI.requestStartupLists?.();
}

function persist(
  active: Session,
  config: NormalizedUserConfig,
  initialOnly = false,
) {
  const { project } = active;
  const previous = pending.get(project) ?? Promise.resolve();
  const write = previous
    .catch((): void => {})
    .then(async () => {
      if (initialOnly && active.saved) return;
      await projectRequest({
        operation: 'save-project-library-config',
        project,
        config,
        initialOnly,
      });
      active.saved = true;
      active.lastConfig = config;
      window.dispatchEvent(new Event(projectFilesChanged));
    });
  pending.set(project, write);
  const clear = () => {
    if (pending.get(project) === write) pending.delete(project);
  };
  void write.then(clear, clear);
  return write;
}

export async function rememberProjectLibrariesOnEdit(getState: GetState) {
  const active = session;
  if (
    !active?.lastConfig ||
    active.saved ||
    active.savingInitial ||
    !isCurrent(active, getState)
  )
    return;
  active.savingInitial = true;
  try {
    await persist(
      active,
      normalizeUserConfig(getState().altStore.config),
      true,
    );
  } finally {
    active.savingInitial = false;
  }
}

export async function updateProjectLibraryConfig(
  config: UserConfig,
  dispatch: Dispatch,
  getState: GetState,
) {
  const active = session;
  if (!active?.lastConfig || !isCurrent(active, getState))
    throw new Error('Project libraries are unavailable.');
  const normalized = normalizeUserConfig(config);
  applyConfig(normalized, dispatch, getState);
  try {
    await persist(active, normalized);
  } catch (error) {
    if (
      isCurrent(active, getState) &&
      getState().altStore.config === normalized
    ) {
      applyConfig(active.lastConfig, dispatch, getState);
      void loadLibraries(
        active,
        active.lastConfig.libraries,
        dispatch,
        getState,
      );
    }
    throw error;
  }
}

export function addProjectLibraries(id?: string, folderId?: string) {
  return async (dispatch: Dispatch, getState: GetState) => {
    const active = session;
    if (!active?.lastConfig || !isCurrent(active, getState))
      throw new Error('Project libraries are unavailable.');
    const chosen = await projectRequest({
      operation: 'choose-project-libraries',
      project: active.project,
      id,
    });
    if (!chosen.length || !isCurrent(active, getState)) return false;
    const config = normalizeUserConfig(getState().altStore.config);
    const added = chosen.filter(
      ({ id }) => !config.libraries.some((entry) => entry.id === id),
    );
    if (added.length) {
      const libraries = [
        ...added.map((entry) => ({ ...entry, folderId })),
        ...config.libraries,
      ];
      await updateProjectLibraryConfig(
        { ...config, libraries },
        dispatch,
        getState,
      );
    }
    if (isCurrent(active, getState)) {
      const entries = normalizeUserConfig(getState().altStore.config).libraries;
      void loadLibraries(
        active,
        entries.filter((entry) => chosen.some((file) => file.id === entry.id)),
        dispatch,
        getState,
      );
    }
  };
}

export function refreshProjectLibraries(
  dispatch: Dispatch,
  getState: GetState,
) {
  const active = session;
  if (active?.lastConfig && isCurrent(active, getState))
    return loadLibraries(
      active,
      normalizeUserConfig(getState().altStore.config).libraries,
      dispatch,
      getState,
    );
}
