import {
  findProjectPath,
  projectFilesChanged,
  projectRequest,
  readProject,
  readProjectBoard,
} from './projects';
import { readProjectSchematic } from './projectHierarchy';
import { DocItemTypes } from '../model/dsnItem';
import {
  deviceLibraryExtension,
  readLibraryDevice,
} from '../pcb/deviceLibrary';
import type { DeviceRevision } from '../pcb/deviceLibrary';
import { applyDeviceReview } from '../pcb/deviceReview';
import type { DeviceReview } from '../pcb/deviceReview';
import { encodeBoard } from '../pcb/boardCodec';

export async function openProjectDeviceReview(
  location: { id: string; rootId: string },
  boardId: string,
) {
  const project = await readProject(location.id, location.rootId);
  const entry = project.settings.entries.find(
    (item) => item.id === boardId && item.kind === 'board',
  );
  if (!entry) throw new Error('The PCB is no longer linked to this project.');
  const { board, circuit, version } = await readProjectBoard(project, boardId);
  if (!circuit?.sources)
    throw new Error(
      'This PCB needs an applied circuit snapshot with schematic sources.',
    );
  const file = project.files.get(entry.path);
  const parentPath = entry.path.split('/').slice(0, -1).join('/');
  const folder = parentPath
    ? (await findProjectPath(location.rootId, parentPath, true))?.id
    : location.rootId;
  if (!folder) throw new Error('The PCB folder no longer exists.');
  const folders = [...new Set([location.rootId, folder])];

  async function readCatalogue() {
    const devices = new Map<string, DeviceRevision>();
    const badRevisions = new Set<string>();
    const warnings: string[] = [];
    for (const scope of folders) {
      for (const item of await projectRequest({
        operation: 'list',
        folder: scope,
        tree: true,
      })) {
        if (
          item.folder ||
          item.unsupported ||
          !item.name.toLowerCase().endsWith(deviceLibraryExtension)
        )
          continue;
        try {
          const { data } = await projectRequest({
            operation: 'read',
            id: item.id,
          });
          const device = await readLibraryDevice(data);
          const key = JSON.stringify([
            device.definition.id,
            device.definition.revision,
          ]);
          if (devices.has(key) && devices.get(key).digest !== device.digest) {
            badRevisions.add(key);
            warnings.push(
              `Conflicting contents for ${device.definition.name}, revision ${device.definition.revision}.`,
            );
          } else devices.set(key, device);
        } catch (error) {
          warnings.push(
            `${item.name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    return {
      devices: [...devices.entries()].flatMap(([key, item]) =>
        badRevisions.has(key) ? [] : [item],
      ),
      warnings,
    };
  }

  return {
    board,
    circuit,
    catalogue: await readCatalogue(),
    async addLibrary(name: string, data: Uint8Array) {
      if (!name.toLowerCase().endsWith(deviceLibraryExtension))
        throw new Error(`Choose a ${deviceLibraryExtension} file.`);
      await readLibraryDevice(data);
      const siblings = await projectRequest({
        operation: 'list',
        folder,
        tree: true,
      });
      if (siblings.some((item) => item.name === name))
        throw new Error('A project item already has this name.');
      await projectRequest({ operation: 'write', folder, name, data });
      window.dispatchEvent(new Event(projectFilesChanged));
      return readCatalogue();
    },
    async readUnit(unitId: string) {
      const source = circuit.sources[unitId];
      const sheetEntry = project.settings.entries.find(
        (item) => item.id === source?.documentId && item.kind === 'schematic',
      );
      if (!sheetEntry)
        throw new Error('The source schematic is no longer found.');
      const drawing = await readProjectSchematic(project, sheetEntry);
      const sheet = drawing.sheets.find((item) => item.id === source.sheetId);
      const symbol = sheet?.items.find(
        (item) =>
          item.NodeName === DocItemTypes.Symbol &&
          item.unitId === source.unitId,
      );
      if (symbol?.NodeName !== DocItemTypes.Symbol)
        throw new Error('The source schematic unit no longer exists.');
      return { symbol, options: sheet.options, source };
    },
    async apply(review: DeviceReview) {
      const latest = await readProject(location.id, location.rootId);
      const current = await readProjectBoard(latest, boardId);
      if (
        latest.files.get(entry.path)?.id !== file.id ||
        current.version !== version
      )
        throw new Error(
          'The board changed in storage. Reopen the device review.',
        );
      const data = await encodeBoard(applyDeviceReview(current.board, review));
      await projectRequest({
        operation: 'write',
        id: file.id,
        folder,
        name: file.name,
        data,
        version,
      });
      window.dispatchEvent(new Event(projectFilesChanged));
    },
  };
}

export type ProjectDeviceReview = Awaited<
  ReturnType<typeof openProjectDeviceReview>
>;
