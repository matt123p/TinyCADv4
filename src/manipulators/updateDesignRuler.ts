import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import {
  SimpleAdd,
  IsInsideResult,
  DrawingDelta,
  IsInside,
  ContextMenuList,
} from './updateInterfaces';
import { Snap } from './snap';
import { dsnDesignRuler, Coordinate, DocItem } from '../model/dsnItem';
import { ViewTracker, FindResult } from '../model/dsnView';

//
// The simple rectangle object
//
export class updateDesignRuler implements SimpleAdd, IsInside {
  constructor(public item: dsnDesignRuler) {}

  // Does the rectangle completely contain this item?
  is_inside_rect_item(a: Coordinate, b: Coordinate) {
    // It is outside
    return false;
  }

  x() {
    if (this.item.rotation === 0) {
      return 0;
    } else {
      return this.item.point[0];
    }
  }

  y() {
    if (this.item.rotation === 0) {
      return this.item.point[1];
    } else {
      return 0;
    }
  }

  handles(): Coordinate[] {
    return [];
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
    // Sorry, not me
    var hit = false;
    if (this.item.rotation === 0) {
      hit = Math.abs(this.item.point[1] - p[1]) < 5;
    } else {
      hit = Math.abs(this.item.point[0] - p[0]) < 5;
    }

    return hit ? { item: this.item, handle: 0, distance: 0 } : null;
  }

  _move(tracker: ViewTracker, snap: Snap, p: Coordinate) {
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

  mouse_move(tracker: ViewTracker, p: Coordinate, handle: number, snap: Snap) {
    let obj = this.item;
    var old_a = [this.item.point[0], this.item.point[1]];

    switch (handle) {
      case 0: // Whole object move
        obj = this._move(tracker, snap, p);
        break;
    }

    return {
      obj: obj,
      r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
    };
  }

  relative_move(r: Coordinate): DocItem {
    if (r[0] !== 0 || r[1] !== 1) {
      return update(this.item, {
        point: { $set: [this.item.point[0] - r[0], this.item.point[1] - r[1]] },
      });
    } else {
      return this.item;
    }
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

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
  }

  // Menu Handlers
  rotate(angle: number, rotation_centre?: Coordinate) {
    let rotation = this.item.rotation + angle;
    if (rotation > 1) {
      rotation = 0;
    }
    if (rotation < 0) {
      rotation = 1;
    }

    let point = this.item.point;
    if (rotation_centre) {
      point = UtilityService.rotate_point(
        angle,
        rotation_centre,
        this.item.point,
      );
    }

    return update(this.item, {
      point: { $set: point },
      rotation: { $set: rotation },
    });
  }

  can_rotate() {
    return true;
  }

  menu_rotate_right() {
    return this.rotate(1);
  }

  menu_rotate_left() {
    return this.rotate(-1);
  }

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    let r = update(this.item, {
      point: { $set: snap.snap(p) },
    });

    return { obj: r, end: true, items: items };
  }

  end_add(tracker: ViewTracker, items: DocItem[]) {
    return { item: this.item, end: true, items: items };
  }

  complete_add() {
    return this.item;
  }

  getBoundingRect() {
    if (this.item.rotation === 0) {
      const y = this.item.point[1];
      return { x1: 0, y1: y, x2: 0, y2: y };
    } else {
      const x = this.item.point[0];
      return { x1: x, y1: 0, x2: x, y2: 0 };
    }
  }

  find(findText: string): FindResult[] {
    return [];
  }
}
