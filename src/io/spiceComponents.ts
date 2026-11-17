import type { Dispatch } from 'redux';
import type { tclib } from '../model/tclib';
import { normalizeTclibLoadError } from '../model/tclib';
import { LibraryActionTypes } from '../state/actions/libraryActions';
import {
  actionSelectDialog,
  actionSheetSelect,
} from '../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../state/undo/undo';
import {
  BUNDLED_LIBRARY_PREFIX,
  bundledLibraries,
  BundledLibrarySnapshot,
} from './bundledLibraries';
import { librarySymbolSelection } from './librarySymbols';

export const SPICE_LIBRARY_ID = 'spice';
export const SPICE_COMPONENTS = [
  {
    id: 'resistor',
    name: 'Resistor',
    labelKey: 'toolbar.spiceComponents.resistor',
  },
  {
    id: 'capacitor',
    name: 'Capacitor',
    labelKey: 'toolbar.spiceComponents.capacitor',
  },
  {
    id: 'inductor',
    name: 'Inductor',
    labelKey: 'toolbar.spiceComponents.inductor',
  },
  { id: 'diode', name: 'Diode', labelKey: 'toolbar.spiceComponents.diode' },
  { id: 'led', name: 'LED (red)', labelKey: 'toolbar.spiceComponents.led' },
  {
    id: 'npn',
    name: 'NPN transistor',
    labelKey: 'toolbar.spiceComponents.npn',
  },
  {
    id: 'pnp',
    name: 'PNP transistor',
    labelKey: 'toolbar.spiceComponents.pnp',
  },
  {
    id: 'opamp',
    name: '741 op-amp',
    labelKey: 'toolbar.spiceComponents.opamp',
  },
] as const;
export type SpiceComponentId = (typeof SPICE_COMPONENTS)[number]['id'];

let pendingLibrary: Promise<tclib | null> | null = null;
let componentRequest = 0;

function waitForLibraryState(
  ready: (snapshot: BundledLibrarySnapshot) => boolean,
): Promise<void> {
  if (ready(bundledLibraries.getSnapshot())) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = bundledLibraries.subscribe(() => {
      if (ready(bundledLibraries.getSnapshot())) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function requireSpiceLibrary(): Promise<tclib | null> {
  // Concurrent menu clicks share the initial download and SQLite parse.
  if (pendingLibrary) return pendingLibrary;
  const request = (async () => {
    await bundledLibraries.initialize();
    const initial = bundledLibraries.getSnapshot();
    if (
      !initial.catalog?.libraries.some((entry) => entry.id === SPICE_LIBRARY_ID)
    ) {
      throw new Error(
        initial.error || 'The standard SPICE library is not configured.',
      );
    }
    await waitForLibraryState((snapshot) => !snapshot.saving);
    if (bundledLibraries.getSnapshot().selected[0] !== SPICE_LIBRARY_ID) {
      await bundledLibraries.select([SPICE_LIBRARY_ID]);
    } else {
      await bundledLibraries.load(SPICE_LIBRARY_ID);
    }
    await waitForLibraryState(
      (snapshot) =>
        !snapshot.saving && !snapshot.loading.includes(SPICE_LIBRARY_ID),
    );
    const snapshot = bundledLibraries.getSnapshot();
    if (snapshot.selected[0] !== SPICE_LIBRARY_ID) {
      if (snapshot.error) throw new Error(snapshot.error);
      return null; // A later user selection takes precedence over this request.
    }
    const library = snapshot.libraries.find(
      (entry) => entry.fileId === BUNDLED_LIBRARY_PREFIX + SPICE_LIBRARY_ID,
    );
    if (!library)
      throw new Error(
        snapshot.error ||
          snapshot.errors[SPICE_LIBRARY_ID] ||
          'Unable to load the standard SPICE library.',
      );
    return library;
  })();
  pendingLibrary = request;
  try {
    return await request;
  } finally {
    if (pendingLibrary === request) pendingLibrary = null;
  }
}

function reportFailure(dispatch: Dispatch, error: unknown) {
  dispatch(
    actionSelectDialog('io_failure', {
      message: normalizeTclibLoadError(error).summary,
    }),
  );
}

export function insertSpiceComponent(id: SpiceComponentId) {
  return async (dispatch: Dispatch<any>, getState: () => docDrawing) => {
    const before = getState().docStore.present;
    if (before.editLibrary) return;
    const request = ++componentRequest;
    const documentId = before.drawing.documentId;
    try {
      const library = await requireSpiceLibrary();
      const state = getState().docStore.present;
      if (
        !library ||
        request !== componentRequest ||
        state.editLibrary ||
        state.drawing.documentId !== documentId
      )
        return;
      const component = SPICE_COMPONENTS.find((entry) => entry.id === id);
      const name = library.names.find(
        (entry) => entry.Name === component?.name,
      );
      if (!name)
        throw new Error(`SPICE component not found: ${component?.name || id}`);
      dispatch({
        type: LibraryActionTypes.SetBundledLibraries,
        libraries: bundledLibraries.getSnapshot().libraries,
      });
      if (
        state.drawing.sheets[state.view.selected_sheet]?.kind === 'simulation'
      ) {
        const index = state.drawing.sheets.findIndex(
          (sheet) => sheet.kind !== 'simulation',
        );
        if (index < 0)
          throw new Error(
            'No schematic sheet is available for component placement.',
          );
        dispatch(actionSheetSelect(index));
      }
      dispatch(librarySymbolSelection(library, name, true));
    } catch (error) {
      if (
        request === componentRequest &&
        getState().docStore.present.drawing.documentId === documentId
      )
        reportFailure(dispatch, error);
    }
  };
}

export function showSpiceLibrary() {
  return async (dispatch: Dispatch<any>, getState: () => docDrawing) => {
    if (getState().docStore.present.editLibrary) return;
    const request = ++componentRequest;
    dispatch({
      type: LibraryActionTypes.ShowStandardLibrary,
      libraryId: SPICE_LIBRARY_ID,
    });
    try {
      const library = await requireSpiceLibrary();
      if (library)
        dispatch({
          type: LibraryActionTypes.SetBundledLibraries,
          libraries: bundledLibraries.getSnapshot().libraries,
        });
    } catch (error) {
      if (request === componentRequest) reportFailure(dispatch, error);
    }
  };
}
