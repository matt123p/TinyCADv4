import { NetlistWorkerState } from './netlistState';

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

onmessage = function (event: MessageEvent<WorkerRequest>) {
  const request = event.data;

  const response: WorkerResponse = {
    id: request.id,
    ok: true,
  };

  try {
    switch (request.command) {
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
