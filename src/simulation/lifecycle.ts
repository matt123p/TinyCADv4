let invalidate: (() => void) | undefined;
let stop: (() => void) | undefined;

export function registerSimulationLifecycle(procedures: {
  invalidate(): void;
  stop(): void;
}) {
  invalidate = procedures.invalidate;
  stop = procedures.stop;
}

export function invalidateSimulationDocument() {
  invalidate?.();
}

export function stopActiveSimulation() {
  stop?.();
}
