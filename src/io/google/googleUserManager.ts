import { Dispatch } from 'redux';
import { ActionCreators } from 'redux-undo';
import { tclib } from '../../model/tclib';
import {
  actionEditLibrary,
  actionSetDocument,
  actionSetFileData,
  userLoginLoginError,
  userLoginOK,
} from '../../state/dispatcher/AppDispatcher';
import {
  CurrentFile,
  CurrentUser,
  UserConfig,
} from '../../state/stores/altStoreReducer';
import { XMLBuilder } from '../../util/xmlbuilder';
import { logWebUser, UserManager } from '../files';
import { ioXML } from '../ioXml';
import update from 'immutability-helper';

// The Browser API Key obtained from the Google API Console.
const getGoogleClientId = () => {
  const envId =
    process.env.NODE_ENV === 'development'
      ? process.env.GOOGLE_CLIENT_ID_DEV
      : process.env.GOOGLE_CLIENT_ID_PROD;

  if (!envId) {
    throw new Error(
      'Missing Google client ID. Set GOOGLE_CLIENT_ID_DEV/GOOGLE_CLIENT_ID_PROD in your secrets file.',
    );
  }

  return envId;
};

export class GoogleUserManager implements UserManager {
  // Scope to use to access user's Drive items.
  public scope = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.install',
    'https://www.googleapis.com/auth/drive.appdata',
  ];

  public initialize(dispatch: Dispatch): Promise<void> {
    return this.signin(dispatch).then(
      () => {
        this.loadFileOrNew(dispatch);
      },
      () => {
        dispatch(
          userLoginLoginError(
            'Cannot load Google API - Turn off any Ad Blockers',
          ),
        );
      },
    );
  }

  public login() {
    return Promise.resolve();
  }

  public fileOpen() {}

  // Sign in the user to Google and make sure they are correctly
  // authorized.
  private signin(dispatch: Dispatch) {
    return new Promise<void>((resolve, reject) => {
      if (!window.gapi?.load) {
        // Failed to load Google API
        reject();
      }

      window.gapi.load('auth2', () => {
        gapi.auth2
          .init({
            client_id: getGoogleClientId(),
            scope: this.scope.join(' '),
          })
          .then(() => {
            const auth2 = gapi.auth2.getAuthInstance();
            return auth2.signIn();
          })
          .then(
            () => {
              const user = this.getUser();
              dispatch(userLoginOK(user));
              logWebUser({
                provider: 'google',
                email: user.email,
                displayName: user.name,
              });
              resolve();
            },
            (error: any) => {
              const user = this.getUser();
              if (user) {
                dispatch(userLoginOK(user));
                logWebUser({
                  provider: 'google',
                  email: user.email,
                  displayName: user.name,
                });
                resolve();
              } else {
                reject();
              }
            },
          );
      });
    });
  }

  private getUser() {
    const auth2 = gapi.auth2?.getAuthInstance();
    const profile = auth2?.currentUser?.get().getBasicProfile();
    if (profile) {
      return {
        id: profile.getId(),
        name: profile.getName(),
        imageUrl: profile.getImageUrl(),
        email: profile.getEmail(),
      } as CurrentUser;
    }

    return null;
  }

  // Load the file from Google
  private loadFileOrNew(dispatch: Dispatch) {
    // Is there a file URL?
    const urlParams = new URLSearchParams(window.location.search);
    const stateParam = urlParams.get('state');
    if (stateParam) {
      const state = JSON.parse(stateParam);

      // Tidy up the URL
      // window.history.replaceState(null, '', window.location.href.split('?')[0]);

      // Determine the action
      // console.log(state);

      switch (state.action) {
        case 'open':
          this.loadFileMetadata(state.ids[0]).then((meta) => {
            if (meta.title.endsWith('.tclib')) {
              this.loadLibrary(
                state.ids[0],
                meta.title,
                meta.modifiedTime,
              ).then((lib) => {
                this.updateConfig((config) => {
                  if (!config.libraries.find((l) => l.id === lib.fileId)) {
                    config = update(config, {
                      libraries: {
                        $push: [
                          {
                            id: lib.fileId,
                            name: lib.name,
                          },
                        ],
                      },
                    });
                  }
                  return config;
                });
                dispatch(actionEditLibrary(lib, meta.title, meta.id, null));
              });
            } else {
              return this.loadFileText(state.ids[0]).then((file) => {
                const io = new ioXML();
                const xmlBuilder = new XMLBuilder();
                xmlBuilder.fromText(file);
                const doc = io.from_dsn(xmlBuilder);
                dispatch(actionSetDocument(doc, meta.title, meta.id, null));
                dispatch(ActionCreators.clearHistory());
              });
            }
          });
          return;
        case 'create':
          dispatch(actionSetFileData('tCad1.dsn', null, state.folderId, 0));
          return;
        case 'newlib':
          const lib = this.newLibrary();
          dispatch(actionEditLibrary(lib, lib.name, null, null));
          return;
      }
    }

    // Create a new file
    dispatch(actionSetFileData('tCad1.dsn', null, null, 0));
  }

  private getToken() {
    return gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse(true)
      .access_token;
  }

  loadFileMetadata(fileId: string) {
    return fetch(`https://www.googleapis.com/drive/v2/files/${fileId}`, {
      headers: new Headers({
        Authorization: `Bearer ${this.getToken()}`,
      }),
    }).then((response) => response.json());
  }

  loadFileText(fileId: string) {
    if (!fileId) {
      return Promise.resolve(null);
    }
    return (
      // now load the file's actual contents
      fetch(`https://www.googleapis.com/drive/v2/files/${fileId}?alt=media`, {
        headers: new Headers({
          Authorization: `Bearer ${this.getToken()}`,
        }),
      }).then((response) => response.text())
    );
  }

  loadFileArrayBuffer(fileId: string) {
    return Promise.all(
      // Load the metadata
      [
        fetch(`https://www.googleapis.com/drive/v2/files/${fileId}`, {
          headers: new Headers({
            Authorization: `Bearer ${this.getToken()}`,
          }),
        }).then((response) => response.json()),

        // now load the file's actual contents
        fetch(`https://www.googleapis.com/drive/v2/files/${fileId}?alt=media`, {
          headers: new Headers({
            Authorization: `Bearer ${this.getToken()}`,
          }),
        }).then((response) => response.arrayBuffer()),
      ],
    );
  }

  saveFile(xml: string, file: CurrentFile): Promise<any> {
    return this.saveFileInternal(xml, file, 'application/xml');
  }

  private saveFileInternal(
    xml: string,
    file: CurrentFile,
    mimeType: string,
  ): Promise<any> {
    // Does this file already exist?
    if (!file?.id) {
      // Create a new file
      const headers = new Headers();
      headers.append('Authorization', `Bearer ${this.getToken()}`);
      headers.append('Content-Type', 'application/json');

      const meta = {
        name: file.name,
        mimeType: mimeType,
        parents: file?.folderId ? [file?.folderId] : undefined,
      };

      return fetch(`https://www.googleapis.com/drive/v3/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify(meta),
      })
        .then((r) => r.json())
        .then((response) => {
          if (response.id) {
            return this.saveFileInternal(
              xml,
              {
                name: file.name,
                id: response.id,
                folderId: file.folderId,
              },
              mimeType,
            );
          } else {
            return null;
          }
        });
    }

    const headers = new Headers();
    headers.append('Authorization', `Bearer ${this.getToken()}`);
    headers.append('Content-Type', mimeType);
    headers.append('Content-Length', xml.length.toString());

    return fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers,
        body: xml,
      },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          throw data.message;
        }

        return data;
      });
  }

  saveFileArrayBuffer(data: ArrayBuffer, file: CurrentFile): Promise<any> {
    // Does this file already exist?
    if (!file?.id) {
      // Create a new file
      const title = file.name.split('.')[0];
      const headers = new Headers();
      headers.append('Authorization', `Bearer ${this.getToken()}`);
      headers.append('Content-Type', 'application/json');

      const meta = {
        title: title,
        name: file.name,
        mimeType: 'application/octet-stream',
        parents: file?.folderId ? [file?.folderId] : undefined,
      };

      return fetch(`https://www.googleapis.com/drive/v3/files`, {
        method: 'POST',
        headers,
        body: JSON.stringify(meta),
      })
        .then((r) => r.json())
        .then((response) => {
          if (response.id) {
            return this.saveFileArrayBuffer(data, {
              name: file.name,
              id: response.id,
              folderId: file.folderId,
            });
          } else {
            return null;
          }
        });
    }

    const headers = new Headers();
    headers.append('Authorization', `Bearer ${this.getToken()}`);
    headers.append('Content-Type', 'application/octet-stream');
    headers.append('Content-Length', data.byteLength.toString());

    return fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`,
      {
        method: 'PATCH',
        headers,
        body: data,
      },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          throw data.message;
        }

        return data;
      });
  }

  renameFile(title: string, fileId: string): Promise<boolean> {
    if (fileId) {
      const update = {
        name: title,
      };

      return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'PATCH',
        headers: new Headers({
          Authorization: `Bearer ${this.getToken()}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(update),
      }).then((response) => response.status === 200);
    } else {
      return Promise.resolve(true);
    }
  }

  loadLibrary(fileId: string, name: string, modified: string): Promise<tclib> {
    return this.loadFileArrayBuffer(fileId).then((r) =>
      import('../tclib').then((module) =>
        module.loadTcLibrary(fileId, name, modified, r[1]),
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
    return this.saveFileInternal(
      JSON.stringify(config),
      {
        name: 'config.json',
        folderId: 'appDataFolder',
        id: config.fileId,
      },
      'application/json',
    );
  }

  loadConfig(): Promise<UserConfig> {
    const query = new URLSearchParams();
    query.append(
      'q',
      "name = 'config.json' and mimeType = 'application/json' and trashed = false",
    );
    query.append('fields', 'files(id, kind, name, modifiedTime)');
    query.append('spaces', 'appDataFolder');

    return fetch(
      `https://www.googleapis.com/drive/v3/files?${query.toString()}`,
      {
        method: 'GET',
        headers: new Headers({
          Authorization: `Bearer ${this.getToken()}`,
        }),
      },
    )
      .then((response) => (response.status === 200 ? response.json() : null))
      .then((json) => {
        if (json?.files.length > 0) {
          return this.loadFileText(json?.files[0].id).then((config) => {
            return { ...JSON.parse(config), fileId: json?.files[0].id };
          });
        } else {
          return {
            fileId: null,
            libraries: [],
          };
        }
      });
  }

  public updateConfig(
    callback: (config: UserConfig) => UserConfig,
  ): Promise<void> {
    return this.loadConfig().then((config) => {
      const updatedConfig = callback(config);
      if (updatedConfig != config) {
        return this.saveConfig(callback(updatedConfig));
      } else {
        return Promise.resolve();
      }
    });
  }
}
