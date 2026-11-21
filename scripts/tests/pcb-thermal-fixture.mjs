const point = (x, y) => ({ x, y });
const polygon = (left, bottom, right, top) => [
  point(left, bottom),
  point(right, bottom),
  point(right, top),
  point(left, top),
];

export function thermalFixture(api) {
  const base = api.createBoard('Thermal checks', 2, polygon(0, 0, 12e6, 12e6));
  const netId = crypto.randomUUID();
  const viaId = crypto.randomUUID();
  const zone = {
    id: crypto.randomUUID(),
    netId,
    layerId: 'top',
    priority: 1,
    outline: polygon(1e6, 1e6, 11e6, 11e6),
    cutouts: [],
    padConnection: 'direct',
    viaConnection: 'thermal',
    spokeWidthNm: 300_000,
    thermalGapNm: 300_000,
    islands: 'retain',
  };
  const board = {
    ...base,
    requiredFeatures: [
      ...base.requiredFeatures,
      'copper-zones',
      'routed-copper',
    ],
    nets: [{ id: netId, name: 'Ground' }],
    zones: [zone],
    vias: [
      {
        id: viaId,
        netId,
        positionNm: point(5e6, 5e6),
        diameterNm: 1e6,
        drillNm: 300_000,
      },
    ],
  };
  const clipped = {
    ...board,
    zones: [
      {
        ...zone,
        cutouts: [
          { outline: polygon(5.58e6, 5.03e6, 5.72e6, 5.29e6) },
          { outline: polygon(4.7e6, 5.58e6, 5.3e6, 5.72e6) },
        ],
      },
    ],
  };
  return { board, clipped };
}
