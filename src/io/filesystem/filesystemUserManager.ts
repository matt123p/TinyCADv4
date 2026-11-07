import { drawingFileName, isCompressedDrawing, isDrawingFile, drawingMimeType } from '../../../shared/drawingFiles.js';
import { decodeDrawing } from '../dsnCodec';
import { Dispatch } from 'redux';
import { ActionCreators } from 'redux-undo';
import { tclib } from '../../model/tclib';
import {
  actionEditLibrary,
  actionSetDocument,
  actionSelectDialog,
  actionSetFileData,
  browserError,
  userLoginLoginError,
  userLoginOK,
} from '../../state/dispatcher/AppDispatcher';
import { CurrentFile, UserConfig } from '../../state/stores/altStoreReducer';
import { XMLBuilder } from '../../util/xmlbuilder';
import { UserManager, FileIdType } from '../files';
import { ioXML } from '../ioXml';
import update from 'immutability-helper';

export class FileSystemUserManager implements UserManager {
  // Scope to use to access user's Drive items.
  public scope: string[] = [];

  private loadFileOrNew(dispatch: Dispatch): void {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (action === 'new-library') {
      const lib = this.newLibrary();
      dispatch(actionEditLibrary(lib, lib.name, null, null));
      return;
    }

    const stateParam = urlParams.get('state');
    if (stateParam) {
      try {
        const state = JSON.parse(stateParam);

        switch (state?.action) {
          case 'newlib': {
            const lib = this.newLibrary();
            dispatch(actionEditLibrary(lib, lib.name, null, null));
            return;
          }
          case 'create':
            break;
        }
      } catch {
        // Ignore malformed state and fall back to a new schematic.
      }
    }

    dispatch(actionSetFileData('tCad1.dsn', null, null, 0));
  }

  public initialize(dispatch: Dispatch): Promise<void> {
    // Does this browser support the File System?
    if (!window.showOpenFilePicker || !window.showSaveFilePicker) {
      dispatch(browserError());
      return;
    }

    // Create a new file
    dispatch(
      userLoginOK({
        email: null,
        id: null,
        name: null,
        imageUrl: null,
      }),
    );
    this.loadFileOrNew(dispatch);
    return Promise.resolve();
  }

  public login() {
    return Promise.resolve();
  }

  public fileOpen(dispatch: Dispatch) {
    const pickerOpts = {
      types: [
        {
          description: 'TinyCAD drawings',
          accept: {
            'application/octet-stream': ['.dsn', '.dzn'],
          },
        },
        {
          description: 'TinyCAD libraries',
          accept: {
            'application/binary': ['.tclib'],
          },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: false,
    };
    // open file picker
    window
      .showOpenFilePicker(pickerOpts)
      .then((files: FileSystemFileHandle[]) => {
        if (files.length > 0) {
          return files[0].getFile().then((file: File) => {
            if (isDrawingFile(file.name)) {
              return file.arrayBuffer().then(decodeDrawing).then((doc) => {
                dispatch(actionSetDocument(doc, file.name, files[0], null));
                dispatch(ActionCreators.clearHistory());
              });
            } else if (file.name.toLowerCase().indexOf('.tclib') !== -1) {
              this.loadLibrary(
                files[0],
                file.name,
                file.lastModified.toString(),
              ).then((lib) => {
                this.updateConfig((config) => {
                  if (!config.libraries.find((l) => l.id === lib.fileId)) {
                    config = update(config, {
                      libraries: {
                        $push: [
                          {
                            id: lib.fileId,
                            name: lib.name,
                            folderId: null,
                          },
                        ],
                      },
                    });
                  }
                  return config;
                });
                dispatch(actionEditLibrary(lib, file.name, files[0], null));
              });
            }
          });
        }
      }).catch(error => { if (error?.name !== 'AbortError') dispatch(actionSelectDialog('io_failure',{message:String(error)})); });
  }

  loadFileMetadata(fileId: FileIdType) {
    return Promise.resolve(null);
  }

  async saveFile(xml: string | Uint8Array, file: CurrentFile): Promise<any> {
    const compressed = isCompressedDrawing(xml);
    const name = drawingFileName(file.name, compressed);
    let handle = file.id as FileSystemFileHandle;
    // A file handle cannot be renamed portably. On a format change save a new
    // sibling through the picker, keeping the original file until save succeeds.
    if (!handle || handle.name !== name) {
      handle = await window.showSaveFilePicker({
        types: [{description: compressed ? 'TinyCAD compressed drawings' : 'TinyCAD drawings',accept:{'application/octet-stream':[compressed ? '.dzn' : '.dsn']}}],
        suggestedName:name,excludeAcceptAllOption:true,
      });
    }
    const writable = await handle.createWritable();
    try { await writable.write(xml); await writable.close(); }
    catch(error) { await writable.abort().catch(()=>{}); throw error; }
    return {name:handle.name,id:handle,mimeType:drawingMimeType(xml)};
  }

  saveFileArrayBuffer(data: ArrayBuffer, file: CurrentFile): Promise<any> {
    if (file.id) {
      const fsFile = file.id as FileSystemFileHandle;
      return fsFile
        .createWritable()
        .then((writable: FileSystemWritableFileStream) => {
          return writable.write(data).then(() => writable.close());
        })
        .then(() => {
          const meta = {
            name: file.name,
            id: file.id,
            mimeType: 'application/binary',
          };
          return meta;
        });
    } else {
      const pickerOpts = {
        types: [
          {
            description: 'TinyCAD libraries',
            accept: {
              'application/binary': ['.tclib'],
            },
          },
        ],
        suggestedName: file.name,
        excludeAcceptAllOption: true,
      };
      return window
        .showSaveFilePicker(pickerOpts)
        .then((file: FileSystemFileHandle) => {
          if (file) {
            return this.saveFileArrayBuffer(data, {
              name: file.name,
              id: file,
              folderId: null,
            });
          }
        });
    }
  }

  renameFile(title: string, fileId: FileIdType): Promise<boolean> {
    return Promise.resolve(null);
  }

  loadLibrary(
    fileId: FileIdType,
    name: string,
    modified: string,
  ): Promise<tclib> {
    const handle = fileId as FileSystemFileHandle;
    return handle
      .getFile()
      .then((file) => file.arrayBuffer()) 

      .then((r) =>
        import('../tclib').then((module) =>
          module.loadTcLibrary(fileId, name, modified, r),
        ),
      );
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
    return Promise.resolve();
  }

  loadConfig(): Promise<UserConfig> {
    return Promise.resolve({
      fileId: null,
      libraries: [],
      libraryFolders: [],
    });
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
