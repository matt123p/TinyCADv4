//
// This the base class for the drawable items which are
// based on rectangles
//

import { get_global_id } from '../util/global_id';
import { dragObject } from './dragObject';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import {
  SimpleAdd,
  MoveAdd,
  SimpleDrag,
  IsInsideResult,
  DrawingDelta,
  IsInside,
  ContextMenuList,
} from './updateInterfaces';
import { Snap } from './snap';
import {
  dsnBusWire,
  Coordinate,
  DocItem,
  DocItemTypes,
} from '../model/dsnItem';
import { ViewTracker, FindResult } from '../model/dsnView';

export class updateBusWire implements SimpleAdd, MoveAdd, SimpleDrag, IsInside {
  public lock_90 = true;

  constructor(public item: dsnBusWire) {}

  x() {
    return this.getBoundingRect().x1;
  }

  y() {
    return this.getBoundingRect().y1;
  }

  // Get the bounding rectangle for this wire
  getBoundingRect() {
    let min_x = 0;
    let min_y = 0;
    let max_x = 0;
    let max_y = 0;

    let first = true;
    for (let i = 0; i < this.item.d_points.length; ++i) {
      let p = this.item.d_points[i];
      if (first) {
        min_x = p[0];
        max_x = p[0];
        min_y = p[1];
        max_y = p[1];
        first = false;
      } else {
        min_x = Math.min(min_x, p[0]);
        max_x = Math.max(max_x, p[0]);
        min_y = Math.min(min_y, p[1]);
        max_y = Math.max(max_y, p[1]);
      }
    }

    return { x1: min_x, y1: min_y, x2: max_x, y2: max_y };
  }

  // Get the list of handles associated with a selected
  // object
  handles() {
    return this.item.d_points;
  }

  active_points() {
    return this.item.d_points;
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    if (handle === -1) {
      // Not selected
      return 'auto';
    } else if (handle >= 1000) {
      // Line movement
      return 'move';
    } else {
      // Handle movement
      return 'crosshair';
    }
  }

  // Determine if an point is inside this object
  // We return the handle number or -1 for not inside
  _isPointInsideRect(p: Coordinate, a: Coordinate, b: Coordinate) {
    // First is it inside the rectangle?
    if (p[0] < a[0] || p[0] > b[0] || p[1] < a[1] || p[1] > b[1]) {
      // It is outside
      return false;
    }

    // It is inside
    return true;
  }

  // Does the rectangle completely contain this item?
  is_inside_rect_item(a: Coordinate, b: Coordinate) {
    for (let i = 0; i < this.item.d_points.length; ++i) {
      if (!this._isPointInsideRect(this.item.d_points[i], a, b)) {
        return false;
      }
    }

    return true;
  }

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    return UtilityService.simpleIsInsideRect(this, delta, a, b, items);
  }

  is_inside(
    delta: DrawingDelta,
    p: Coordinate,
    is_selected: boolean,
  ): IsInsideResult {
    // Check the handles
    let a = UtilityService.rotateMsg(delta, p);
    a = [a[0] - delta.dx, a[1] - delta.dy];
    return this.is_inside_item(a, is_selected);
  }

  // Determine if an point is inside this object
  // We return the handle number or -1 for not inside
  is_inside_item(p: Coordinate, is_selected: boolean): IsInsideResult {
    // Check the handles
    if (is_selected) {
      let h = this.handles();
      for (let i = 0; i < h.length; ++i) {
        let px = 4;
        let a = [h[i][0] - px, h[i][1] - px];
        let b = [h[i][0] + px, h[i][1] + px];
        if (this._isPointInsideRect(p, a, b)) {
          return { item: this.item, handle: i + 1, distance: 0 };
        }
      }
    }

    let np = this._nearestPoint(p, this.item.d_points);
    let r = np.point;
    let dr = (r[0] - p[0]) * (r[0] - p[0]) + (r[1] - p[1]) * (r[1] - p[1]);

    if (dr < 100) {
      return {
        item: this.item,
        handle: np.index + 1000,
        distance: Math.sqrt(dr),
      };
    }

    // Sorry, not me
    return null;
  }

  distanceFromPoint(p: Coordinate, snap_p: Coordinate) {
    let np = this._nearestPoint(snap_p, this.item.d_points);
    let r = np.point;
    let dr = (r[0] - p[0]) * (r[0] - p[0]) + (r[1] - p[1]) * (r[1] - p[1]);

    return { distance: dr, point: r };
  }

  drag_handle(tracker: ViewTracker, items: DocItem[], handle: number) {
    if (handle >= 1000) {
      handle = handle - 1000;
      if (tracker._dragArray && handle < this.item.d_points.length) {
        // Move both endpoints of the line segment (same as updateWire)
        items = tracker._dragArray[handle].drag_handle(
          items,
          this.item.d_points[handle],
        );
        let nextHandle = handle + 1;
        if (nextHandle >= this.item.d_points.length) {
          nextHandle = 0;
        }
        return tracker._dragArray[nextHandle].drag_handle(
          items,
          this.item.d_points[nextHandle],
        );
      }
    } else if (handle >= 1) {
      handle = handle - 1;
      if (tracker._dragArray && handle < this.item.d_points.length) {
        return tracker._dragArray[handle].drag_handle(
          items,
          this.item.d_points[handle],
        );
      }
    } else if (handle === 0) {
      for (let i = 0; i < this.item.d_points.length; ++i) {
        items = tracker._dragArray[i].drag_handle(
          items,
          this.item.d_points[i],
        );
      }
    }

    return items;
  }

  _move_line(tracker: ViewTracker, snap: Snap, p: Coordinate, i: number) {
    if (i >= this.item.d_points.length) {
      return {
        obj: this.item,
        r: [0, 0],
      };
    }

    let old = this.item.d_points[i];
    let point = this.item.d_points[i].slice();

    // Restore the actual position (without snap)
    if (tracker.a != null) {
      point[0] = tracker.a[0];
      point[1] = tracker.a[1];
    }

    // Perform the move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time...
    tracker.a = [point[0], point[1]];

    // ... and snap
    point = snap.snap(point);

    // Calculate the movement
    let dp = [old[0] - point[0], old[1] - point[1]];

    if (dp[0] !== 0 || dp[1] !== 0) {
      let j = i + 1;
      if (j >= this.item.d_points.length) {
        j = 0;
      }

      const obj = update(this.item, {
        d_points: {
          [i]: { $set: point },
          [j]: {
            $set: [
              this.item.d_points[j][0] - dp[0],
              this.item.d_points[j][1] - dp[1],
            ],
          },
        },
      });

      // Return movement
      return {
        obj: obj,
        r: dp,
      };
    } else {
      return {
        obj: this.item,
        r: [0, 0],
      };
    }
  }

  _move_point(tracker: ViewTracker, snap: Snap, p: Coordinate, i: number) {
    if (i >= this.item.d_points.length) {
      return {
        obj: this.item,
        r: [0, 0],
      };
    }

    let old = this.item.d_points[i];
    let point = this.item.d_points[i].slice();

    // Restore the actual position (without snap)
    if (tracker.a != null) {
      point[0] = tracker.a[0];
      point[1] = tracker.a[1];
    }

    // Perform the move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time...
    tracker.a = [point[0], point[1]];

    // ... and snap
    point = snap.snap(point);

    let obj = this.item;
    if (
      point[0] !== this.item.d_points[i][0] ||
      point[1] !== this.item.d_points[i][1]
    ) {
      obj = update(this.item, {
        d_points: {
          [i]: { $set: point },
        },
      });
    }

    // Return movement
    return {
      obj: obj,
      r: [old[0] - obj.d_points[i][0], old[1] - obj.d_points[i][1]],
    };
  }

  mousemove_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; display: boolean } {
    return { item: this.item, display: false };
  }

  mouse_move(tracker: ViewTracker, p: Coordinate, handle: number, snap: Snap) {
    let r = [0, 0];
    let obj = this.item;

    if (handle >= 1000) {
      // Move line
      ({ r, obj } = this._move_line(tracker, snap, p, handle - 1000));
    } else if (handle === 0) {
      // Move the first handle
      ({ r, obj } = this._move_point(tracker, snap, p, 0));

      // Now move the rest the same way
      if (r[0] !== 0 || r[1] !== 0) {
        for (let i = 1; i < this.item.d_points.length; ++i) {
          obj.d_points[i] = [
            obj.d_points[i][0] - r[0],
            obj.d_points[i][1] - r[1],
          ];
        }
      }
    } else if (handle >= 1) {
      // Point handle
      ({ r, obj } = this._move_point(tracker, snap, p, handle - 1));
    }

    return { r, obj };
  }

  relative_move(r: Coordinate) {
    if (r[0] === 0 && r[1] === 0) {
      return this.item;
    }

    let obj = update(this.item, {
      d_points: { $set: this.item.d_points.slice(0) },
    });

    // Now move the points
    for (let i = 0; i < this.item.d_points.length; ++i) {
      obj.d_points[i][0] -= r[0];
      obj.d_points[i][1] -= r[1];
    }

    return obj;
  }

  dragStart(tracker: ViewTracker, items: DocItem[], handle: number) {
    tracker._dragArray = [];
    for (let i = 0; i < this.item.d_points.length; ++i) {
      tracker._dragArray[i] = new dragObject();
      tracker._dragArray[i].wire_type = DocItemTypes.BusWire;
      tracker._dragArray[i].move_object(
        items,
        this.item,
        this.item.d_points[i],
      );
    }

    return { items: items, obj: this.item };
  }

  dragEnd(tracker: ViewTracker, items: DocItem[], handle: number) {
    tracker._dragArray = null;

    return { items: items, obj: this.item };
  }

  //
  // Calculate the nearest point on a line (assuming line is infinite)
  //
  _nearestPointOnLineInf(a: Coordinate, p1: Coordinate, p2: Coordinate) {
    // Is the line horizontal or vertical?
    if (p1[0] === p2[0]) {
      // Vertical
      return [p1[0], a[1]];
    }
    if (p1[1] === p2[1]) {
      // Horizontal
      return [a[0], p1[1]];
    }

    // First convert to formula: y = mx + k
    let m = (p2[1] - p1[1]) / (p2[0] - p1[0]);
    let k = p1[1] - m * p1[0];

    // Solve for X & Y
    let x = (a[0] + m * a[1] - m * k) / (m * m + 1);
    let y = m * ((a[0] + m * a[1] - m * k) / (m * m + 1)) + k;

    return [x, y];
  }

  //
  // Calculate the nearest point on a line (assuming line is finite)
  //
  _nearestPointOnLine(a: Coordinate, p1: Coordinate, p2: Coordinate) {
    let r = this._nearestPointOnLineInf(a, p1, p2);

    // Is this point outside of the line?
    // See if the point is outside of the bounding box
    // created by p1 & p2
    let x1 = Math.min(p1[0], p2[0]);
    let y1 = Math.min(p1[1], p2[1]);
    let x2 = Math.max(p1[0], p2[0]);
    let y2 = Math.max(p1[1], p2[1]);

    if (r[0] < x1 || r[0] > x2 || r[1] < y1 || r[1] > y2) {
      // Ok, outside of the line, so returned the nearest
      // point (p1 or p2) to the line
      let d1 =
        (r[0] - p1[0]) * (r[0] - p1[0]) + (r[1] - p1[1]) * (r[1] - p1[1]);
      let d2 =
        (r[0] - p2[0]) * (r[0] - p2[0]) + (r[1] - p2[1]) * (r[1] - p2[1]);

      if (d1 < d2) {
        r = p1;
      } else {
        r = p2;
      }
    }

    return r;
  }

  //
  // Calculate the nearest point on the wire
  //
  _nearestPoint(a: Coordinate, points: Coordinate[]) {
    let d = -1;
    let p = null;
    let index = -1;
    for (let i = 0; i < points.length; ++i) {
      let p1 = points[i];
      let p2 = points[i + 1];

      if (i >= points.length - 1) {
        // Don't close wire
        break;
      }

      let r = this._nearestPointOnLine(a, p1, p2);
      let dr = (r[0] - a[0]) * (r[0] - a[0]) + (r[1] - a[1]) * (r[1] - a[1]);
      if (dr < d || d === -1) {
        p = r;
        d = dr;
        index = i;
      }
    }

    return { point: p, index: index };
  }

  //
  // Handle creating a new version of this object
  //

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    let snap_p = snap.snap(p);

    let t = this.item.d_points.length;
    let d_points = this.item.d_points.slice();

    // snap the point normally
    d_points[t] = snap.snap(p);

    if (t === 0) {
      d_points[1] = [snap_p[0], snap_p[1]];

      if (this.lock_90) {
        d_points[2] = [snap_p[0], snap_p[1]];
        tracker._primary_horz = false;
      }
    }

    let r = update(this.item, {
      d_points: { $set: d_points },
    });

    return { obj: r, end: false, items: items };
  }

  complete_add() {
    let t = this.item.d_points.length;
    let d_points = this.item.d_points.slice();
    while (this.lock_90 && t > 2) {
      d_points.pop();
      --t;
    }

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  move_add(p: Coordinate, snap: Snap, tracker: ViewTracker, items: DocItem[]) {
    let d_points = this.item.d_points.slice();
    let t = this.item.d_points.length - 1;

    // No, so just snap the point normally
    let snap_p = snap.snap(p);

    if (this.lock_90 && t > 1) {
      {
        let dx = Math.abs(d_points[t - 2][0] - p[0]);
        let dy = Math.abs(d_points[t - 2][1] - p[1]);

        // If we are close to the starting point, then we must select
        // select the direction of the primary point
        if (tracker._primary_horz == null || (dx < 10 && dy < 10)) {
          if (dx > dy) {
            d_points[t - 1][1] = d_points[t - 2][1];
            tracker._primary_horz = true;
          } else {
            d_points[t - 1][0] = d_points[t - 2][0];
            tracker._primary_horz = false;
          }
        }
      }
      if (tracker._primary_horz) {
        d_points[t - 1][0] = snap_p[0];
      } else {
        d_points[t - 1][1] = snap_p[1];
      }
    }

    d_points[t] = snap_p;

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  drag_add(p: Coordinate, snap: Snap, tracker: ViewTracker, items: DocItem[]) {
    return this.move_add(p, snap, tracker, items);
  }

  is_horizontal() {
    // Horizontal lines have an unchanging y
    if (this.item.d_points.length > 1) {
      return this.item.d_points[0][1] === this.item.d_points[1][1];
    }

    return false;
  }

  is_vertical() {
    // Horizontal lines have an unchanging x
    if (this.item.d_points.length > 1) {
      return this.item.d_points[0][0] === this.item.d_points[1][0];
    }

    return false;
  }

  is_connected(test_wire: DocItem) {
    if (
      test_wire !== this.item &&
      test_wire.NodeName === DocItemTypes.BusWire
    ) {
      // Perform the check
      for (let i = 0; i < 2; ++i) {
        for (let j = 0; j < 2; ++j) {
          if (
            this.item.d_points[i][0] === test_wire.d_points[j][0] &&
            this.item.d_points[i][1] === test_wire.d_points[j][1]
          ) {
            return { first: i, second: j };
          }
        }
      }
    }

    return null;
  }

  newWire(d_points: Coordinate[]): dsnBusWire {
    return {
      _id: get_global_id(),
      NodeName: DocItemTypes.BusWire,
      d_points: d_points,
    };
  }

  end_add(tracker: ViewTracker, items: DocItem[]) {
    let t = this.item.d_points.length - 1;
    let d_points = this.item.d_points.slice();
    let end = false;

    if (
      this.lock_90 &&
      t > 2 &&
      (d_points[0][0] !== d_points[1][0] || d_points[0][1] !== d_points[1][1])
    ) {
      // Has the user clicked twice in the same point or attached to a magnetic point?
      if (
        d_points[t - 1][0] === d_points[t - 2][0] &&
        d_points[t - 1][1] === d_points[t - 2][1]
      ) {
        // Remove last points
        d_points.pop();
        d_points.pop();

        end = true;
      } else {
        let ins = this.newWire([
          d_points.shift(),
          [d_points[0][0], d_points[0][1]],
        ]);
        items = items.slice();
        items.push(ins);

        end = false;
      }
    }

    tracker._primary_horz = null;

    let r = update(this.item, {
      d_points: { $set: d_points },
    });

    return { item: r, end: end, items: items };
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
  }

  rotate(angle: number, rotation_centre: Coordinate) {
    if (!rotation_centre) {
      let b = this.getBoundingRect();
      rotation_centre = [(b.x1 + b.x2) / 2.0, (b.y1 + b.y2) / 2.0];
    }

    let d_points = this.item.d_points.slice();

    // Rotate each point
    for (let i = 0; i < d_points.length; ++i) {
      d_points[i] = UtilityService.rotate_point(
        angle,
        rotation_centre,
        d_points[i],
      );
    }

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  find(findText: string): FindResult[] {
    return [];
  }

  can_rotate() {
    return false;
  }
}
