import type { BoardAssets } from './boardAssets';
import type { CircuitSchematicSource, CircuitSnapshot } from './circuitSnapshot';

/** Match physical pads through the embedded device map and the circuit's stable IDs. */
export function boardPadSources(board: BoardAssets, snapshot: CircuitSnapshot) {
  const byId = <T extends { readonly id: string }>(items: readonly T[]) =>
    new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const devices = byId(board.deviceDefinitions ?? []);
  const definitions = byId(board.footprintDefinitions ?? []);
  const components = byId(board.components ?? []);
  const circuit = byId(snapshot.components);
  const targets: {
    footprintId: string;
    padId: string;
    padLabel: string;
    reference: string;
    signal: string;
    source: CircuitSchematicSource & { pinId: string };
  }[] = [];
  for (const footprint of board.footprints ?? []) {
    const component = components.get(footprint.componentId.toLowerCase());
    if (component?.role === 'pcb-only') continue;
    const logical = circuit.get(
      (component?.logicalId ?? footprint.componentId).toLowerCase(),
    );
    const device = devices.get(footprint.deviceId.toLowerCase());
    if (!logical || !device) continue;
    const pads = byId(
      definitions.get(device.footprintId.toLowerCase())?.pads ?? [],
    );
    const signals = byId(logical.signals);
    for (const assignment of device.assignments) {
      if (assignment.kind !== 'signal') continue;
      const signal = signals.get(assignment.signalId.toLowerCase());
      const pad = pads.get(assignment.padId.toLowerCase());
      if (!pad || !signal) continue;
      for (const { unitId, pinId } of signal.terminals) {
        const source = snapshot.sources?.[unitId.toLowerCase()];
        if (source)
          targets.push({
            footprintId: footprint.id,
            padId: pad.id,
            padLabel: pad.label,
            reference: logical.reference,
            signal: signal.name,
            source: { ...source, pinId },
          });
      }
    }
  }
  return targets;
}
