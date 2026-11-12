import { NetlistWorkerState } from './netlistState';
import { optimiseLayout } from '../layout';

interface WorkerRequest {
  id: number;
  command: string;
  payload?: any;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  data?: any;
  error?: string;
}

const state = new NetlistWorkerState();

let layoutFonts: Promise<unknown>;
function loadLayoutFonts() {
  // Worker canvases have their own font set; match the editor's bundled faces.
  return layoutFonts ??= Promise.all([
    ['Arial', new URL('../../styles/fonts/LiberationSans-Regular.ttf', import.meta.url)],
    ['Courier New', new URL('../../styles/fonts/LiberationMono-Regular.ttf', import.meta.url)],
    ['Times New Roman', new URL('../../styles/fonts/LiberationSerif-Regular.ttf', import.meta.url)],
  ].map(async ([family, url]) => {
    const face = await new FontFace(String(family), `url("${url}")`).load();
    (globalThis as unknown as { fonts: FontFaceSet }).fonts.add(face);
  }));
}

onmessage = async function (event: MessageEvent<WorkerRequest>) {
  const request = event.data;

  const response: WorkerResponse = {
    id: request.id,
    ok: true,
  };

  try {
    switch (request.command) {
      case 'auto-layout': {
        await loadLayoutFonts();
        const result = optimiseLayout(request.payload.sheet, request.payload.options);
        response.data = { changes: result.changes, connectivityPreserved: result.connectivityPreserved };
        break;
      }
      case 'netlist-init':
        response.data = state.init(request.payload.drawing);
        break;
      case 'netlist-update':
        response.data = state.update(
          request.payload.sheets || [],
          request.payload.removedSheets || [],
        );
        break;
      case 'netlist-get':
        response.data = state.get();
        break;
      case 'netlist':
        // Backward compatibility command
        response.data = state.init(request.payload);
        break;
      default:
        response.ok = false;
        response.error = `Unknown worker command: ${request.command}`;
        break;
    }
  } catch (e) {
    response.ok = false;
    response.error = e instanceof Error ? e.message : 'Unknown worker error';
  }

  postMessage(response);
};
