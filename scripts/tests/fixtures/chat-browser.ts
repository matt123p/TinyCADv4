import { store } from '../../../src/startup';
import { createEditorTools } from '../../../src/chat/tools';
import { ioXML } from '../../../src/io/ioXml';
import {
  actionSetDocument,
  actionEditLibrary,
} from '../../../src/state/dispatcher/AppDispatcher';
import { XMLBuilder } from '../../../src/util/xmlbuilder';
import { ActionCreators } from 'redux-undo';
import { nativeCall } from '../../../src/chat/native-client';
import { readAttachments } from '../../../src/chat/attachments';
const downloads: unknown[] = [];
const execute = createEditorTools(store, (file) => {
  downloads.push({
    name: file.name,
    bytes: file.blob.size,
    type: file.blob.type,
  });
});
(window as any).chatTest = {
  execute(name: string, args: Record<string, unknown>) {
    return execute(name, args, new AbortController().signal);
  },
  native(name: string, args: Record<string, unknown>) {
    return nativeCall(name, args, new AbortController().signal);
  },
  openLibrary(definition: string) {
    const library = {
      fileId: null,
      modified: '',
      name: 'User library',
      names: [
        {
          NameID: 1,
          SymbolID: 1,
          Name: 'Existing',
          Reference: 'U?',
          ppp: 1,
          Description: 'Preserve me',
          ShowName: 0,
          ShowRef: 0,
          Attributes: [],
        },
      ],
      symbols: [{ SymbolId: 1, Data: definition }],
    };
    store.dispatch(actionEditLibrary(library, 'User.TCLib', null, null));
    store.dispatch(ActionCreators.clearHistory());
  },
  library() {
    return store.getState().docStore.present.editLibrary;
  },
  snapshot() {
    const state = store.getState();
    return {
      xml: new ioXML()
        .to_dsn(state.docStore.present.drawing, true, true)
        .tostring(),
      version: state.docStore.present.drawingVersion,
      past: state.docStore.past.length,
      file: state.altStore.file,
    };
  },
  load(xml: string) {
    const b = new XMLBuilder();
    b.fromText(xml);
    store.dispatch(
      actionSetDocument(new ioXML().from_dsn(b), 'Circuit.dsn', null, null),
    );
  },
  async raceEdit() {
    const read = (
      await execute('read_drawing', {}, new AbortController().signal)
    ).data as any;
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deferred = createEditorTools(
      store,
      () => {},
      async (name, args, signal) => {
        if (name === 'validate_drawing') await gate;
        return nativeCall(name, args, signal);
      },
    );
    const original = await deferred(
      'read_drawing',
      {},
      new AbortController().signal,
    );
    const promise = deferred(
      'set_drawing',
      {
        baseRevision: (original.data as any).revision,
        definition: read.definition.replace(
          '<NAME>Main</NAME>',
          '<NAME>AI edit</NAME>',
        ),
      },
      new AbortController().signal,
    ).then(
      () => 'unexpectedly applied',
      (error) => error.message,
    );
    const b = new XMLBuilder();
    b.fromText(
      read.definition.replace('<NAME>Main</NAME>', '<NAME>User edit</NAME>'),
    );
    store.dispatch(
      actionSetDocument(new ioXML().from_dsn(b), 'User.dsn', null, null),
    );
    release();
    return promise;
  },
  undo() {
    store.dispatch(ActionCreators.undo());
  },
  redo() {
    store.dispatch(ActionCreators.redo());
  },
  downloads() {
    return downloads;
  },
  importPdf(bytes: number[], provider: any, pages: string) {
    return readAttachments(
      [
        new File([new Uint8Array(bytes)], 'circuit.pdf', {
          type: 'application/pdf',
        }),
      ],
      provider,
      pages,
    );
  },
};
