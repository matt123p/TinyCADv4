import type { BoardDocument } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import { analyseCopper } from './copper';
import type { CopperFeature } from './copper';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

export interface BoardAirwire {
  netId: string;
  start: BoardPoint;
  end: BoardPoint;
}

export function boardAirwires(
  board: BoardDocument,
  kernel: PolygonKernel,
  fills: readonly CopperFeature[] = [],
  geometry = boardCopperGeometry(board),
): BoardAirwire[] {
  const { features, drills } = geometry;
  const topology = analyseCopper(kernel, [...features, ...fills], drills);
  const fragments = new Map(
    topology.copper.map((fragment) => [fragment.id, fragment.feature]),
  );
  const islandsByNet = new Map<string, BoardPoint[][]>();
  for (const island of topology.connectedSets) {
    const pointsByNet = new Map<string, BoardPoint[]>();
    for (const fragment of island) {
      const feature = fragments.get(fragment);
      if (!feature?.terminalId) continue;
      const position = feature.anchor;
      if (!position) continue;
      const group = pointsByNet.get(feature.netId) ?? [];
      group.push(position);
      pointsByNet.set(feature.netId, group);
    }
    for (const [net, points] of pointsByNet) {
      const islands = islandsByNet.get(net) ?? [];
      islands.push(points);
      islandsByNet.set(net, islands);
    }
  }

  const wires: BoardAirwire[] = [];
  for (const [netId, [initial, ...pending]] of islandsByNet) {
    const joined = [...initial];
    while (pending.length) {
      let closest: BoardAirwire;
      let nearest = Infinity;
      let index = 0;
      pending.forEach((points, i) => {
        for (const start of joined)
          for (const end of points) {
            const distance = Math.hypot(start.x - end.x, start.y - end.y);
            if (distance < nearest) {
              closest = { netId, start, end };
              nearest = distance;
              index = i;
            }
          }
      });
      wires.push(closest);
      joined.push(...pending.splice(index, 1)[0]);
    }
  }
  return wires;
}
