import { useCallback, useRef, useState } from 'react';
import { projectDocumentKind } from './projectDocumentKind';
import type {
  ProjectDocumentKind,
  ProjectTextKind,
} from './projectDocumentKind';
import { projectFilesChanged } from './projectStorage';
import type { ProjectLocation } from './projectStorage';

import { projectRequest } from './projects';

export type ProjectDocumentLocation = ProjectLocation & {
  folder: string;
  ancestors: readonly string[];
};
type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';
type Text = ProjectTextKind & {
  encoding: TextEncoding;
  saved: string;
  value: string;
  newline: '\n' | '\r\n' | '\r';
  bom: boolean;
};
type Asset = { kind: 'image' | 'pdf'; bytes: Uint8Array };
export type ProjectDocument = ProjectDocumentLocation & {
  version: string;
  mime: string;
} & (Text | Asset);
export type SaveSummary = {
  saved: string[];
  failed: { name: string; message: string }[];
};
export const dirtyProjectDocument = (file: ProjectDocument) =>
  file.kind === 'text' && file.value !== file.saved;

function openDocument(
  location: ProjectDocumentLocation,
  type: ProjectDocumentKind,
  data: Uint8Array,
  version: string,
): ProjectDocument & (Text | Asset) {
  const base = { ...location, version, mime: type.mime };
  if (type.kind !== 'text') return { ...base, kind: type.kind, bytes: data };
  const encoding: TextEncoding =
    data[0] === 0xff && data[1] === 0xfe
      ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff
      ? 'utf-16be'
      : 'utf-8';
  const bom =
    encoding !== 'utf-8' ||
    (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf);
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    throw new Error('This file is not UTF-8 or UTF-16 text.');
  }
  if (/[\x00-\x08\x0e-\x1a]/.test(text))
    throw new Error(
      'This file contains binary data and cannot be opened as text.',
    );
  const newline = (/\r\n|\n|\r/.exec(text)?.[0] as Text['newline']) ?? '\n';
  const saved = text.replace(/\r\n?/g, '\n');
  return { ...base, ...type, encoding, bom, newline, saved, value: saved };
}

function encodeText(file: Text): Uint8Array {
  const text =
    (file.bom ? '\ufeff' : '') + file.value.replaceAll('\n', file.newline);
  if (file.encoding === 'utf-8') return new TextEncoder().encode(text);
  const view = new DataView(new ArrayBuffer(text.length * 2));
  for (let index = 0; index < text.length; index++)
    view.setUint16(
      index * 2,
      text.charCodeAt(index),
      file.encoding === 'utf-16le',
    );
  return new Uint8Array(view.buffer);
}

async function readDocument(
  location: ProjectDocumentLocation,
): Promise<ProjectDocument> {
  const type = projectDocumentKind(location.name);
  const { data, version } = await projectRequest({
    operation: 'read',
    id: location.id,
  });
  return openDocument(location, type, data, version);
}

export function useProjectDocuments() {
  const [files, setFiles] = useState<ProjectDocument[]>([]);
  const [active, setActive] = useState<string>();
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set());
  const current = useRef(files);
  const pending = useRef(new Set<string>());
  const openEpoch = useRef(0);
  const projectEpoch = useRef(0);

  const update = useCallback(
    (change: (files: ProjectDocument[]) => ProjectDocument[]) => {
      current.current = change(current.current);
      setFiles(current.current);
    },
    [],
  );

  const select = useCallback((id?: string) => {
    openEpoch.current++;
    setActive(id);
  }, []);

  async function open(location: ProjectDocumentLocation) {
    const epoch = ++openEpoch.current;
    const project = projectEpoch.current;
    if (!current.current.some(({ id }) => id === location.id)) {
      const opened = await readDocument(location);
      if (project !== projectEpoch.current) return;
      update((files) =>
        files.some(({ id }) => id === opened.id) ? files : [...files, opened],
      );
    }
    if (epoch === openEpoch.current) select(location.id);
  }

  function edit(id: string, value: string) {
    update((files) =>
      files.map((file) =>
        file.id === id && file.kind === 'text' ? { ...file, value } : file,
      ),
    );
  }

  async function save(id: string) {
    if (pending.current.has(id))
      throw new Error('A save is already in progress.');
    const file = current.current.find((file) => file.id === id);
    if (!file || file.kind !== 'text' || !dirtyProjectDocument(file)) return;
    pending.current.add(id);
    setWriting(new Set(pending.current));
    try {
      const { version } = await projectRequest({
        operation: 'write',
        id,
        folder: file.folder,
        name: file.name,
        version: file.version,
        data: encodeText(file),
        mediaType: file.mime,
      });
      update((files) =>
        files.map((item) =>
          item.id === id && item.kind === 'text'
            ? { ...item, version, saved: file.value }
            : item,
        ),
      );
      window.dispatchEvent(new Event(projectFilesChanged));
    } finally {
      pending.current.delete(id);
      setWriting(new Set(pending.current));
    }
  }

  async function saveAll(): Promise<SaveSummary> {
    const summary: SaveSummary = { saved: [], failed: [] };
    for (const item of current.current.filter(dirtyProjectDocument)) {
      try {
        await save(item.id);
        const latest = current.current.find(({ id }) => id === item.id);
        if (latest && dirtyProjectDocument(latest))
          throw new Error('New edits were made while saving.');
        summary.saved.push(item.name);
      } catch (error) {
        summary.failed.push({
          name: item.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summary;
  }

  const refresh = useCallback(async (matches: (id: string) => boolean) => {
    const unavailable: string[] = [];
    for (const file of current.current) {
      if (
        !matches(file.id) ||
        dirtyProjectDocument(file) ||
        pending.current.has(file.id)
      )
        continue;
      try {
        const { id, name, folder, ancestors } = file;
        const latest = await readDocument({ id, name, folder, ancestors });
        if (latest.version !== file.version)
          update((files) =>
            files.map((item) => (item === file ? latest : item)),
          );
      } catch {
        if (current.current.includes(file)) unavailable.push(file.name);
      }
    }
    return unavailable;
  }, [update]);

  function close(id: string) {
    if (pending.current.has(id)) return;
    update((files) => files.filter((file) => file.id !== id));
    if (active === id) select(current.current.at(-1)?.id);
  }

  function relocate(locations: Record<string, ProjectDocumentLocation>) {
    const selected = active && locations[active];
    update((files) =>
      files.map((file) => {
        const location = locations[file.id];
        if (!location) return file;
        const type = projectDocumentKind(location.name);
        return file.kind === 'text' && type.kind === 'text'
          ? {
              ...file,
              ...location,
              ...type,
              language: type.language,
              preview: type.preview,
            }
          : { ...file, ...location, mime: type.mime };
      }),
    );
    if (selected) select(selected.id);
  }

  function removeWhere(matches: (id: string) => boolean) {
    update((files) => files.filter((file) => !matches(file.id)));
    if (active && matches(active)) select(current.current.at(-1)?.id);
  }

  function clear() {
    projectEpoch.current++;
    select();
    update(() => []);
  }

  return {
    files,
    active,
    writing,
    select,
    open,
    edit,
    save,
    saveAll,
    refresh,
    close,
    relocate,
    removeWhere,
    clear,
    isSaving: () => pending.current.size > 0,
    hasDirty: (matches: (id: string) => boolean = () => true) =>
      current.current.some(
        (file) => matches(file.id) && dirtyProjectDocument(file),
      ),
  };
}
