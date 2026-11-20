import {
  MAX_PROJECT_FILE_BYTES,
  PROJECT_FILE_EXTENSION,
  isProjectFile,
  projectFileTitle,
  validProjectName,
} from '../../shared/projectFiles';

export interface ProjectLocation {
  id: string;
  name: string;
}

export interface ProjectItem extends ProjectLocation {
  folder: boolean;
  unsupported?: boolean;
}

export interface ProjectFile extends ProjectLocation {
  version: string;
}

export interface HierarchyFrame {
  entryId: string;
  sheetId: string;
  placementId: string;
  reference: string;
  name: string;
}

export interface OpenProjectDrawing extends ProjectFile {
  entryId: string;
  rootId: string;
  documentPath: string;
  hierarchyTrail?: readonly HierarchyFrame[];
  openSheetId?: string;
  openUnitId?: string;
  openPinId?: string;
  folderId: string;
}

export type ProjectStorageRequest =
  | { operation: 'root' }
  | { operation: 'choose'; containProject?: string }
  | { operation: 'list'; folder: string; tree?: boolean }
  | { operation: 'read' | 'fingerprint'; id: string }
  | { operation: 'copy'; id: string; folder: string; name: string }
  | { operation: 'mkdir'; folder: string; name: string }
  | { operation: 'trash'; id: string; directory: boolean }
  | {
      operation: 'rename' | 'move';
      id: string;
      from: string;
      folder: string;
      name: string;
      directory: boolean;
    }
  | {
      operation: 'write';
      folder: string;
      name: string;
      data: Uint8Array;
      id?: string;
      version?: string;
    };

export interface ProjectStorageResult {
  root: ProjectLocation;
  choose: ProjectLocation | null;
  list: ProjectItem[];
  read: { data: Uint8Array; version: string };
  mkdir: ProjectLocation;
  copy: void;
  fingerprint: string;
  trash: void;
  rename: ProjectLocation;
  move: ProjectLocation;
  write: ProjectFile;
}

const folderMime = 'application/vnd.google-apps.folder';
const shortcutMime = 'application/vnd.google-apps.shortcut';

export function projectFileName(name: string): string {
  const title = name.trim();
  if (!projectFileTitle(title).trim()) throw new Error('Enter a project name.');
  const filename = isProjectFile(title)
    ? title
    : title + PROJECT_FILE_EXTENSION;
  if (!validProjectName(filename)) throw new Error('Invalid project name.');
  return filename;
}

type DriveRequest = (
  resource: string,
  options?: RequestInit,
) => Promise<Response>;

async function readProjectBytes(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get('Content-Length'));
  if (length > MAX_PROJECT_FILE_BYTES)
    throw new Error('Project exceeds its file size limit.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PROJECT_FILE_BYTES)
        throw new Error('Project exceeds its file size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function driveProjectFiles(
  request: ProjectStorageRequest,
  drive: DriveRequest,
) {
  const file = (id: string) => `/files/${encodeURIComponent(id)}`;
  const json = (method: string, value: object) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if ('name' in request && !validProjectName(request.name))
    throw new Error('Invalid file or folder name.');
  switch (request.operation) {
    case 'root':
    case 'choose':
      return { id: 'root', name: 'My Drive' };
    case 'list': {
      const escaped = request.folder
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
      const query = new URLSearchParams({
        q: `'${escaped}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '1000',
      });
      const items: ProjectItem[] = [];
      do {
        const page = await (await drive(`/files?${query}`)).json();
        for (const { id, name, mimeType } of page.files) {
          if (request.tree || mimeType === folderMime || isProjectFile(name))
            items.push({
              id,
              name,
              folder: mimeType === folderMime,
              ...(mimeType === shortcutMime ? { unsupported: true } : {}),
            });
        }
        if (!page.nextPageToken) break;
        query.set('pageToken', page.nextPageToken);
      } while (true);
      return items;
    }
    case 'read': {
      const getVersion = async () =>
        (await (await drive(`${file(request.id)}?fields=version`)).json())
          .version;
      const version = await getVersion();
      const data = await readProjectBytes(
        await drive(`${file(request.id)}?alt=media`),
      );
      if (!version || version !== (await getVersion()))
        throw new Error('Project changed on Drive while it was being read.');
      return { data, version };
    }
    case 'mkdir':
      return (
        await drive(
          '/files?fields=id,name',
          json('POST', {
            name: request.name,
            mimeType: folderMime,
            parents: [request.folder],
          }),
        )
      ).json();
    case 'copy':
      await drive(
        `${file(request.id)}/copy`,
        json('POST', {
          name: request.name,
          parents: [request.folder],
        }),
      );
      return;
    case 'fingerprint': {
      const meta = await (
        await drive(
          `${file(request.id)}?fields=sha256Checksum,md5Checksum,version`,
        )
      ).json();
      return (
        meta.sha256Checksum ||
        meta.md5Checksum ||
        `${request.id}:${meta.version}`
      );
    }
    case 'trash':
      await drive(file(request.id), json('PATCH', { trashed: true }));
      return;
    case 'rename':
    case 'move': {
      const query = new URLSearchParams({ fields: 'id,name' });
      if (request.operation === 'move' && request.from !== request.folder) {
        query.set('addParents', request.folder);
        const meta = await (
          await drive(`${file(request.id)}?fields=parents`)
        ).json();
        if (meta.parents?.length)
          query.set('removeParents', meta.parents.join(','));
      }
      return (
        await drive(
          `${file(request.id)}?${query}`,
          json('PATCH', { name: request.name }),
        )
      ).json();
    }
    case 'write': {
      let etag: string;
      if (request.id) {
        const response = await drive(`${file(request.id)}?fields=version`);
        etag = response.headers.get('ETag');
        const meta = await response.json();
        if (meta.version !== request.version)
          throw new Error(
            'Project changed on Drive. Reopen it or save a copy.',
          );
      }
      const mimeType =
        isProjectFile(request.name) || /\.dsn$/i.test(request.name)
          ? 'application/xml'
          : 'application/octet-stream';
      const metadata = {
        name: request.name,
        mimeType,
        ...(request.id ? {} : { parents: [request.folder] }),
      };
      const boundary = `tinycad-${crypto.randomUUID()}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          metadata,
        )}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        new Uint8Array(request.data).buffer,
        `\r\n--${boundary}--\r\n`,
      ]);
      const resource = request.id ? file(request.id) : '/files';
      return (
        await drive(
          `/upload${resource}?uploadType=multipart&fields=id,name,version`,
          {
            method: request.id ? 'PATCH' : 'POST',
            headers: {
              'Content-Type': `multipart/related; boundary=${boundary}`,
              ...(etag ? { 'If-Match': etag } : {}),
            },
            body,
          },
        )
      ).json();
    }
  }
}
