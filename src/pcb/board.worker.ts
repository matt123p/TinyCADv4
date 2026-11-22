import type { BoardWorkerRequest, BoardWorkerResponse } from './boardWorker';
import { prepareManualRoute, prepareManualTrackEdit, prepareManualTrackClearance } from './manualBoardRouting';
import { prepareRouteCleanupChange } from './routeCleanup';
import { boardAirwires } from './boardAirwires';
import { inspectBoard } from './boardInspectionJob';
import { checkBoard } from './boardChecks';
import { prepareCamPreview } from './boardCam';
import { exportKicadBoard } from './kicadBoardExport';
import { boardCopperGeometry } from './boardCopperGeometry';
import { boardZoneGeometry } from './boardZoneGeometry';
import { packRouteClearance } from './routeClearanceTransfer';
import { projectPcbKernel } from '../io/projectPcbKernel';

self.addEventListener(
  'message',
  async ({ data }: MessageEvent<BoardWorkerRequest>) => {
    let reply: BoardWorkerResponse;
    try {
      if (data.kind === 'kicad') {
        const reply: BoardWorkerResponse = {
          id: data.id,
          kind: 'kicad',
          output: await exportKicadBoard(data.board),
        };
        self.postMessage(reply);
        return;
      }
      const kernel = await projectPcbKernel();
      if (data.kind === 'route') {
        reply = {
          id: data.id,
          kind: 'routing-edit',
          change: prepareManualRoute(data.board, data.route, kernel).change,
        };
      } else if (data.kind === 'route-clearance') {
        const { geometry, transfer } = packRouteClearance(
          prepareManualTrackClearance(data.board, data.route, kernel),
        );
        const reply: BoardWorkerResponse = {
          id: data.id,
          kind: 'route-clearance',
          geometry,
        };
        self.postMessage(reply, { transfer });
        return;
      } else if (data.kind === 'track-edit') {
        reply = {
          id: data.id,
          kind: 'routing-edit',
          change: prepareManualTrackEdit(data.board, data.edit, kernel).change,
        };
      } else if (data.kind === 'cleanup') {
        reply = { id: data.id, kind: 'cleanup', change: prepareRouteCleanupChange(data.board, data.netId, kernel) };
      } else if (data.kind === 'check') {
        reply = {
          id: data.id,
          kind: 'check',
          report: await checkBoard(data.board, kernel, {
            projectCircuit: data.projectCircuit,
          }),
          ...(data.measureMemory ? { wasmMemoryBytes: kernel.memoryBytes() } : {}),
        };
      } else if (data.kind === 'cam') {
        reply = {
          id: data.id,
          kind: 'cam',
          preview: await prepareCamPreview(
            data.board,
            kernel,
            data.projectCircuit,
          ),
        };
      } else if (data.kind === 'inspect') {
        const inspection = await inspectBoard(data.board, kernel);
        const reply: BoardWorkerResponse = {
          id: data.id,
          kind: 'inspect',
          inspection,
        };
        const transfer = Object.values(inspection.models).flatMap((meshes) =>
          meshes.flatMap(({ positions, normals, indices }) =>
            normals
              ? [positions.buffer, normals.buffer, indices.buffer]
              : [positions.buffer, indices.buffer],
          ),
        );
        self.postMessage(reply, { transfer });
        return;
      } else {
        const geometry = boardCopperGeometry(data.board, { includeApertures: false });
        const zones = boardZoneGeometry(data.board, kernel, geometry);
        reply = {
          id: data.id,
          kind: 'geometry',
          zones,
          airwires: boardAirwires(data.board, kernel, zones.fills, geometry),
        };
      }
    } catch (error) {
      reply = {
        id: data.id,
        kind: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    self.postMessage(reply);
  },
);
