//
// This class handles the snapping of objects to
// the grid or other alignment objects
//

import {
  Coordinate,
  DocItem,
  MagenticCoordinate,
  DocItemTypes,
} from '../model/dsnItem';
import { updateAPFactory } from './updateFactory';
import { updateWire } from './updateWire';

// Constructor
export class Snap {
  constructor(public _grid: number, public _grid_snap: boolean) {}

  // Perform the snapping
  snap(p: Coordinate): Coordinate {
    let r: Coordinate = [
      Math.round(p[0] / this._grid) * this._grid,
      Math.round(p[1] / this._grid) * this._grid,
    ];
    if (p.length > 2) {
      // For polygon control points
      r.push(1);
    }

    return r;
  }

  // Perform the snapping in a positive direction only
  snap_positive(p: Coordinate): Coordinate {
    let r = this.snap(p);

    // Make sure snapping is positive
    if (r[0] < p[0]) {
      r[0] += this._grid;
    }
    if (r[1] < p[1]) {
      r[1] += this._grid;
    }
    if (p.length > 2) {
      // For polygon control points
      r.push(1);
    }

    return r;
  }

  // Perform the snapping in a negative direction only
  snap_negative(p: Coordinate): Coordinate {
    let r = this.snap(p);

    // Make sure snapping is negative
    if (r[0] > p[0]) {
      r[0] -= this._grid;
    }
    if (r[1] > p[1]) {
      r[1] -= this._grid;
    }
    if (p.length > 2) {
      // For polygon control points
      r.push(1);
    }

    return r;
  }

  // Find a nearby magnetic point
  snap_magnetic(
    p: Coordinate,
    wires_only: boolean,
    items: DocItem[],
  ): MagenticCoordinate {
    // Search all items and find active points
    let snap_p = this.snap(p);
    let active_dist = 10 * 10;

    let active_point = null;
    let active_obj = null;

    let wire_dist = active_dist;
    let active_wire_point = null;
    let active_wire = null;

    for (let i = 0; i < items.length; ++i) {
      let o = items[i];
      if (!wires_only) {
        switch (o.NodeName) {
          case DocItemTypes.Power:
          case DocItemTypes.Symbol:
            const updater_o = updateAPFactory(o);
            let aps = updater_o.active_points();

            // Are any of these active points near the point?
            for (let j = 0; j < aps.length; ++j) {
              let d1 = aps[j][0] - p[0];
              let d2 = aps[j][1] - p[1];
              let distance = d1 * d1 + d2 * d2;
              if (distance < active_dist) {
                active_dist = distance;
                active_point = aps[j].slice();
                active_obj = o;
              }
            }
            break;
          case DocItemTypes.Wire:
            const updater_w = new updateWire(o);
            let d = updater_w.distanceFromPoint(p, snap_p);
            if (d.distance < wire_dist) {
              wire_dist = d.distance;
              active_wire_point = d.point;
              active_wire = o;
            }
            break;
        }
      }
    }

    // The active point takes priority over clipping to wires
    if (active_point != null) {
      return { point: active_point, wire: null };
    } else if (active_wire_point != null) {
      return { point: active_wire_point, wire: active_wire };
    } else {
      return null;
    }
  }
}
