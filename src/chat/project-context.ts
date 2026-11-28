import { isDrawingFile } from '../../shared/drawingFiles';
import type { ProjectLocation } from '../io/projectStorage';
import type { ProjectDocument } from '../io/useProjectDocuments';
import type { docDrawing } from '../state/undo/undo';
import { projectDocumentKind } from '../io/projectDocumentKind';
import { projectRequest } from '../io/projects';
import { ioXML } from '../io/ioXml';
import { activeSchematicTabKey } from '../state/schematicTabs';
import { MAX_ATTACHMENT_BYTES, readAttachments } from './attachments';
import type { Attachment, ProviderKind, ToolResult } from './types';

export type ChatProject = {
  root: ProjectLocation;
  active?: ProjectDocument;
  pdfPage?: number;
};

const textLimit = 16000;
const directImages = ['image/png', 'image/jpeg', 'image/webp'];

export function projectPath(root: string, id?: string) {
  const folder = root.replaceAll('\\', '/').replace(/\/$/, '') + '/';
  const file = id?.replaceAll('\\', '/');
  return file?.startsWith(folder) ? file.slice(folder.length) : undefined;
}

export const attachmentBytes = (file: Attachment) =>
  Math.ceil((file.data.length * 3) / 4);

function sliceText(text: string, offset: number) {
  const end = offset + textLimit;
  return {
    text: text.slice(offset, end),
    offset,
    nextOffset: end < text.length ? end : null,
    length: text.length,
  };
}

function projectText(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
      ? 'utf-16be'
      : 'utf-8';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/[\x00-\x08\x0e-\x1a]/.test(text))
    throw new Error('This file does not contain supported text.');
  return text;
}

async function imageAttachment(
  bytes: Uint8Array,
  name: string,
  mime: string,
  budget: number,
  signal: AbortSignal,
) {
  const blob = new Blob([bytes.slice()], { type: mime });
  if (directImages.includes(mime) && blob.size + 3 <= budget) {
    const [image] = await readAttachments([
      new File([blob], name, { type: mime }),
    ]);
    return image;
  }
  if (budget < 1024) return;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not render the project image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const attachment = {
      name,
      mime: 'image/png',
      data: canvas.toDataURL('image/png').split(',')[1],
    };
    if (attachmentBytes(attachment) <= budget) return attachment;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readProjectReference(
  project: ChatProject,
  args: { path: string; offset?: number; page?: number; image?: boolean },
  signal: AbortSignal,
): Promise<ToolResult> {
  const { path, offset = 0, page = 1, image = false } = args;
  const active =
    project.active && projectPath(project.root.id, project.active.id) === path
      ? project.active
      : undefined;
  const name = path.split('/').at(-1);
  if (active?.kind === 'text')
    return {
      data: {
        path,
        kind: 'text',
        unsaved: active.saved !== active.value,
        ...sliceText(active.value, offset),
      },
    };
  const bytes =
    active?.bytes ??
    (await projectRequest({
      operation: 'chat-read',
      project: project.root.id,
      relative: path,
    }));
  signal.throwIfAborted();
  if (isDrawingFile(name)) {
    const { decodeDrawing } = await import('../io/dsnCodec');
    const drawing = await decodeDrawing(bytes);
    const xml = new ioXML().to_dsn(drawing, true, true).tostring();
    return { data: { path, kind: 'schematic', ...sliceText(xml, offset) } };
  }
  if (/\.tclib$/i.test(name)) {
    const { loadTcLibrary } = await import('../io/tclib');
    const library = await loadTcLibrary(null, name, '', bytes.slice().buffer);
    const names = library.names.map(({ Name, Reference, Description }) => ({
      Name,
      Reference,
      Description,
    }));
    return {
      data: {
        path,
        kind: 'library',
        ...sliceText(JSON.stringify(names), offset),
      },
    };
  }
  const kind = active ?? projectDocumentKind(name);
  if (kind.kind === 'pdf') {
    const { readPdfPage } = await import('./pdf-import');
    const result = await readPdfPage(bytes, name, page, image, signal);
    const preview =
      result.preview &&
      attachmentBytes(result.preview) <= MAX_ATTACHMENT_BYTES &&
      result.preview;
    return {
      data: {
        path,
        kind: 'pdf',
        page,
        pages: result.pages,
        ...sliceText(result.text, offset),
        ...(image && !preview
          ? { note: 'The rendered page exceeds the image limit.' }
          : {}),
      },
      images: preview ? [preview] : undefined,
    };
  }
  if (kind.kind === 'image') {
    const attachment = await imageAttachment(
      bytes,
      name,
      kind.mime,
      MAX_ATTACHMENT_BYTES,
      signal,
    );
    if (!attachment)
      throw new Error('The image exceeds the chat attachment limit.');
    return { data: { path, kind: 'image' }, images: [attachment] };
  }
  return {
    data: { path, kind: 'text', ...sliceText(projectText(bytes), offset) },
  };
}

export function chatEditingTarget(state: docDrawing) {
  const { drawing, editLibrary, editSymbol } = state.docStore.present;
  if (editLibrary)
    return {
      kind: 'library',
      name: editLibrary.name,
      key: typeof editLibrary.fileId === 'string' ? editLibrary.fileId : undefined,
      symbol: editSymbol?.NameID,
    };
  const key = activeSchematicTabKey(state);
  if (
    !key ||
    (state.schematicTabs?.enabled && !state.schematicTabs.order.includes(key))
  )
    return null;
  return {
    kind: 'schematic',
    name: state.altStore.file.name,
    key,
    id: drawing.documentId,
  };
}

export async function activeChatReference(
  project: ChatProject | undefined,
  state: docDrawing,
  provider: ProviderKind,
  budget: number,
  signal: AbortSignal,
) {
  const { drawing, view, editLibrary, editSymbol, bom } =
    state.docStore.present;
  const target = chatEditingTarget(state);
  const workspace = project
    ? { mode: 'project', name: project.root.name }
    : { mode: 'single' };
  const active = project?.active;
  const attachments: Attachment[] = [];
  let tab: Record<string, unknown>;
  if (active) {
    tab = {
      name: active.name,
      path: projectPath(project.root.id, active.id),
      kind: active.kind,
      mime: active.mime,
    };
    if (active.kind === 'text')
      Object.assign(tab, sliceText(active.value, 0), {
        unsaved: active.saved !== active.value,
      });
    else {
      try {
        if (active.kind === 'pdf') {
          const page = project.pdfPage ?? 1;
          tab.page = page;
          if (
            active.bytes.length + 3 <= budget &&
            !['compatible', 'ollama'].includes(provider)
          ) {
            const file = new File([active.bytes.slice()], active.name, {
              type: active.mime,
            });
            attachments.push(
              ...(await readAttachments([file], provider, '', signal)),
            );
          } else {
            const { readPdfPage } = await import('./pdf-import');
            const result = await readPdfPage(
              active.bytes,
              active.name,
              page,
              budget >= 1024,
              signal,
            );
            Object.assign(tab, {
              pages: result.pages,
              ...sliceText(result.text, 0),
            });
            if (result.preview && attachmentBytes(result.preview) <= budget)
              attachments.push(result.preview);
          }
        } else {
          const attachment = await imageAttachment(
            active.bytes,
            active.name,
            active.mime,
            budget,
            signal,
          );
          if (attachment) attachments.push(attachment);
          else
            tab.note =
              'Image omitted from the automatic attachment budget. Use read_project_file to view it.';
        }
      } catch (error) {
        signal.throwIfAborted();
        tab.note = `Could not attach the reference: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
  } else if (!target) {
    tab = { kind: 'empty' };
  } else if (editLibrary) {
    tab = {
      kind: 'library',
      name: editLibrary.name,
      symbol: editSymbol?.Name,
      components: editLibrary.names
        .slice(0, 100)
        .map(({ Name, Reference }) => ({ Name, Reference })),
      componentCount: editLibrary.names.length,
    };
    if (editSymbol)
      Object.assign(
        tab,
        sliceText(new ioXML().to_dsn(drawing, false, true).tostring(), 0),
      );
  } else if (view.selected_sheet === -1) {
    tab = {
      kind: 'bom',
      name: 'Bill of Materials',
      drawing: target.name,
      ...sliceText(JSON.stringify(bom ?? []), 0),
    };
  } else if (view.selected_sheet < -1) {
    tab = { kind: 'web', ...view.browserSheets[-2 - view.selected_sheet] };
  } else {
    const id = state.altStore.file.id;
    tab = {
      kind: 'schematic',
      name: target.name,
      path:
        project && typeof id === 'string'
          ? projectPath(project.root.id, id)
          : undefined,
      sheet: view.selected_sheet + 1,
      ...sliceText(new ioXML().to_dsn(drawing, true, true).tostring(), 0),
    };
  }
  return {
    data: {
      ...workspace,
      activeTab: tab,
      editingTarget: target && { kind: target.kind, name: target.name },
    },
    attachments,
  };
}
