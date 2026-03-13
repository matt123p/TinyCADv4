//
// This the base class for the drawable items which are
// based on rectangles
//

import update from 'immutability-helper';
import { UtilityLine } from '../util/utilityLine';
import { UtilityService } from '../util/utilityService';
import {
  SimpleAdd,
  CssStyle,
  IsInsideResult,
  DrawingDelta,
  IsInside,
} from './updateInterfaces';
import { Snap } from './snap';
import {
  dsnRectBase,
  Coordinate,
  DocItem,
  DocItemTypes,
} from '../model/dsnItem';
import { ViewTracker, FindResult } from '../model/dsnView';

export abstract class updateRectBase implements SimpleAdd, IsInside {
  public abstract getStyleSelector(): any;

  constructor(public item: dsnRectBase) {}

  x() {
    return this.item.point[0];
  }

  y() {
    return this.item.point[1];
  }

  getBoundingRect() {
    return {
      x1: this.item.point[0],
      y1: this.item.point[1],
      x2: this.item.point_b[0],
      y2: this.item.point_b[1],
    };
  }

  // note that angle is -1 for left and +1 for right
  rotate(angle: number, rotation_centre?: Coordinate): DocItem {
    if (!rotation_centre) {
      rotation_centre = [
        (this.item.point[0] + this.item.point_b[0]) / 2.0,
        (this.item.point[1] + this.item.point_b[1]) / 2.0,
      ];
    }

    let point = UtilityService.rotate_point(
      angle,
      rotation_centre,
      this.item.point,
    );
    let point_b = UtilityService.rotate_point(
      angle,
      rotation_centre,
      this.item.point_b,
    );

    // Now normalize the points
    let x1 = Math.min(point[0], point_b[0]);
    let y1 = Math.min(point[1], point_b[1]);
    let x2 = Math.max(point[0], point_b[0]);
    let y2 = Math.max(point[1], point_b[1]);

    return update(this.item, {
      point: { $set: [x1, y1] },
      point_b: { $set: [x2, y2] },
    }) as DocItem;
  }

  can_rotate() {
    return true;
  }

  menu_rotate_right(): DocItem {
    return this.rotate(1);
  }

  menu_rotate_left(): DocItem {
    return this.rotate(-1);
  }

  style() {
    var s: CssStyle = {};
    if (this.item.filled) {
      if (this.item.hatch > 0) {
        s.fill = `url(#hatch${this.item.hatch}${this.item.fill_colour}`;
      } else {
        s.fill = this.item.fill_colour;
      }
    } else {
      s.fill = 'none';
    }

    if (this.item.stroked) {
      s.stroke = this.item.line_colour;
      s.strokeWidth = this.item.line_width;

      var dot = this.item.line_width;
      var dash = 2 * dot;
      switch (+this.item.line_pattern) {
        case 1:
          s.strokeDasharray = dash;
          break;
        case 2:
          s.strokeDasharray = dot;
          break;
        case 3:
          s.strokeDasharray = dash + ' ' + dot + ' ' + dot + ' ' + dot;
          break;
        case 4:
          s.strokeDasharray =
            dash + ' ' + dot + ' ' + dot + ' ' + dot + ' ' + dot + ' ' + dot;
          break;
      }
    }

    return s;
  }

  // Get the list of handles associated with a selected
  // object
  handles() {
    return [
      [this.item.point[0], this.item.point[1]], // Top left
      [this.item.point_b[0], this.item.point[1]], // Top right

      [this.item.point[0], this.item.point_b[1]], // Bottom left
      [this.item.point_b[0], this.item.point_b[1]], // Bottom right

      [this.item.point[0], (this.item.point[1] + this.item.point_b[1]) / 2], // Mid left
      [(this.item.point[0] + this.item.point_b[0]) / 2, this.item.point[1]], // Mid top
      [this.item.point_b[0], (this.item.point[1] + this.item.point_b[1]) / 2], // Mid right
      [(this.item.point[0] + this.item.point_b[0]) / 2, this.item.point_b[1]], // Mid bottom
    ];
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -3: // Text icon
      case -2: // Text icon
        //        if (this.item.rotation === 1 || this.item.rotation === 3) {
        //          return "vertical-text";
        //        } else {
        return 'text';
      //      }
      case -1: // Not selected
        return 'auto';
      case 1: // Top left
        return 'nw-resize';
      case 2: // Top right
        return 'ne-resize';
      case 3: // Bottom left
        return 'sw-resize';
      case 4: // Bottom right
        return 'se-resize';
      case 5: // Mid left
        return 'w-resize';
      case 6: // Mid top
        return 'n-resize';
      case 7: // Mid right
        return 'e-resize';
      case 8: // Mid bottom
        return 's-resize';
      case -2: // Text icon
        return 'text';
      // case 0:		// Middle
      default:
        // Anything else
        return 'move';
    }
  }

  // Does the rectangle completely contain this item?
  is_inside_rect_item(a: Coordinate, b: Coordinate) {
    return (
      this.item.point[0] >= a[0] &&
      this.item.point[1] >= a[1] &&
      this.item.point_b[0] <= b[0] &&
      this.item.point_b[1] <= b[1]
    );
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
      var h = this.handles();
      for (var i = 0; i < h.length; ++i) {
        var px = 4;
        var a = [h[i][0] - px, h[i][1] - px];
        var b = [h[i][0] + px, h[i][1] + px];
        if (UtilityService.isPointInsideRect(p, a, b)) {
          return { item: this.item as DocItem, handle: i + 1, distance: 0 };
        }
      }
    }

    // Is this a filled rectangle, if so are we inside the rectangle (images are a special case)?
    if (
      (this.getStyleSelector().fill &&
        this.item.filled &&
        this.item.fill_colour !== 'none') ||
      this.item.NodeName === DocItemTypes.Image ||
      this.item.NodeName === DocItemTypes.Text
    ) {
      const x1 = Math.min(this.item.point[0], this.item.point_b[0]);
      const y1 = Math.min(this.item.point[1], this.item.point_b[1]);
      const x2 = Math.max(this.item.point[0], this.item.point_b[0]);
      const y2 = Math.max(this.item.point[1], this.item.point_b[1]);

      if (UtilityService.isPointInsideRect(p, [x1, y1], [x2, y2])) {
        // It is inside the main object
        return { item: this.item as DocItem, handle: 0, distance: 0 };
      }
    }

    // Is this point near one of our lines?
    let d1 = UtilityLine.distance2PointFromLine(
      p,
      [this.item.point[0], this.item.point[1]],
      [this.item.point_b[0], this.item.point[1]],
    );
    let d2 = UtilityLine.distance2PointFromLine(
      p,
      [this.item.point_b[0], this.item.point[1]],
      [this.item.point_b[0], this.item.point_b[1]],
    );
    let d3 = UtilityLine.distance2PointFromLine(
      p,
      [this.item.point_b[0], this.item.point_b[1]],
      [this.item.point[0], this.item.point_b[1]],
    );
    let d4 = UtilityLine.distance2PointFromLine(
      p,
      [this.item.point[0], this.item.point_b[1]],
      [this.item.point[0], this.item.point[1]],
    );

    let dr = Math.min(d1, d2, d3, d4);
    if (dr < 100) {
      return {
        item: this.item as DocItem,
        handle: 0,
        distance: Math.sqrt(dr),
      };
    }

    // Sorry, not me
    return null;
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

    // Has the point moved?
    if (this.item.point[0] !== point[0] || this.item.point[1] !== point[1]) {
      return update(this.item, {
        point: { $set: point },
        point_b: {
          $set: [
            this.item.point_b[0] + point[0] - this.item.point[0],
            this.item.point_b[1] + point[1] - this.item.point[1],
          ],
        },
      });
    } else {
      return this.item;
    }
  }

  _move_handle(
    tracker: ViewTracker,
    snap: Snap,
    p: Coordinate,
    a_x: boolean,
    a_y: boolean,
    b_x: boolean,
    b_y: boolean,
  ) {
    // Restore the actual position (without snap)
    let point = this.item.point.slice();
    let point_b = this.item.point_b.slice();

    if (tracker.a != null) {
      if (a_x) {
        point[0] = tracker.a[0];
      }
      if (a_y) {
        point[1] = tracker.a[1];
      }
    }
    if (tracker.b != null) {
      if (b_x) {
        point_b[0] = tracker.b[0];
      }
      if (b_y) {
        point_b[1] = tracker.b[1];
      }
    }

    // Perform the move
    if (a_x) {
      point[0] += p[0];
    }
    if (a_y) {
      point[1] += p[1];
    }
    if (b_x) {
      point_b[0] += p[0];
    }
    if (b_y) {
      point_b[1] += p[1];
    }

    // Save state for next time...
    tracker.a = point.slice();
    tracker.b = point_b.slice();

    // ... and snap
    var snap_a = snap.snap(point);
    var snap_b = snap.snap(point_b);
    if (a_x) {
      point[0] = snap_a[0];
    }
    if (a_y) {
      point[1] = snap_a[1];
    }
    if (b_x) {
      point_b[0] = snap_b[0];
    }
    if (b_y) {
      point_b[1] = snap_b[1];
    }

    if (
      this.item.point[0] !== point[0] ||
      this.item.point[1] !== point[1] ||
      this.item.point_b[0] !== point_b[0] ||
      this.item.point_b[1] !== point_b[1]
    ) {
      return update(this.item, {
        point: { $set: point },
        point_b: { $set: point_b },
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
  ): { obj: DocItem; r: Coordinate } {
    var old_a = [this.item.point[0], this.item.point[1]];
    var old_b = [this.item.point_b[0], this.item.point_b[1]];

    let obj = this.item;

    switch (handle) {
      case 0: // Whole object move
        obj = this._move(tracker, snap, p);
        break;
      case 1: // Top left
        obj = this._move_handle(tracker, snap, p, true, true, false, false);
        break;
      case 2: // Top right
        obj = this._move_handle(tracker, snap, p, false, true, true, false);
        break;
      case 3: // Bottom left
        obj = this._move_handle(tracker, snap, p, true, false, false, true);
        break;
      case 4: // Bottom right
        obj = this._move_handle(tracker, snap, p, false, false, true, true);
        break;
      case 5: // Mid left
        obj = this._move_handle(tracker, snap, p, true, false, false, false);
        break;
      case 6: // Mid top
        obj = this._move_handle(tracker, snap, p, false, true, false, false);
        break;
      case 7: // Mid right
        obj = this._move_handle(tracker, snap, p, false, false, true, false);
        break;
      case 8: // Mid bottom
        obj = this._move_handle(tracker, snap, p, false, false, false, true);
        break;
    }

    // Enforce a > b restriction for resize handles only.
    // Whole-object move must allow existing inverted rectangles to translate.
    if (
      handle !== 0 &&
      (obj.point[0] > obj.point_b[0] || obj.point[1] > obj.point_b[1])
    ) {
      obj.point = old_a;
      obj.point_b = old_b;
    }

    return {
      obj: obj as DocItem,
      r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
    };
  }

  relative_move(r: Coordinate): DocItem {
    if (r[0] !== 0 || r[1] !== 0) {
      return update(this.item, {
        point: { $set: [this.item.point[0] - r[0], this.item.point[1] - r[1]] },
        point_b: {
          $set: [this.item.point_b[0] - r[0], this.item.point_b[1] - r[1]],
        },
      }) as DocItem;
    } else {
      return this.item as DocItem;
    }
  }

  //
  // Handle creating a new version of this object
  //

  begin_add(
    p: Coordinate,
    tracker: ViewTracker,
    snap: Snap,
    items: DocItem[],
  ): { obj: DocItem; end: boolean; items: DocItem[] } {
    let snap_p = snap.snap(p);
    let r = update(this.item, {
      point: { $set: snap_p },
      point_b: { $set: snap_p },
    });

    return { obj: r as DocItem, end: false, items: items };
  }

  drag_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    var snap_p = snap.snap(p);
    return update(this.item, {
      point_b: { $set: snap_p },
    }) as DocItem;
  }

  end_add(
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; end: boolean; items: DocItem[] } {
    let end =
      this.item.point[0] !== this.item.point_b[0] &&
      this.item.point[1] !== this.item.point_b[1];
    return { item: this.item as DocItem, end: end, items: items };
  }

  complete_add(): DocItem {
    return this.item as DocItem;
  }
}
