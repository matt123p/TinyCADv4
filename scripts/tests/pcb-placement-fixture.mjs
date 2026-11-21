export function placementFixture(api) {
  const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const outside = [point(0, 0), point(40, 0), point(40, 40), point(0, 40)];
  const board = api.createBoard('Placement group fixture', 2, outside);
  const definitionDigest = 'sha256:' + 'a'.repeat(64);
  const land = {
    kind: 'capsule',
    widthNm: 450_000,
    start: point(0, 0),
    end: point(0, 0),
  };
  const footprint = {
    id: id(1),
    revision: '1',
    definitionDigest,
    name: 'Group test pad',
    pads: [
      {
        id: id(2),
        label: '1',
        positionNm: point(0, 0),
        stack: { copper: { top: land }, mask: { top: land } },
      },
    ],
  };
  const device = {
    id: id(3),
    revision: '1',
    definitionDigest,
    footprintId: footprint.id,
    packageSource: 'Synthetic placement check',
    packageName: footprint.name,
    signalIds: [],
    assignments: [{ padId: id(2), kind: 'mechanical' }],
  };
  const components = ['U1', 'U2', 'U3'].map((reference, index) => ({
    id: id(4 + index),
    reference,
    deviceId: device.id,
    role: 'pcb-only',
  }));
  return {
    ...board,
    requiredFeatures: [
      ...board.requiredFeatures,
      'embedded-devices',
      'physical-padstacks',
    ],
    footprintDefinitions: [footprint],
    deviceDefinitions: [device],
    components,
    footprints: [point(10, 10), point(15, 13), point(22, 16)].map(
      (positionNm, index) => ({
        id: id(7 + index),
        componentId: components[index].id,
        deviceId: device.id,
        positionNm,
        side: index === 1 ? 'bottom' : 'top',
        rotationMicrodegree: index * 30e6,
        locked: false,
      }),
    ),
  };
}
