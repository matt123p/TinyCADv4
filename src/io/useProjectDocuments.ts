import { useCallback, useRef, useState } from 'react';
import { isProjectFile } from '../../shared/projectFiles';
import type { ProjectSettings } from '../pcb/projectSettings';
import type { ProjectMetadata } from './projects';
import { projectDocumentKind } from './projectDocumentKind';
import type { ProjectDocumentKind } from './projectDocumentKind';
import { projectFilesChanged } from './projectStorage';
import type { ProjectLocation } from './projectStorage';

const loadProjects =
  process.env.TARGET_SYSTEM === 'electron' ||
  process.env.TARGET_SYSTEM === 'google'
    ? () => import('./projects')
    : undefined;

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
type Settings = {
  kind: 'settings';
  settings: ProjectSettings;
  saved: ProjectMetadata;
  value: ProjectMetadata;
};
export type ProjectDocument = ProjectDocumentLocation & {
  version: string;
  mime: string;
} & (Text | Asset | Settings);
export type SaveSummary = {
  saved: string[];
  failed: { name: string; message: string }[];
};
export const dirtyProjectDocument = (file: ProjectDocument) =>
  file.kind === 'text'
    ? file.value !== file.saved
    : file.kind === 'settings' &&
      (file.value.title !== file.saved.title ||
        file.value.author !== file.saved.author ||
        file.value.primarySchematic !== file.saved.primarySchematic ||
        file.value.primaryBoard !== file.saved.primaryBoard);

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
  if (!loadProjects) throw new Error('Project documents are unavailable.');
  const { projectRequest, readProject, projectMetadata } = await loadProjects();
  if (isProjectFile(location.name)) {
    const project = await readProject(location.id, location.folder);
    const value = projectMetadata(project.settings);
    return {
      ...location,
      version: project.version,
      mime: 'application/xml',
      kind: 'settings',
      settings: project.settings,
      saved: value,
      value,
    };
  }
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
    if (!loadProjects) return;
    if (!current.current.some(({ id }) => id === location.id)) {
      const epoch = ++openEpoch.current;
      const opened = await readDocument(location);
      if (epoch !== openEpoch.current) return;
      update((files) =>
        files.some(({ id }) => id === opened.id) ? files : [...files, opened],
      );
    }
    select(location.id);
  }

  function edit(id: string, value: string) {
    update((files) =>
      files.map((file) =>
        file.id === id && file.kind === 'text' ? { ...file, value } : file,
      ),
    );
  }

  function editSettings(id: string, key: keyof ProjectMetadata, value: string) {
    update((files) =>
      files.map((file) =>
        file.id === id && file.kind === 'settings'
          ? { ...file, value: { ...file.value, [key]: value } }
          : file,
      ),
    );
  }

  async function save(id: string) {
    if (!loadProjects) return;
    if (pending.current.has(id))
      throw new Error('A save is already in progress.');
    const file = current.current.find((file) => file.id === id);
    if (!file || !dirtyProjectDocument(file)) return;
    pending.current.add(id);
    setWriting(new Set(pending.current));
    try {
      const { projectRequest, saveProjectMetadata } = await loadProjects();
      if (file.kind === 'settings') {
        const saved = await saveProjectMetadata(
          file.id,
          file.folder,
          file.name,
          file.version,
          file.settings,
          file.value,
        );
        update((files) =>
          files.map((item) =>
            item.id === id && item.kind === 'settings'
              ? {
                  ...item,
                  settings: saved.settings,
                  version: saved.version,
                  saved: saved.value,
                  value: item.value === file.value ? saved.value : item.value,
                }
              : item,
          ),
        );
      } else if (file.kind === 'text') {
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
      }
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
    editSettings,
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
