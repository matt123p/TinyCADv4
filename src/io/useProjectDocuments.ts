import { useCallback, useRef, useState } from 'react';
import { projectDocumentKind } from './projectDocumentKind';
import type { ProjectDocumentKind } from './projectDocumentKind';
import { projectFilesChanged } from './projectStorage';
import type { ProjectLocation } from './projectStorage';

import { projectRequest } from './projects';

export type ProjectDocumentLocation = ProjectLocation & {
  folder: string;
  ancestors: readonly string[];
};
type Text = {
  kind: 'text';
  markdown: boolean;
  saved: string;
  value: string;
  crlf: boolean;
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
  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  const crlf =
    text.includes('\r\n') && !text.replaceAll('\r\n', '').includes('\n');
  const saved = text.replace(/\r\n?/g, '\n');
  return {
    ...base,
    kind: 'text',
    markdown: type.markdown,
    saved,
    value: saved,
    crlf,
    bom,
  };
}

async function readDocument(
  location: ProjectDocumentLocation,
): Promise<ProjectDocument> {
  const type = projectDocumentKind(location.name);
  if (!type)
    throw new Error('This file type is unavailable in the project editor.');
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
      const content =
        (file.bom ? '\ufeff' : '') +
        (file.crlf ? file.value.replaceAll('\n', '\r\n') : file.value);
      const { version } = await projectRequest({
        operation: 'write',
        id,
        folder: file.folder,
        name: file.name,
        version: file.version,
        data: new TextEncoder().encode(content),
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

  async function refresh(matches: (id: string) => boolean) {
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
  }

  function close(id: string) {
    if (pending.current.has(id)) return;
    update((files) => files.filter((file) => file.id !== id));
    if (active === id) select(current.current.at(-1)?.id);
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
    clear,
    hasDirty: () => current.current.some(dirtyProjectDocument),
    isProtected: (id: string) =>
      current.current.some(
        (file) => file.id === id || file.ancestors.includes(id),
      ),
  };
}
