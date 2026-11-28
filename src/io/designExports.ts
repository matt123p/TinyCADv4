import { saveAs } from 'file-saver';
import {
  designExportFormats,
  designExportName,
} from '../../shared/designExports';
import type { docDrawing } from '../state/undo/undo';
import { projectRequest } from './projects';
import { projectFilesChanged } from './projectStorage';

export type DesignExportFormat = keyof typeof designExportFormats;
export type DesktopDesignExport = {
  project?: string;
  drawingId?: string;
  folderId?: string;
  account?: string;
  draftId: string;
  name: string;
  format: DesignExportFormat;
};

export const designExportChanged = 'tinycad:design-export-changed';

export function designExportSource(
  state: docDrawing,
): Omit<DesktopDesignExport, 'format'> {
  const { file } = state.altStore;
  return {
    project: state.schematicTabs?.projectRoot,
    drawingId: typeof file.id === 'string' ? file.id : undefined,
    folderId: typeof file.folderId === 'string' ? file.folderId : undefined,
    account: state.altStore.user?.id,
    draftId: state.docStore.present.drawing.documentId || file.name,
    name: file.name,
  };
}

export type DriveExportLocation = {
  id: string;
  name: string;
  folderId?: string;
};

const driveKey = (source: DesktopDesignExport, drawingId?: string) =>
  'tinycad.drive-export.' +
  JSON.stringify([
    source.account,
    drawingId ?? 'draft:' + source.draftId,
    source.format,
  ]);
const driveLocations = new Map<string, DriveExportLocation>();

function readDriveLocation(key: string): DriveExportLocation | undefined {
  if (driveLocations.has(key)) return driveLocations.get(key);
  try {
    const entry = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof entry?.id === 'string' && typeof entry?.name === 'string')
      return entry;
  } catch {
    // The current session still works when browser preferences are unavailable.
  }
}

export function driveExportLocation(source: DesktopDesignExport) {
  return readDriveLocation(driveKey(source, source.drawingId));
}

export function rememberDriveExport(
  source: DesktopDesignExport,
  location: DriveExportLocation,
) {
  const key = driveKey(source, source.drawingId);
  driveLocations.set(key, location);
  try {
    localStorage.setItem(key, JSON.stringify(location));
  } catch {
    // Keep the chosen location in the current session.
  }
  window.dispatchEvent(new Event(designExportChanged));
}

export async function designExportDestination(source: DesktopDesignExport) {
  if (process.env.TARGET_SYSTEM === 'electron')
    return projectRequest({ operation: 'export-destination', ...source });
  if (process.env.TARGET_SYSTEM === 'google')
    return driveExportLocation(source)?.name ?? null;
  return null;
}

export async function saveDesignExport(
  source: DesktopDesignExport,
  chooseLocation: boolean,
  contents: () => string | Promise<string>,
): Promise<boolean> {
  const text = await contents();
  if (process.env.TARGET_SYSTEM === 'electron') {
    const saved = await projectRequest({
      operation: 'save-design-export',
      ...source,
      saveAs: chooseLocation,
      text,
    });
    if (saved) {
      window.dispatchEvent(new Event(designExportChanged));
      if (source.project) window.dispatchEvent(new Event(projectFilesChanged));
    }
    return saved;
  }
  const { mime } = designExportFormats[source.format];
  saveAs(
    new Blob([text], { type: mime + ';charset=utf-8' }),
    designExportName(source.name, source.format),
  );
  return true;
}

export async function bindDrawingExports(
  source: Omit<DesktopDesignExport, 'format'>,
) {
  if (!source.drawingId) return;
  if (process.env.TARGET_SYSTEM === 'electron') {
    await projectRequest({ operation: 'bind-design-exports', ...source });
    window.dispatchEvent(new Event(designExportChanged));
    if (source.project) window.dispatchEvent(new Event(projectFilesChanged));
  }
  if (process.env.TARGET_SYSTEM === 'google') {
    for (const format of Object.keys(
      designExportFormats,
    ) as DesignExportFormat[]) {
      const entry = { ...source, format };
      const key = driveKey(entry);
      const draft = readDriveLocation(key);
      if (!draft) continue;
      if (!readDriveLocation(driveKey(entry, source.drawingId)))
        rememberDriveExport(entry, draft);
      driveLocations.delete(key);
      try {
        localStorage.removeItem(key);
      } catch {
        // The saved drawing still uses its own destination key.
      }
    }
  }
}
