import type { Dispatch } from 'redux';
import { ActionCreators } from 'redux-undo';
import type { docDrawing } from '../state/undo/undo';
import type { dsnDrawing } from '../model/dsnDrawing';
import type {
  BundledExample,
  ExampleCatalog,
  ExampleContent,
} from '../../shared/bundledExamples';
import {
  exampleImageExtensions,
  exampleMediaExtensions,
  examplePath,
  exampleResourcePaths,
  parseExampleCatalog,
} from '../../shared/bundledExamples';
import {
  actionCancelDialog,
  actionSelectDialog,
  actionSetDocument,
  actionSetFileData,
} from '../state/dispatcher/AppDispatcher';
import { ioXML } from './ioXml';
import { decodeDrawing } from './dsnCodec';
import { XMLBuilder } from '../util/xmlbuilder';

interface ExampleSource {
  catalog(): Promise<unknown>;
  read(path: string, signal?: AbortSignal): Promise<Uint8Array>;
}

function resourceURL(path: string) {
  return new URL(
    'bundled-examples/' + path.split('/').map(encodeURIComponent).join('/'),
    document.baseURI,
  ).href;
}

async function fetchResource(path: string, signal?: AbortSignal) {
  const response = await fetch(resourceURL(path), {
    signal,
    credentials: 'same-origin',
  });
  if (!response.ok)
    throw new Error(
      `Unable to load example resource (${response.status}): ${path}`,
    );
  return response;
}

const source: ExampleSource = {
  async catalog() {
    if (window.electronAPI?.exampleCatalog)
      return window.electronAPI.exampleCatalog();
    return (await fetchResource('config.json')).json();
  },
  async read(path, signal) {
    if (window.electronAPI?.readExampleResource)
      return window.electronAPI.readExampleResource(path);
    return new Uint8Array(
      await (await fetchResource(path, signal)).arrayBuffer(),
    );
  },
};

export interface ExampleImage {
  url: string;
  dispose(): void;
}

export class ExampleResources {
  private catalogPromise: Promise<ExampleCatalog> | null = null;
  constructor(private source: ExampleSource) {}
  catalog(): Promise<ExampleCatalog> {
    if (!this.catalogPromise)
      this.catalogPromise = this.source
        .catalog()
        .then(parseExampleCatalog)
        .catch((error) => {
          this.catalogPromise = null;
          throw error;
        });
    return this.catalogPromise;
  }
  async read(path: string, signal?: AbortSignal) {
    const catalog = await this.catalog();
    if (!exampleResourcePaths(catalog).has(path))
      throw new Error('Unknown example resource.');
    if (signal?.aborted) throw new Error('Example request cancelled.');
    const bytes = await this.source.read(path, signal);
    if (signal?.aborted) throw new Error('Example request cancelled.');
    return bytes;
  }
  async description(item: ExampleContent, signal?: AbortSignal) {
    return (
      item.description ??
      new TextDecoder().decode(await this.read(item.descriptionPath!, signal))
    );
  }
  async image(path: string, signal?: AbortSignal): Promise<ExampleImage> {
    examplePath(path, exampleImageExtensions);
    return this.media(path, signal);
  }
  async media(path: string, signal?: AbortSignal): Promise<ExampleImage> {
    examplePath(path, exampleMediaExtensions);
    const bytes = await this.read(path, signal);
    const extension = path.split('.').pop()!.toLowerCase();
    const mime = ['mp4', 'webm'].includes(extension)
      ? 'video/' + extension
      : extension === 'svg'
      ? 'image/svg+xml'
      : ['jpg', 'jpeg'].includes(extension)
      ? 'image/jpeg'
      : 'image/' + extension;
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: mime }),
    );
    return { url, dispose: () => URL.revokeObjectURL(url) };
  }
  async drawing(groupId: string, exampleId: string, signal?: AbortSignal) {
    const catalog = await this.catalog();
    const example = catalog.groups
      .find((group) => group.id === groupId)
      ?.examples.find((example) => example.id === exampleId);
    if (!example) throw new Error('Unknown example drawing.');
    const bytes = await this.read(example.path, signal);
    const drawing = example.path.toLowerCase().endsWith('.dzn')
      ? await decodeDrawing(bytes)
      : parseExampleDrawing(new TextDecoder().decode(bytes));
    if (!drawing.sheets.length)
      throw new Error('The example drawing has no sheets.');
    return { example, document: drawing };
  }
}

export function parseExampleDrawing(text: string): dsnDrawing {
  const parsed = new DOMParser().parseFromString(text, 'application/xml');
  if (
    parsed.getElementsByTagName('parsererror').length ||
    !['TinyCAD', 'TinyCADSheets'].includes(parsed.documentElement?.nodeName)
  ) {
    throw new Error('The example is not a valid TinyCAD drawing.');
  }
  const xml = new XMLBuilder();
  xml.fromText(text);
  const document = new ioXML().from_dsn(xml);
  if (!document.sheets.length)
    throw new Error('The example drawing has no sheets.');
  return document;
}

export const exampleResources = new ExampleResources(source);

export interface PreparedExample {
  type: 'file-open-example';
  document: dsnDrawing;
  filename: string;
  groupId: string;
  exampleId: string;
  content: ExampleContent;
}

export function commitExample(dispatch: Dispatch, example: PreparedExample) {
  dispatch(actionCancelDialog());
  // No source path/handle is attached: Save always creates the user's own copy.
  dispatch(actionSetDocument(example.document, example.filename, null, null));
  dispatch(actionSetFileData(example.filename, null, null, 0));
  dispatch({ type: 'example/loaded', item: example.content });
  dispatch(ActionCreators.clearHistory());
}

export function openExample(
  groupId: string,
  exampleId: string,
  signal?: AbortSignal,
) {
  return async (dispatch: Dispatch, getState: () => docDrawing) => {
    // Validate the selected drawing before asking to replace an unsaved document.
    const { example, document } = await exampleResources.drawing(
      groupId,
      exampleId,
      signal,
    );
    if (signal?.aborted || getState().altStore.show_dialogue !== 'open_example')
      return;
    const pendingAction: PreparedExample = {
      type: 'file-open-example',
      document,
      filename: example.path.split('/').pop()!,
      groupId,
      exampleId,
      content: example,
    };
    const state = getState();
    if (state.docStore.present.drawingVersion !== state.altStore.savedVersion) {
      dispatch(actionSelectDialog('unsaved_changes', { pendingAction }));
    } else commitExample(dispatch, pendingAction);
  };
}
