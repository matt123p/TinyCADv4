//
// This the base class for the electrical items which are
// based on a point
//

import update from 'immutability-helper';
import {
  SimpleAdd,
  IsInside,
  DrawingDelta,
  IsInsideResult,
} from './updateInterfaces';
import { Snap } from './snap';
import { DocItem, dsnPointBase, Coordinate } from '../model/dsnItem';
import { UtilityService } from '../util/utilityService';
import { Size } from '../model/dsnDrawing';
import { ViewTracker, FindResult } from '../model/dsnView';

export abstract class updatePointBase implements SimpleAdd, IsInside {
  public abstract area_a(): Size;
  public abstract area_b(): Size;

  constructor(public item: dsnPointBase) {}

  x() {
    return this.item.point[0];
  }

  y() {
    return this.item.point[1];
  }

  // Get the list of handles associated with a selected
  // object
  handles(): Coordinate[] {
    return [];
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -1: // Not selected
        return 'auto';
      // case 0:		// Middle
      default:
        // Anything else
        return 'move';
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

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    return UtilityService.simpleIsInsideRect(this, delta, a, b, items);
  }

  // Does the rectangle completely contain this item?
  is_inside_rect_item(a: Coordinate, b: Coordinate) {
    var area_a = this.area_a();
    var area_b = this.area_b();

    return (
      area_a[0] >= a[0] &&
      area_a[1] >= a[1] &&
      area_b[0] <= b[0] &&
      area_b[1] <= b[1]
    );
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
    var area_a = this.area_a();
    var area_b = this.area_b();

    // First is it inside the rectangle?
    if (this._isPointInsideRect(p, area_a, area_b)) {
      // It is inside the main object
      return { item: this.item as DocItem, handle: 0, distance: 0 };
    }

    // Sorry, not me
    return null;
  }

  _move(tracker: ViewTracker, snap: Snap, p: Coordinate, items: DocItem[]) {
    // Restore the actual position (without snap)
    let point = this.item.point;
    if (tracker.a != null) {
      point = [tracker.a[0], tracker.a[1]];
    }

    // Move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time
    tracker.a = point.slice();

    // Snap
    point = snap.snap(point);

    if (point[0] !== this.item.point[0] || point[1] !== this.item.point[1]) {
      return update(this.item, {
        point: { $set: point },
      });
    } else {
      return this.item;
    }
  }

  mouse_move(
    tracker: ViewTracker,
    p: Coordinate,
    handle: number,
    snap: Snap,
    items?: DocItem[],
  ): { obj: DocItem; r: Coordinate } {
    let obj = this.item;
    var old_a = [this.item.point[0], this.item.point[1]];

    switch (handle) {
      case 0: // Whole object move
        obj = this._move(tracker, snap, p, items);
        break;
    }

    return {
      obj: obj as DocItem,
      r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
    };
  }

  relative_move(r: Coordinate): DocItem {
    if (r[0] !== 0 || r[1] !== 1) {
      return update(this.item, {
        point: { $set: [this.item.point[0] - r[0], this.item.point[1] - r[1]] },
      }) as DocItem;
    } else {
      return this.item as DocItem;
    }
  }

  //
  // Handle creating a new version of this object
  //

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    let r = update(this.item, {
      point: { $set: snap.snap(p) },
    }) as DocItem;

    return { obj: r, end: true, items: items };
  }

  end_add(
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; end: boolean; items: DocItem[] } {
    return { item: this.item as DocItem, end: true, items: items };
  }

  complete_add(): DocItem {
    return this.item as DocItem;
  }

  getBoundingRect() {
    var a = this.area_a();
    var b = this.area_b();
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  }

  can_rotate() {
    return false;
  }
}
