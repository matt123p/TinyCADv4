import React from 'react';

import { ActionCreators } from 'redux-undo';
import { ioXML } from './ioXml';
import {
  actionAddImage,
  actionBomGenerate,
  actionCommand,
  actionMenuBrowserOpen,
  actionRename,
  actionSelectDialog,
  actionSetDocument,
  actionSetFileData,
  actionSetLibraryData,
  actionSetLibraryList,
  actionSetSaveInProgress,
  actionUpdateConfig,
  actionUpdateCurrentLibrary,
  actionUpdateNetlistHints,
} from '../state/dispatcher/AppDispatcher';
import { Dispatch } from 'redux';
import { docDrawing } from '../state/undo/undo';
import { CurrentFile, UserConfig } from '../state/stores/altStoreReducer';
import { saveAs } from 'file-saver';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../model/tclib';
import { libCache } from './libCache';
import TPrintSheet from '../components/svg/PrintSheet';
import { render } from 'react-dom';
import { Coordinate, DocItem, DocItemTypes, dsnPin } from '../model/dsnItem';
import { apiServer } from '../components/libraryPanel/Search';
import update from 'immutability-helper';

import { ElectronUserManager } from './electron/electronUserManager';
import { UnsavedAction } from '../components/dialogues/unsavedChangesDlg';
import { blank } from './ioXml';
import { updateLibrary } from '../manipulators/updateLibrary';
import { updateDrawing } from '../manipulators/updateDrawing';
import { updateFactory } from '../manipulators/updateFactory';
import { GoogleUserManager } from './google/googleUserManager';
import { FileSystemUserManager } from './filesystem/filesystemUserManager';
import { wkrGenerateNetlist } from '../web-worker/worker';
import { downloadNetlist } from './netlists/netlistFiles';
import { findImporter, ImportedSymbol } from './kicad/importer';
import { actionEditLibrarySymbol, actionSelectLibrarySymbol } from '../state/dispatcher/AppDispatcher';
import { get_global_id } from '../util/global_id';
import { openCurrentAppUrl, openExternalUrl } from '../util/navigation';

export type FileIdType = string | FileSystemFileHandle;

export interface UserManager {
  initialize(dispatch: Dispatch): Promise<void>;
  fileOpen(dispatch: Dispatch, file?: CurrentFile): void;
  saveFile(xml: string, file: CurrentFile): Promise<any>;
  login(): Promise<void>;
  renameFile(title: string, fileId: FileIdType): Promise<boolean>;
  loadLibrary(
    fileId: FileIdType,
    name: string,
    modified: string,
  ): Promise<tclib>;
  saveLibrary(lib: tclib, file: CurrentFile): Promise<any>;
  saveConfig(config: UserConfig): Promise<void>;
  loadConfig(): Promise<UserConfig>;
  updateConfig(callback: (config: UserConfig) => UserConfig): Promise<void>;
  loadFileMetadata(fileId: FileIdType): Promise<any>;
}

export let userManager: UserManager = null;

export function initialise() {
  return (dispatch: Dispatch, getState: { (): docDrawing }): Promise<void> => {
    if (process.env.TARGET_SYSTEM === 'google') {
      userManager = new GoogleUserManager();
    } else if (process.env.TARGET_SYSTEM === 'electron') {
      userManager = new ElectronUserManager();
    } else {
      userManager = new FileSystemUserManager();
    }

    return userManager.initialize(dispatch);
  };
}

export function login(dispatch: Dispatch, getState: { (): docDrawing }) {
  userManager.login();
}


// Helper to check if save is needed
function checkSaveNeeded(getState: { (): docDrawing }): boolean {
  const state = getState();
  return state.docStore.present.drawingVersion !== state.altStore.savedVersion;
}

// Performs the actual action after user confirms (or if no save needed)
export function performPendingAction(pendingAction: UnsavedAction) {
  return (dispatch: Dispatch, getState: { (): docDrawing }) => {
    switch (pendingAction.type) {
      case 'file-new':
        // Create a new blank drawing and reset file data
        dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
        dispatch(ActionCreators.clearHistory());
        break;
      case 'file-open':
        userManager.fileOpen(dispatch);
        break;
      case 'file-open-recent':
        userManager.fileOpen(dispatch, pendingAction.file as CurrentFile);
        break;
    }
  };
}

export function fileNew() {
  return (dispatch: Dispatch, getState: { (): docDrawing }) => {
    const pendingAction: UnsavedAction = { type: 'file-new' };
    
    if (checkSaveNeeded(getState)) {
      dispatch(actionSelectDialog('unsaved_changes', { pendingAction }));
      return;
    }

    // No save needed, perform action directly
    dispatch(performPendingAction(pendingAction) as any);
  };
}

export function fileOpen(file?: CurrentFile) {
  return (dispatch: Dispatch, getState: { (): docDrawing }) => {
    const pendingAction: UnsavedAction = file 
      ? { type: 'file-open-recent', file: { name: file.name, id: file.id as string } }
      : { type: 'file-open' };
    
    if (checkSaveNeeded(getState)) {
      dispatch(actionSelectDialog('unsaved_changes', { pendingAction }));
      return;
    }

    // No save needed, perform action directly
    dispatch(performPendingAction(pendingAction) as any);
  }
}

export function fileSave(dispatch: Dispatch, getState: { (): docDrawing }) {
  return internalfileSave(dispatch, getState, false);
}

export function fileSaveAs(dispatch: Dispatch, getState: { (): docDrawing }) {
  return internalfileSave(dispatch, getState, true);
}

function internalfileSave(
  dispatch: Dispatch,
  getState: { (): docDrawing },
  saveAs: boolean,
) {
  const file = getState().altStore.file;
  const saveInProgress = getState().altStore.saveInProgress;
  const drawing = getState().docStore.present.drawing;
  const drawingVerison = getState().docStore.present.drawingVersion;

  // If we are already saving the file, then ignore this...
  if (saveInProgress) {
    return;
  }

  dispatch(actionSetSaveInProgress(true, null));

  wkrGenerateNetlist(drawing)
    .then((netlist) => {
      const io = new ioXML();
      const update_drawing = new updateDrawing();
      const drawing_with_hints = update_drawing.updateNetlistHints(
        drawing,
        netlist,
      );
      const xml = io.to_dsn(drawing_with_hints, true, true);
      return userManager.saveFile(xml.tostring(), {
        ...file,
        id: saveAs ? null : file.id,
      });
    })
    .then(
      (meta) => {
        dispatch(
          actionSetFileData(meta.name, meta.id, file.folderId, drawingVerison),
        );
      },
      (error: string) => {
        dispatch(actionSetSaveInProgress(false, null));
        if (error) {
          dispatch(actionSelectDialog('io_failure', { message: error }));
        }
      },
    );
}

export function librarySave(dispatch: Dispatch, getState: { (): docDrawing }) {
  return internalLibrarySave(dispatch, getState, false);
}

export function librarySaveAs(
  dispatch: Dispatch,
  getState: { (): docDrawing },
) {
  return internalLibrarySave(dispatch, getState, true);
}

function internalLibrarySave(
  dispatch: Dispatch,
  getState: { (): docDrawing },
  saveAs: boolean,
) {
  const file = getState().altStore.file;
  const saveInProgress = getState().altStore.saveInProgress;
  let library = getState().docStore.present.editLibrary;
  const editSymbol = getState().docStore.present.editSymbol;
  const drawing = getState().docStore.present.drawing;

  // If we are already saving the file, then ignore this...
  if (saveInProgress) {
    return;
  }

  if (editSymbol) {
    // First write back the edited symbol to the library
    const update_library = new updateLibrary(library);
    library = update_library.writeSymbolData(editSymbol, drawing);
    dispatch(actionUpdateCurrentLibrary(library));
  }
  
  const drawingVerison = getState().docStore.present.drawingVersion;

  dispatch(actionSetSaveInProgress(true, null));

  userManager
    .saveLibrary(library, { ...file, id: saveAs ? null : file.id })
    .then(
      (meta) => {
        dispatch(
          actionSetFileData(meta.name, meta.id, file.folderId, drawingVerison),
        );
      },
      (error: string) => {
        dispatch(actionSetSaveInProgress(false, null));
        dispatch(actionSelectDialog('io_failure', { message: error }));
      },
    );
}

export function renameFile(
  title: string,
  fileId: FileIdType,
  dispatch: Dispatch,
) {
  userManager.renameFile(title, fileId).then(
    (ok) => {
      if (ok) {
        dispatch(actionRename(title));
      }
    },
    (error: string) =>
      dispatch(actionSelectDialog('io_failure', { message: error })),
  );
}

export function downloadBom(dispatch: Dispatch, getState: { (): docDrawing }) {
  const bom = getState().docStore.present.bom;
  let filename = getState().altStore.file.name;
  filename = filename.replace(/\.[^/.]+$/, '') + '.csv';

  let txt =
    'Reference,Quantity,Name\r\n' +
    bom
      .map(
        (be) => `\"${be.References.join(',')}\",${be.Quantity},\"${be.Name}\"`,
      )
      .join('\r\n');

  var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, filename);
}

export function removeLibrary(fileId: string) {
  return (dispatch: Dispatch, getState: { (): docDrawing }) => {
    const libraries: tclib[] = getState().altStore.libraries.filter(
      (f) => f.fileId !== fileId,
    );
    dispatch(actionSetLibraryList(libraries));

    if (process.env.TARGET_SYSTEM === 'electron' && window.electronAPI) {
      window.electronAPI.removeLibrary(fileId);
      return;
    }

    userManager.updateConfig((config) => {
      const index = config.libraries.findIndex((l) => l.id === fileId);
      if (index >= 0) {
        config = update(config, {
          libraries: {
            $splice: [[index, 1]],
          },
        });
      }
      return config;
    });
  };
}

function createSymbolXml(items: any[][]): string {
  const io = new ioXML();
  const drawing = blank();
  drawing.sheets = items.map((sheetItems, index) => ({
    ...drawing.sheets[0],
    name: `Part ${index + 1}`,
    items: sheetItems,
    symbols: {},
    images: {},
    hatches: [] as any[],
    hierarchicalSymbol: false,
  }));

  let xml = io.to_dsn(drawing, false, false).tostring();
  if (drawing.sheets.length === 1) {
    xml = xml.replace('<TinyCADSheets>', '').replace('</TinyCADSheets>', '');
  }
  return xml;
}

const IMPORTED_SYMBOL_PAGE_MARGIN = 20;
const IMPORTED_SYMBOL_GRID = 10;
const GRID_EPSILON = 1e-6;

function isOnGrid(value: number, grid: number): boolean {
  return Math.abs(value / grid - Math.round(value / grid)) < GRID_EPSILON;
}

function quantizeOffsetForMargin(minValue: number, margin: number, grid: number): number {
  const rawOffset = minValue - margin;
  return Math.floor(rawOffset / grid) * grid;
}

function offsetImportedSymbolToPage(items: DocItem[]): DocItem[] {
  if (!items || items.length === 0) {
    return items;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const updater = updateFactory(item);
    if (!updater || !updater.getBoundingRect) {
      continue;
    }

    const bounds = updater.getBoundingRect();
    minX = Math.min(minX, bounds.x1);
    minY = Math.min(minY, bounds.y1);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return items;
  }

  const offset: Coordinate = [
    quantizeOffsetForMargin(minX, IMPORTED_SYMBOL_PAGE_MARGIN, IMPORTED_SYMBOL_GRID),
    quantizeOffsetForMargin(minY, IMPORTED_SYMBOL_PAGE_MARGIN, IMPORTED_SYMBOL_GRID),
  ];

  const samplePin = items.find((item) => item.NodeName === DocItemTypes.Pin) as dsnPin | undefined;
  if (samplePin) {
    const pinWasOnGrid =
      isOnGrid(samplePin.point[0], IMPORTED_SYMBOL_GRID) &&
      isOnGrid(samplePin.point[1], IMPORTED_SYMBOL_GRID);

    if (pinWasOnGrid) {
      const shiftedPinX = samplePin.point[0] - offset[0];
      const shiftedPinY = samplePin.point[1] - offset[1];
      if (
        !isOnGrid(shiftedPinX, IMPORTED_SYMBOL_GRID) ||
        !isOnGrid(shiftedPinY, IMPORTED_SYMBOL_GRID)
      ) {
        offset[0] = Math.round(offset[0] / IMPORTED_SYMBOL_GRID) * IMPORTED_SYMBOL_GRID;
        offset[1] = Math.round(offset[1] / IMPORTED_SYMBOL_GRID) * IMPORTED_SYMBOL_GRID;
      }
    }
  }

  if (offset[0] === 0 && offset[1] === 0) {
    return items;
  }

  return items.map((item) => {
    const updater = updateFactory(item);
    if (!updater || !updater.relative_move) {
      return item;
    }
    return updater.relative_move(offset);
  });
}

function offsetImportedSymbolDataToPage(symbolData: DocItem[][]): DocItem[][] {
  return symbolData.map((sheetItems) => offsetImportedSymbolToPage(sheetItems));
}

function mergeImportedSymbolsIntoLibrary(
  library: tclib,
  imported: ImportedSymbol[],
): tclib {
  let nextNameId =
    library.names.reduce((maxId, n) => Math.max(maxId, n.NameID), 0) + 1;
  let nextSymbolId =
    library.symbols.reduce((maxId, s) => Math.max(maxId, s.SymbolId), 0) + 1;

  const names = [...library.names];
  const symbols = [...library.symbols];
  const usedNames = new Set(names.map((n) => n.Name.toLowerCase()));

  for (const symbol of imported) {
    const normalizedSymbolData = offsetImportedSymbolDataToPage(symbol.symbolData);
    let symbolName = symbol.name.Name || 'Imported Symbol';
    let suffix = 2;
    while (usedNames.has(symbolName.toLowerCase())) {
      symbolName = `${symbol.name.Name} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(symbolName.toLowerCase());

    names.push({
      ...symbol.name,
      id: symbol.name.id || `import-${get_global_id()}`,
      Name: symbolName,
      NameID: nextNameId,
      SymbolID: nextSymbolId,
      ppp: Math.max(1, normalizedSymbolData.length),
    });

    symbols.push({
      SymbolId: nextSymbolId,
      Data: createSymbolXml(normalizedSymbolData),
    });

    nextNameId += 1;
    nextSymbolId += 1;
  }

  return {
    ...library,
    names,
    symbols,
  };
}

export function importSelectedSymbolsToCurrentLibrary(selectedSymbols: ImportedSymbol[]) {
  return (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    if (!selectedSymbols || selectedSymbols.length === 0) {
      dispatch(
        actionSelectDialog('io_failure', {
          message: 'No symbols were selected for import.',
        }),
      );
      return;
    }

    const state = getState();
    const editLibrary = state.docStore.present.editLibrary;
    if (!editLibrary) {
      dispatch(
        actionSelectDialog('io_failure', {
          message: 'No library is currently open for editing.',
        }),
      );
      return;
    }

    const merged = mergeImportedSymbolsIntoLibrary(editLibrary, selectedSymbols);
    dispatch(actionUpdateCurrentLibrary(merged));
    dispatch(actionEditLibrarySymbol(merged.names[merged.names.length - 1]));
  };
}

function pickImportFile(): Promise<{ fileName: string; content: string } | null> {
  if (process.env.TARGET_SYSTEM === 'electron' && window.electronAPI?.openKicadImport) {
    return window.electronAPI.openKicadImport();
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kicad_sym';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then((content) => {
        resolve({
          fileName: file.name,
          content,
        });
      });
    };
    input.click();
  });
}

export function importSymbolsFromFile() {
  return async (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    try {
      const picked = await pickImportFile();
      if (!picked) {
        return;
      }

      const importer = findImporter(picked.fileName);
      if (!importer) {
        dispatch(
          actionSelectDialog('io_failure', {
            message: 'No importer is available for this file type.',
          }),
        );
        return;
      }

      const importedSymbols = await importer.importSymbols(
        picked.content,
        picked.fileName,
      );

      if (importedSymbols.length === 0) {
        dispatch(
          actionSelectDialog('io_failure', {
            message: 'No symbols were found in the selected file.',
          }),
        );
        return;
      }

      const state = getState();
      const editLibrary = state.docStore.present.editLibrary;
      if (editLibrary) {
        dispatch(
          actionSelectDialog('import_library_symbol_picker', {
            symbols: importedSymbols,
          }),
        );
        return;
      }

      dispatch(
        actionSelectDialog('import_symbol_picker', {
          symbols: importedSymbols,
        }),
      );
    } catch (error) {
      dispatch(
        actionSelectDialog('io_failure', {
          message: `Failed to import symbols: ${error}`,
        }),
      );
    }
  };
}

export function loadLibraries(
  dispatch: Dispatch,
  getState: { (): docDrawing },
) {
  // In Electron mode, libraries are loaded via the electronAPI.libraries() callback
  // during initialization (in ElectronUserManager.initialize). We should not call
  // loadConfig() here as it returns an empty library list, which would overwrite
  // the actual libraries that Electron provides.
  if (process.env.TARGET_SYSTEM === 'electron') {
    return;
  }

  userManager.loadConfig().then((config) => {
    dispatch(actionUpdateConfig(config));
    const libraries: tclib[] = config.libraries.map((l) => ({
      fileId: l.id,
      name: l.name,
      modified: null as string | null,
      names: [] as tclibLibraryEntry[],
      symbols: [] as tclibSymbol[],
    }));
    dispatch(actionSetLibraryList(libraries));
    libCache().then((lc) => {
      libraries.reduce(
        (p, file) =>
          p
            .then(() => lc.getLibrary(file.fileId as string))
            .then((cachedLib) => {
              // Do we have a cached version of this library?
              if (cachedLib) {
                dispatch(actionSetLibraryData(cachedLib));
              }

              // Now fetch the metadata for this library
              return userManager
                .loadFileMetadata(file.fileId)
                .then((libMetaData) => {
                  // Has the cached version of the library changed?
                  if (
                    !libMetaData ||
                    !cachedLib ||
                    libMetaData.modifiedDate !== cachedLib?.modified
                  ) {
                    return userManager
                      .loadLibrary(
                        file.fileId,
                        file.name,
                        libMetaData.modifiedDate,
                      )
                      .then((loadedLib) => {
                        dispatch(actionSetLibraryData(loadedLib));
                        lc.addLibrary(loadedLib);
                      });
                  } else {
                    return null;
                  }
                });
            }),
        Promise.resolve(),
      );
    });
  });
}

export function print(dispatch: Dispatch<any>, getState: { (): docDrawing }) {
  import('./print').then((module) => {
    if (process.env.TARGET_SYSTEM === 'electron') {
      module.pdfPrint(dispatch, getState);
      return;
    }

    module.pdfExport(dispatch, getState);
  });
}

export function exportPdf(dispatch: Dispatch<any>, getState: { (): docDrawing }) {
  import('./print').then((module) => module.pdfExport(dispatch, getState));
}

export function exportSvg(
  dispatch: Dispatch<any>,
  getState: { (): docDrawing },
) {
  const state = getState();
  const sheet = state.docStore.present.drawing.sheets[0];
  const fileName = state.altStore.file?.name
    ? `${state.altStore.file.name.replace(/\.[^.]+$/, '')}.svg`
    : 'drawing.svg';

  const element = document.createElement('div');
  render(
    <TPrintSheet
      items={sheet.items}
      page_size={sheet.details.page_size}
      details={sheet.details}
      options={sheet.options}
      images={sheet.images}
      hatches={sheet.hatches}
    />,
    element,
  );

  let blob = new Blob(
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      element.innerHTML,
    ],
    { type: 'image/svg+xml' },
  );

  if (process.env.TARGET_SYSTEM === 'electron' && window.electronAPI?.saveSvg) {
    blob.text().then((content) => {
      window.electronAPI.saveSvg({ content, name: fileName });
    });
    return;
  }

  const url = URL.createObjectURL(blob);
  openExternalUrl(url);
}

export function imageFile(file: File | Blob, pos: Coordinate, imgType: string) {
  return (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        dispatch(
          actionAddImage(
            event.target.result as string,
            imgType,
            file.size,
            [img.width, img.height],
            pos,
          ),
        );
      };
      img.src = event.target.result as string;
    };
    reader.readAsDataURL(file);
  };
}

export interface WebUserModel {
  provider: string;
  email: string;
  displayName: string;
}

export function logWebUser(user: WebUserModel) {
  // It is not that important to us if this fails...
  fetch(`${apiServer}/api/Account/webUser`, {
    credentials: 'include',
    mode: 'cors',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(user),
  });
}

let lastWindowLaunchTime = 0;

export function handleMenuCommand(command: string) {
  return (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    const state = getState();
    const editLibrary = state.docStore.present.editLibrary;

    switch (command) {
      case 'file-new':
        if (editLibrary) {
          const now = Date.now();
          if (now - lastWindowLaunchTime < 1000) {
            return;
          }
          lastWindowLaunchTime = now;
          if (process.env.TARGET_SYSTEM === 'electron') {
            window.electronAPI.openNewWindow('');
          } else {
            openCurrentAppUrl();
          }
        } else {
          dispatch(fileNew() as any);
        }
        break;
      case 'file-open':
        dispatch(fileOpen() as any);
        break;
      case 'file-save':
        if (editLibrary) {
          dispatch(librarySave as any);
        } else {
          dispatch(fileSave as any);
        }
        break;
      case 'file-save-as':
        if (editLibrary) {
          dispatch(librarySaveAs as any);
        } else {
          dispatch(fileSaveAs as any);
        }
        break;
      case 'file-print':
        dispatch(print as any);
        break;
      case 'file-export-svg':
        dispatch(exportSvg as any);
        break;
      case 'file-export-pdf':
        dispatch(exportPdf as any);
        break;
      // Edit
      case 'edit-undo':
        dispatch(ActionCreators.undo());
        break;
      case 'edit-redo':
        dispatch(ActionCreators.redo());
        break;
      case 'edit-rotate-left':
        dispatch(actionCommand('rotate_left'));
        break;
      case 'edit-rotate-right':
        dispatch(actionCommand('rotate_right'));
        break;
      case 'edit-flip-h':
        dispatch(actionCommand('mirror_h'));
        break;
      case 'edit-flip-v':
        dispatch(actionCommand('mirror_v'));
        break;
      // View
      case 'view-zoom-in':
        dispatch(actionCommand('zoom_in'));
        break;
      case 'view-zoom-out':
        dispatch(actionCommand('zoom_out'));
        break;
      // Tools
      case 'tools-annotate':
        dispatch(actionSelectDialog('annotate', null));
        break;
      case 'tools-bom':
        dispatch(actionBomGenerate());
        break;
      case 'tools-netlist':
        dispatch(actionSelectDialog('netlist', null));
        break;
      case 'tools-spice':
        wkrGenerateNetlist(state.docStore.present.drawing).then((netlist) => {
          dispatch(actionUpdateNetlistHints(netlist));
          downloadNetlist(state.altStore.file.name, 'SPICE', netlist);
        });
        break;
      case 'tools-vhdl':
        if (process.env.TARGET_SYSTEM !== 'electron') {
          break;
        }
        wkrGenerateNetlist(state.docStore.present.drawing).then((netlist) => {
          dispatch(actionUpdateNetlistHints(netlist));
          downloadNetlist(state.altStore.file.name, 'VHDL', netlist);
        });
        break;
      case 'import-kicad-symbols':
        dispatch(importSymbolsFromFile() as any);
        break;
      case 'tools-drc':
        dispatch(actionSelectDialog('drc', null));
        break;
      case 'tools-new-lib':
        if (process.env.TARGET_SYSTEM === 'electron') {
          window.electronAPI.openNewWindow('new');
        } else {
          const qp = new URLSearchParams();
          qp.set('action', 'new-library');
          openCurrentAppUrl(qp);
        }
        break;
      case 'settings-design-details':
        dispatch(actionSelectDialog('design_details', null));
        break;
      case 'settings-page-size':
        dispatch(actionSelectDialog('page_size', null));
        break;
      case 'settings-settings':
        dispatch(actionSelectDialog('settings', null));
        break;
      case 'settings-colours':
        dispatch(actionSelectDialog('colours', null));
        break;
      // Help
      case 'help-discord':
        openExternalUrl('https://discord.gg/bdXnjhrSYQ');
        break;
      case 'help-help':
        dispatch(
          actionMenuBrowserOpen(
            'https://www.tinycad.net/Online/Home',
            'Help',
          ),
        );
        break;
      case 'help-about':
        dispatch(actionSelectDialog('about', null));
        break;
    }
  };
}

export function handleMenuCommandWithData(command: string, data: any) {
  return (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    switch (command) {
      case 'file-open-recent':
        // data contains { name: string, id: string }
        if (data?.id) {
          const now = Date.now();
          if (now - lastWindowLaunchTime < 1000) {
            return;
          }
          lastWindowLaunchTime = now;
          dispatch(fileOpen({ name: data.name, id: data.id } as CurrentFile) as any);
        }
        break;
    }
  };
}
