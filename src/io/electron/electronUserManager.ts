import { activateSchematicTab, openSchematicTabs, schematicFileTabKey } from '../../state/schematicTabs';
import type { docDrawing } from '../../state/undo/undo';
import { drawingMimeType } from '../../../shared/drawingFiles.js';
import { decodeDrawing } from '../dsnCodec';
import { Dispatch } from 'redux';
import { ActionCreators } from 'redux-undo';
import {
  normalizeTclibLoadError,
  tclib,
  tclibLibraryEntry,
  tclibLoadError,
  tclibSymbol,
} from '../../model/tclib';
import {
  actionEditLibrary,
  actionMenuSetRecentFileList,
  actionSetDocument,
  actionSelectDialog,
  actionSetFileData,
  actionUpdateConfig,
  actionSetLibraryData,
  actionSetLibraryList,
} from '../../state/dispatcher/AppDispatcher';
import { CurrentFile, UserConfig } from '../../state/stores/altStoreReducer';
import { XMLBuilder } from '../../util/xmlbuilder';
import { UserManager } from '../files';
import { ioXML } from '../ioXml';
import { normalizeUserConfig, sortLibrariesByConfig, NormalizedUserConfig } from '../libraryConfig';


export class ElectronUserManager implements UserManager {
  private unsubs: (() => void)[] = [];
  private currentConfig: NormalizedUserConfig = normalizeUserConfig(null);

  private createFailedLibrary(
    fileId: string,
    name: string,
    error: unknown,
  ): tclib {
    return {
      fileId,
      name,
      modified: null,
      bad: true,
      loadError: normalizeTclibLoadError(error),
      names: [] as tclibLibraryEntry[],
      symbols: [] as tclibSymbol[],
    };
  }

  private toModifiedString(lastModified?: Date | string): string {
    if (!lastModified) {
      return null;
    }
    if (lastModified instanceof Date) {
      return lastModified.toISOString();
    }
    const date = new Date(lastModified);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  public initialize(dispatch: Dispatch): Promise<void> {
    // Clear previous listeners
    this.unsubs.forEach((u) => u());
    this.unsubs = [];

    // Add the callbacks
    this.unsubs.push(
      window.electronAPI.fileLoaded((data) => {
        dispatch((async (dispatch: Dispatch, getState: () => docDrawing) => {
          try {
            const key = schematicFileTabKey({ id: data.id, name: data.name });
            if (openSchematicTabs(getState()).some((entry) => entry.key === key)) {
              dispatch(activateSchematicTab(key));
            } else {
              const doc = await decodeDrawing(data.content);
              dispatch(actionSetDocument(doc, data.name, data.id, data.id));
              dispatch(ActionCreators.clearHistory());
            }
          } catch (error) {
            dispatch(actionSelectDialog('io_failure', { message: String(error) }));
          }
        }) as any);
      }),
    );

    this.unsubs.push(
      window.electronAPI.recentFiles((files) => {
        dispatch(actionMenuSetRecentFileList(files));
      }),
    );

    this.unsubs.push(
      window.electronAPI.libraryLoaded((library) => {
        dispatch(actionSetLibraryData({ ...library, bad: false, loadError: undefined }));
      }),
    );

    this.unsubs.push(
      window.electronAPI.libraryLoadFailed((data) => {
        dispatch(actionSetLibraryData(this.createFailedLibrary(data.id, data.name, data.error)));
      }),
    );

    this.unsubs.push(
      window.electronAPI.libraries((data) => {
        const config = normalizeUserConfig({
          fileId: this.currentConfig.fileId,
          libraries: data.libraries.map((library) => ({
            id: library.id,
            name: library.name,
            folderId: library.folderId,
          })),
          libraryFolders: data.libraryFolders,
        });
        this.currentConfig = config;
        dispatch(actionUpdateConfig(config));

        const libraries: tclib[] = data.libraries.map((l) => ({
          fileId: l.id,
          name: l.name,
          modified: this.toModifiedString(l.lastModified),
          bad: !!l.bad,
          loadError: l.error
            ? normalizeTclibLoadError(l.error)
            : undefined,
          names: [] as tclibLibraryEntry[],
          symbols: [] as tclibSymbol[],
        }));
        dispatch(actionSetLibraryList(sortLibrariesByConfig(libraries, config)));
        for (const lib of libraries) {
          if (!lib.bad) {
            this.loadLibrary(lib.fileId as string, lib.name, lib.modified, true).then(
              () => {
                ;
              },
            );
          }
        }
      }),
    );


    // Check URL parameters for startup actions
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for explicit action
    const action = urlParams.get('action');
    if (action === 'new-library') {
      const newLib = this.newLibrary();
      dispatch(actionEditLibrary(newLib, newLib.name, null, null));
      return Promise.resolve();
    }
    
    // Check for library to open
    const libraryPath = urlParams.get('library');
    if (libraryPath) {
      return new Promise<void>((resolve) => {
        const loaded = window.electronAPI.libraryLoaded((library) => {
          if (library.fileId !== libraryPath) return;
          loaded();
          failed();
          dispatch(actionEditLibrary(library, library.name, library.fileId, null));
          resolve();
        });
        const failed = window.electronAPI.libraryLoadFailed((data) => {
          if (data.id !== libraryPath) return;
          loaded();
          failed();
          dispatch(actionSelectDialog('io_failure', { message: data.error.summary }));
          resolve();
        });
        window.electronAPI.loadLibrary({ id: libraryPath, silent: true, allowEmpty: true });
      });
    }

    // Check for file to open
    const filePath = urlParams.get('file');
    if (filePath) {
        window.electronAPI.loadFile({
            name: filePath,
            id: filePath,
        });
        return Promise.resolve();
    }

    // Create a new file
    dispatch(actionSetFileData('tCad1.dsn', null, null, 0));
    return Promise.resolve();
  }

  public login(): Promise<void> {
    return Promise.resolve();
  }

  public fileOpen(dispatch: Dispatch, file?: CurrentFile) {
    window.electronAPI.loadFile({
      name: file?.name,
      id: file?.id as string,
    });
  }

  loadFileMetadata(fileId: string) {
    return Promise.resolve(null);
  }

  saveFile(xml: string | Uint8Array, file: CurrentFile): Promise<any> {

    return new Promise((resolve, reject) => {

      // Hook the callback
      const unsubscribe = window.electronAPI.fileSaved((data) => {

        // Unhook on callback
        unsubscribe();

        if (data.success) {
          // Now resolve the promise
          resolve({
            name: data.name,
            id: data.id,
            folderId: data.id,
            mimeType: drawingMimeType(xml),
          });
        } else {
          reject();
        }
      });

      window.electronAPI.saveFile({
        name: file.name,
        id: file.id,
        folderId: file.folderId,
        content: xml,
      });
    });
  }

  saveFileArrayBuffer(data: ArrayBuffer, file: CurrentFile): Promise<any> {
    return new Promise((resolve, reject) => {

      // Hook the callback
      const unsubscribe = window.electronAPI.librarySaved((data) => {

        // Unhook on callback
        unsubscribe();

        if (data.success) {
          // Now resolve the promise
          resolve({
            name: data.name,
            id: data.id,
            folderId: data.id,
            mimeType: 'application/xml',
          });
        } else {
          reject();
        }
      });

      window.electronAPI.saveLibrary({
        name: file.name,
        id: file.id,
        folderId: file.folderId,
        content: data,
      });
    });
  }

  renameFile(title: string, fileId: string): Promise<boolean> {
    return Promise.resolve(null);
  }

  loadLibrary(
    fileId: string,
    name: string,
    modified: string,
    silent = false,
  ): Promise<tclib> {

    window.electronAPI.loadLibrary({
      name: name,
      id: fileId + '',
      silent,
    });

    return Promise.resolve(null);
  }

  newLibrary(): tclib {
    return {
      fileId: null,
      modified: null,
      name: 'Library1.tclib',
      names: [],
      symbols: [],
    };
  }

  saveLibrary(lib: tclib, file: CurrentFile): Promise<any> {
    return import('../tclib').then((module) =>
      module
        .saveTcLibrary(lib)
        .then((data) => this.saveFileArrayBuffer(data, file)),
    );
  }

  saveConfig(config: UserConfig): Promise<void> {
    this.currentConfig = normalizeUserConfig(config);
    window.electronAPI.saveLibraryConfig({
      ...this.currentConfig,
      libraries: this.currentConfig.libraries.flatMap(library =>
        typeof library.id === 'string' ? [{ ...library, id: library.id }] : []),
    });
    return Promise.resolve();
  }

  loadConfig(): Promise<UserConfig> {
    return Promise.resolve(this.currentConfig);
  }

  public updateConfig(
    callback: (config: UserConfig) => UserConfig,
  ): Promise<void> {
    return this.loadConfig().then((config) => {
      const updatedConfig = callback(config);
      if (updatedConfig != config) {
        return this.saveConfig(updatedConfig);
      } else {
        return Promise.resolve();
      }
    });
  }
}
