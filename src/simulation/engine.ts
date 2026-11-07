import { EngineEvent, EngineRequest } from './contracts';
export interface EngineJob {
  stop(): void;
  dispose(): void;
}

export function startEngine(
  request: EngineRequest,
  receive: (event: EngineEvent) => void,
): EngineJob {
  if (process.env.TARGET_SYSTEM === 'electron') {
    let terminal: Extract<EngineEvent, { type: 'finished' }>;
    const unsubscribe = window.electronAPI.onSimulation((id, event) => {
      if (id !== request.runId) return;
      if (event.type === 'finished') {
        terminal ||= event;
        // Wait for helper cleanup before enabling another native acquisition.
        // Also stop a solver that reports a callback limit before returning.
        window.electronAPI.stopSimulation(request.runId);
      } else receive(event);
    });
    window.electronAPI
      .startSimulation(request)
      .then(() =>
        receive(
          terminal || {
            type: 'finished',
            state: 'failed',
            error: 'The bundled engine exited without a terminal result.',
          },
        ),
      )
      .catch((error) =>
        receive({ type: 'finished', state: 'failed', error: String(error) }),
      );
    return {
      stop: () => window.electronAPI.stopSimulation(request.runId),
      dispose: () => {
        unsubscribe();
        window.electronAPI.stopSimulation(request.runId);
      },
    };
  }
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event) => receive(event.data);
  worker.onerror = (event) =>
    receive({
      type: 'finished',
      state: 'failed',
      error: event.message || 'Simulation worker failed.',
    });
  worker.postMessage({
    ...request,
    moduleUrl: new URL('engines/ngspice/ngspice.js', document.baseURI).href,
  });
  return {
    stop() {
      worker.terminate();
      receive({ type: 'finished', state: 'stopped' });
    },
    dispose() {
      worker.terminate();
    },
  };
}
