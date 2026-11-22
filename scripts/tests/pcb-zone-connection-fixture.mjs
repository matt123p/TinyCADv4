import { placementFixture } from './pcb-placement-fixture.mjs';

export function zoneConnectionFixture(api) {
  const fixture = placementFixture(api);
  const [component] = fixture.components;
  const [device] = fixture.deviceDefinitions;
  const [placement] = fixture.footprints;
  const [definition] = fixture.footprintDefinitions;
  const netId = crypto.randomUUID();
  const signalId = crypto.randomUUID();
  const viaId = crypto.randomUUID();
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  return {
    ...fixture,
    requiredFeatures: [...fixture.requiredFeatures, 'copper-zones', 'routed-copper'],
    components: [{ ...component, signals: [{ signalId, netId }] }],
    deviceDefinitions: [{
      ...device,
      signalIds: [signalId],
      assignments: [{ padId: definition.pads[0].id, kind: 'signal', signalId }],
    }],
    footprints: [placement],
    nets: [{ id: netId, name: 'Ground' }],
    vias: [{ id: viaId, netId, positionNm: point(20, 10), diameterNm: 1e6, drillNm: 400_000 }],
    zones: [{
      id: crypto.randomUUID(),
      netId,
      layerId: 'top',
      outline: [point(7, 7), point(23, 7), point(23, 13), point(7, 13)],
      cutouts: [],
      priority: 1,
      clearanceNm: 400_000,
      spokeWidthNm: 250_000,
      thermalGapNm: 300_000,
      padConnection: 'direct',
      viaConnection: 'direct',
      islands: 'retain',
    }],
  };
}
