import type { BoardDocument } from './board';
import type { BoardCheckReport } from './boardChecks';
import type { ProjectCircuitInput } from './boardParity';
import type { BoardCamPreview } from './boardCam';
import type { exportKicadBoard } from './kicadBoardExport';
import type { BoardInspection } from './boardInspection';
import type { BoardAirwire } from './boardAirwires';
import type { BoardZoneGeometry } from './boardZoneGeometry';
import type { ManualTrackEdit } from './trackEdits';
import type { RouteCleanupResult } from './routeCleanup';
import type { ManualRoute, prepareManualTrackClearance } from './manualBoardRouting';

type BoardWorkerInput =
  | { kind: 'route'; board: BoardDocument; route: ManualRoute }
  | { kind: 'route-clearance'; board: BoardDocument; route: Pick<ManualRoute, 'netId' | 'widthNm' | 'replaceTrack'> }
  | { kind: 'track-edit'; board: BoardDocument; edit: ManualTrackEdit }
  | { kind: 'cleanup'; board: BoardDocument; netId: string }
  | { kind: 'geometry'; board: BoardDocument }
  | { kind: 'inspect' | 'kicad'; board: BoardDocument }
  | {
      kind: 'check' | 'cam';
      board: BoardDocument;
      projectCircuit?: ProjectCircuitInput;
    };

type BoardWorkerRequest = BoardWorkerInput & { id: number };

type BoardWorkerResponse =
  | { id: number; kind: 'route' | 'track-edit'; board: BoardDocument }
  | { id: number; kind: 'route-clearance'; geometry: ReturnType<typeof prepareManualTrackClearance> }
  | { id: number; kind: 'cleanup'; result: RouteCleanupResult }
  | {
      id: number;
      kind: 'geometry';
      airwires: BoardAirwire[];
      zones: BoardZoneGeometry;
    }
  | { id: number; kind: 'check'; report: BoardCheckReport }
  | { id: number; kind: 'cam'; preview: BoardCamPreview }
  | { id: number; kind: 'inspect'; inspection: BoardInspection }
  | {
      id: number;
      kind: 'kicad';
      output: Awaited<ReturnType<typeof exportKicadBoard>>;
    }
  | { id: number; kind: 'error'; error: string };

export type { BoardWorkerRequest, BoardWorkerResponse };

export function createBoardWorker() {
  const worker = new Worker(new URL('./board.worker.ts', import.meta.url), {
    type: 'module',
    name: 'tinycad-pcb',
  });
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve(data: Exclude<BoardWorkerResponse, { kind: 'error' }>): void;
      reject(error: Error): void;
    }
  >();
  let closed = false;

  function close(message: string) {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  }

  worker.onmessage = ({ data }: MessageEvent<BoardWorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.kind === 'error') request.reject(new Error(data.error));
    else request.resolve(data);
  };
  worker.onerror = (event) => close(event.message || 'PCB worker failed.');
  worker.onmessageerror = () => close('Could not read the PCB worker result.');

  async function request(input: BoardWorkerInput) {
    if (closed) throw new Error('The PCB worker is closed.');
    return new Promise<Exclude<BoardWorkerResponse, { kind: 'error' }>>(
      (resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ id, ...input } satisfies BoardWorkerRequest);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      },
    );
  }

  return {
    get closed() { return closed; },
    async routeClearance(board: BoardDocument, route: Pick<ManualRoute, 'netId' | 'widthNm' | 'replaceTrack'>) {
      const result = await request({ kind: 'route-clearance', board, route });
      if (result.kind !== 'route-clearance')
        throw new Error('Unexpected response to PCB route clearance.');
      return result.geometry;
    },
    async route(
      board: BoardDocument,
      route: ManualRoute,
    ): Promise<BoardDocument> {
      const result = await request({ kind: 'route', board, route });
      if (result.kind !== 'route')
        throw new Error('Unexpected response to PCB route.');
      return result.board;
    },
    async editTrack(board: BoardDocument, edit: ManualTrackEdit): Promise<BoardDocument> {
      const result = await request({ kind: 'track-edit', board, edit });
      if (result.kind !== 'track-edit') throw new Error('Unexpected response to PCB track edit.');
      return result.board;
    },
    async cleanup(board: BoardDocument, netId: string) {
      const result = await request({ kind: 'cleanup', board, netId });
      if (result.kind !== 'cleanup') throw new Error('Unexpected response to PCB route cleanup.');
      return result.result;
    },
    async geometry(board: BoardDocument) {
      const result = await request({ kind: 'geometry', board });
      if (result.kind !== 'geometry')
        throw new Error('Unexpected response to PCB geometry request.');
      return result;
    },
    async check(board: BoardDocument, projectCircuit?: ProjectCircuitInput) {
      const result = await request({ kind: 'check', board, projectCircuit });
      if (result.kind !== 'check')
        throw new Error('Unexpected response to PCB checks.');
      return result.report;
    },
    async cam(board: BoardDocument, projectCircuit?: ProjectCircuitInput) {
      const result = await request({ kind: 'cam', board, projectCircuit });
      if (result.kind !== 'cam')
        throw new Error('Unexpected response to PCB CAM preview.');
      return result.preview;
    },
    async inspect(board: BoardDocument) {
      const result = await request({ kind: 'inspect', board });
      if (result.kind !== 'inspect')
        throw new Error('Unexpected response to PCB inspection.');
      return result.inspection;
    },
    async kicad(board: BoardDocument) {
      const result = await request({ kind: 'kicad', board });
      if (result.kind !== 'kicad')
        throw new Error('Unexpected response to KiCad export.');
      return result.output;
    },
    dispose: () => close('The PCB workspace was closed.'),
  };
}
