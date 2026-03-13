//
// This the base class for the drawable items which are
// based on rectangles
//

import update from 'immutability-helper';
import { UtilityLine } from '../util/utilityLine';
import { UtilityService } from '../util/utilityService';
import {
  SimpleAdd,
  MoveAdd,
  CssStyle,
  IsInsideResult,
  DrawingDelta,
  IsInside,
  ContextMenuList,
  ContextualMenuItemType,
} from './updateInterfaces';
import { Snap } from './snap';
import { dsnLine, Coordinate, DocItem } from '../model/dsnItem';
import { ViewTracker, FindResult } from '../model/dsnView';

export class updateLine implements SimpleAdd, MoveAdd, IsInside {
  private _handles: Coordinate;

  constructor(public item: dsnLine) {}

  style() {
    var s: CssStyle = {};
    if (this.item.filled && this.item.polygon) {
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

      var dot = Math.max(4, this.item.line_width);
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

  x() {
    return this.getBoundingRect().x1;
  }

  y() {
    return this.getBoundingRect().y1;
  }

  // Get the bounding rectangle for this polyline/polygon
  getBoundingRect() {
    var min_x = 0;
    var min_y = 0;
    var max_x = 0;
    var max_y = 0;

    var first = true;
    for (let i = 0; i < this.item.d_points.length; ++i) {
      var p = this.item.d_points[i];
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
    if (!this._handles) {
      this._handles = [];

      // Now add the handles for the points
      for (let i = 0; i < this.item.d_points.length; ++i) {
        var p = this.item.d_points[i];
        this._handles.push([p[0], p[1]]);
      }
    }

    return this._handles;
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -1: // Not selected
        return 'auto';
      case 0: // Middle
        return 'move';
      default:
        // Anything else
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
    for (var i = 0; i < this.item.d_points.length; ++i) {
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
      var h = this.handles();
      if (h) {
        for (var i = 0; i < h.length; ++i) {
          var px = 4;
          var a = [h[i][0] - px, h[i][1] - px];
          var b = [h[i][0] + px, h[i][1] + px];
          if (this._isPointInsideRect(p, a, b)) {
            return { item: this.item, handle: i + 1, distance: 0 };
          }
        }
      }
    }

    var r = this._nearestPoint(p, this.item.d_points, this.item.polygon).point;
    var dr = (r[0] - p[0]) * (r[0] - p[0]) + (r[1] - p[1]) * (r[1] - p[1]);

    if (dr < 100) {
      return { item: this.item, handle: 0, distance: Math.sqrt(dr) };
    }

    if (
      this.item.filled &&
      this.item.fill_colour !== 'none' &&
      this.item.polygon
    ) {
      // Check if it is inside the polygon
      if (
        UtilityService.isPointInsidePolygon(p, this._getFlattenedPolyPoints())
      ) {
        return { item: this.item, handle: 0, distance: 0 };
      }
    }

    // Sorry, not me
    return null;
  }

  // Get the points for the polygon, expanding any curves
  _getFlattenedPolyPoints(): Coordinate[] {
    const points = this.item.d_points;
    const polygon = this.item.polygon;
    const polyPoints: Coordinate[] = [];

    for (let i = 0; i < points.length; ++i) {
      // Add the current point (start of segment)
      // If previous segment was a curve, this point was added as end of curve?
      // No, let's just add points in order.

      // If we jumped here because of ++i (skip control), points[i] is the end of curve/start of next segment.
      polyPoints.push([points[i][0], points[i][1]]);

      let p1 = points[i];
      let p2 = points[i + 1];

      if (i >= points.length - 1) {
        if (polygon) {
          // Close polygon
          p2 = points[0];
        } else {
          // Don't close polygon
          break;
        }
      }

      // Is this a curve?
      if (p2.length > 2) {
        // Check for cubic Bézier (two consecutive control points)
        let p3 = points[i + 2];
        if (p3 && p3.length > 2) {
          // Cubic: p1 = start, p2 = cp1, p3 = cp2, p4 = endpoint
          let p4;
          if (i + 3 >= points.length) {
            if (polygon) {
              p4 = points[(i + 3) % points.length];
            } else {
              p4 = points[points.length - 1];
            }
          } else {
            p4 = points[i + 3];
          }
          const curve = this._FlatternCubicCurve(p1, [p2[0], p2[1]], [p3[0], p3[1]], p4);
          for (let k = 1; k < curve.length; k++) {
            polyPoints.push(curve[k]);
          }
          i += 2;
        } else {
          // Quadratic
          if (i === points.length - 1) {
            if (polygon) {
              p3 = points[1];
            }
          } else if (i === points.length - 2) {
            if (polygon) {
              p3 = points[0];
            }
          } else {
            p3 = points[i + 2];
          }

          const curve = this._FlatternCurve(p1, [p2[0], p2[1]], p3);
          for (let k = 1; k < curve.length; k++) {
            polyPoints.push(curve[k]);
          }

          ++i;
        }
      }
    }
    return polyPoints;
  }

  _move(
    tracker: ViewTracker,
    snap: Snap,
    p: Coordinate,
  ): { obj: DocItem; r: Coordinate } {
    // Move the first handle
    let { r, obj } = this._move_point(tracker, snap, p, 0);

    // Now move the rest the same way
    if (r[0] !== 0 || r[1] !== 0) {
      for (let i = 1; i < obj.d_points.length; ++i) {
        obj.d_points[i] = this._make_control(
          [obj.d_points[i][0] - r[0], obj.d_points[i][1] - r[1]],
          obj.d_points[i].length > 2,
        );
      }
    }

    return {
      obj: obj,
      r: r,
    };
  }

  _make_control(p: number[], control: boolean) {
    if (control && p.length == 2) {
      return [...p, 1];
    }
    return p;
  }

  _move_point(tracker: ViewTracker, snap: Snap, p: Coordinate, i: number) {
    if (i < 0 || i >= this.item.d_points.length) {
      return { obj: this.item, r: [0, 0] };
    }

    let old = this.item.d_points[i];
    let point = this.item.d_points[i].slice();

    // Restore the actual position (without snap)
    if (tracker.a != null) {
      point[0] = tracker.a[0];
      point[1] = tracker.a[1];
    }

    // Perform the move
    point = this._make_control(
      [point[0] + p[0], point[1] + p[1]],
      old.length > 2,
    );

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
      this._handles = null;
    }

    // Return movement
    return {
      obj: obj,
      r: [old[0] - obj.d_points[i][0], old[1] - obj.d_points[i][1]],
    };
  }

  mouse_move(tracker: ViewTracker, p: Coordinate, handle: number, snap: Snap) {
    let r: { obj: DocItem; r: Coordinate } = {
      obj: this.item,
      r: [0, 0],
    };

    switch (handle) {
      case 0: // Whole object move
        r = this._move(tracker, snap, p);
        break;
      default:
        // Point handle
        r = this._move_point(tracker, snap, p, handle - 1);
    }

    return r;
  }

  relative_move(r: Coordinate) {
    if (r[0] === 0 && r[1] === 0) {
      return this.item;
    }

    let obj = update(this.item, {
      d_points: { $set: this.item.d_points.slice(0) },
    });

    // Now move the points
    for (let i = 0; i < obj.d_points.length; ++i) {
      let control_point = obj.d_points[i].length > 2;
      obj.d_points[i] = [obj.d_points[i][0] - r[0], obj.d_points[i][1] - r[1]];
      if (control_point) {
        obj.d_points[i].push(1);
      }
    }

    this._handles = null;

    return obj;
  }

  _sqr(z: number) {
    return z * z;
  }

  //
  // Flattern out the bezier curves in our line
  // Quadratic Bézier: 3 points (p0, p1, p2)
  //
  _FlatternCurve(p0: Coordinate, p1: Coordinate, p2: Coordinate) {
    var r = [];
    for (var t = 0; t < 1.0; t += 0.1) {
      var a = this._sqr(1.0 - t);
      var b = 2 * (1.0 - t) * t;
      var c = this._sqr(t);
      var x = a * p0[0] + b * p1[0] + c * p2[0];
      var y = a * p0[1] + b * p1[1] + c * p2[1];
      r.push([x, y]);
    }

    return r;
  }

  //
  // Flattern out a cubic bezier curve
  // Cubic Bézier: 4 points (p0, cp1, cp2, p3)
  //
  _FlatternCubicCurve(p0: Coordinate, cp1: Coordinate, cp2: Coordinate, p3: Coordinate) {
    var r = [];
    for (var t = 0; t < 1.0; t += 0.1) {
      var u = 1.0 - t;
      var a = u * u * u;
      var b = 3 * u * u * t;
      var c = 3 * u * t * t;
      var d = t * t * t;
      var x = a * p0[0] + b * cp1[0] + c * cp2[0] + d * p3[0];
      var y = a * p0[1] + b * cp1[1] + c * cp2[1] + d * p3[1];
      r.push([x, y]);
    }
    r.push([p3[0], p3[1]]);

    return r;
  }

  _nearestPointOnCurve(
    a: Coordinate,
    p0: Coordinate,
    p1: Coordinate,
    p2: Coordinate,
  ) {
    // First flattern
    var curve = this._FlatternCurve(p0, p1, p2);

    // Now find the nearest point...
    return this._nearestPoint(a, curve, false).point;
  }

  _nearestPointOnCubicCurve(
    a: Coordinate,
    p0: Coordinate,
    cp1: Coordinate,
    cp2: Coordinate,
    p3: Coordinate,
  ) {
    var curve = this._FlatternCubicCurve(p0, cp1, cp2, p3);
    return this._nearestPoint(a, curve, false).point;
  }

  //
  // Calculate the nearest point on the polygon/polylines
  //
  _nearestPoint(
    a: Coordinate,
    points: Coordinate[],
    polygon: boolean,
  ): { point: Coordinate; index: number } {
    var d = -1;
    var p = null;
    var index = -1;
    for (var i = 0; i < points.length; ++i) {
      var p1 = points[i];
      var p2 = points[i + 1];

      if (i >= points.length - 1) {
        if (polygon) {
          // Close polygon
          p2 = points[0];
        } else {
          // Don't close polygon
          break;
        }
      }

      var r;
      // Is this a curve?
      if (p2.length > 2) {
        // Check if this is a cubic Bézier (two consecutive control points)
        var p3 = points[i + 2];
        if (p3 && p3.length > 2) {
          // Cubic: p1 = start, p2 = cp1, p3 = cp2, p4 = endpoint
          var p4;
          if (i + 3 >= points.length) {
            if (polygon) {
              p4 = points[(i + 3) % points.length];
            } else {
              p4 = points[points.length - 1];
            }
          } else {
            p4 = points[i + 3];
          }
          r = this._nearestPointOnCubicCurve(a, p1, [p2[0], p2[1]], [p3[0], p3[1]], p4);
          i += 2;
        } else {
          // Quadratic: p1 = start, p2 = control, p3 = endpoint
          if (i === points.length - 1) {
            if (polygon) {
              p3 = points[1];
            }
          } else if (i === points.length - 2) {
            if (polygon) {
              p3 = points[0];
            }
          } else {
            p3 = points[i + 2];
          }

          r = this._nearestPointOnCurve(a, p1, [p2[0], p2[1]], p3);
          ++i;
        }
      } else {
        r = UtilityLine.nearestPointOnLine(a, p1, p2);
      }
      var dr = (r[0] - a[0]) * (r[0] - a[0]) + (r[1] - a[1]) * (r[1] - a[1]);

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
    var snap_p = snap.snap(p);

    let d_points = this.item.d_points.slice();
    var t = this.item.d_points.length;

    // Has the user returned to the beginning?
    if (t > 2) {
      if (d_points[0][0] === snap_p[0] && d_points[0][1] === snap_p[1]) {
        d_points.pop();

        let r2 = update(this.item, {
          polygon: { $set: true },
          d_points: { $set: d_points },
        });

        // Yep, so end it here!
        return { obj: r2, end: true, items: items };
      }
    }

    d_points[t] = snap_p;

    if (t === 0) {
      d_points[1] = snap_p;
    }

    this._handles = null;

    let r = update(this.item, {
      d_points: { $set: d_points },
    });

    return { obj: r, end: false, items: items };
  }

  move_add(p: Coordinate, snap: Snap, tracker: ViewTracker, items: DocItem[]) {
    var t = this.item.d_points.length - 1;
    let d_points = this.item.d_points.slice();

    var snap_p = snap.snap(p);
    d_points[t] = snap_p;
    this._handles = null;

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  end_add(tracker: ViewTracker, items: DocItem[]) {
    return { item: this.item, end: false, items: items };
  }

  complete_add() {
    return this.item;
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    // Has the user clicked on a handle?  If so,
    // then we can display a different message to if
    // they have clicked on a different area of the line
    var handle = this.is_inside_item(p, true)?.handle;
    var r = items;
    if (handle < 1 || handle == null) {
      r.push({
        key: 'divider_100',
        itemType: ContextualMenuItemType.Divider,
      });
      r.push({
        key: 'add_menu',
        text: 'Add',
        subMenuProps: {
          items: [
            {
              key: 'user_add_handle',
              iconProps: {
                iconName: 'CircleAdditionSolid',
              },
              text: 'Add Point',
            },
            {
              key: 'user_add_curve_quadratic',
              iconProps: {
                iconName: 'Add',
              },
              text: 'Add Quadratic Curve',
            },
            {
              key: 'user_add_curve_cubic',
              iconProps: {
                iconName: 'Add',
              },
              text: 'Add Cubic Curve',
            },
          ],
        },
      });
    } else if (this.item.d_points.length > 2) {
      r.push({
        key: 'divider_101',
        itemType: ContextualMenuItemType.Divider,
      });
      if (this.item.d_points[handle - 1].length > 2) {
        r.push({
          key: 'user_del_handle',
          iconProps: {
            iconName: 'SkypeCircleMinus',
          },
          text: 'Remove Curve',
        });
      } else {
        r.push({
          key: 'user_del_handle',
          iconProps: {
            iconName: 'SkypeCircleMinus',
          },
          text: 'Delete Point',
        });
      }
    }

    if (this.item.d_points.length > 2) {
      r.push({
        key: 'divider_103',
        itemType: ContextualMenuItemType.Divider,
      });
      if (this.item.polygon) {
        r.push({
          key: 'make_polyline',
          iconProps: {
            iconName: 'Line',
          },
          text: "Don't close polygon",
        });
      } else {
        r.push({
          key: 'make_polygon',
          iconProps: {
            iconName: 'TriangleShape',
          },
          text: 'Close polygon',
        });
      }
    }

    return r;
  }

  // Menu Handlers
  menu_user_add_handle(p: Coordinate, snap: Snap) {
    let d_points = this.item.d_points.slice();

    // Find the insertion point
    let np = this._nearestPoint(p, this.item.d_points, this.item.polygon);
    p = snap.snap(np.point);
    d_points.splice(np.index + 1, 0, p);
    this._handles = null;

    let r = update(this.item, {
      d_points: { $set: d_points },
    });

    return r;
  }

  menu_user_add_curve(p: Coordinate, snap: Snap) {
    return this.menu_user_add_curve_quadratic(p, snap);
  }

  private _insertCurveControlPoints(
    p: Coordinate,
    snap: Snap,
    controlPointCount: 1 | 2,
  ) {
    let d_points = this.item.d_points.slice();

    // Find the insertion point
    let np = this._nearestPoint(p, this.item.d_points, this.item.polygon);
    const insertAt = np.index + 1;
    const start = this.item.d_points[np.index];
    const end =
      insertAt < this.item.d_points.length
        ? this.item.d_points[insertAt]
        : this.item.polygon
          ? this.item.d_points[0]
          : null;

    if (!start || !end || start.length > 2 || end.length > 2) {
      return this.item;
    }

    if (controlPointCount === 1) {
      const cp = [...snap.snap(np.point), 1];
      d_points.splice(insertAt, 0, cp);
    } else {
      const through = snap.snap(np.point);
      const cp1 = [
        start[0] + (2 / 3) * (through[0] - start[0]),
        start[1] + (2 / 3) * (through[1] - start[1]),
        1,
      ];
      const cp2 = [
        end[0] + (2 / 3) * (through[0] - end[0]),
        end[1] + (2 / 3) * (through[1] - end[1]),
        1,
      ];
      d_points.splice(insertAt, 0, cp1, cp2);
    }

    this._handles = null;

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  menu_user_add_curve_quadratic(p: Coordinate, snap: Snap) {
    return this._insertCurveControlPoints(p, snap, 1);
  }

  menu_user_add_curve_cubic(p: Coordinate, snap: Snap) {
    return this._insertCurveControlPoints(p, snap, 2);
  }

  menu_user_del_handle(p: Coordinate, snap: Snap) {
    let d_points = this.item.d_points.slice();
    var handle = this.is_inside_item(p, true)?.handle;

    if (handle > 0) {
      d_points.splice(handle - 1, 1);
    }
    this._handles = null;

    return update(this.item, {
      d_points: { $set: d_points },
    });
  }

  menu_make_polyline(p: Coordinate, snap: Snap) {
    return update(this.item, {
      polygon: { $set: false },
    });
  }

  menu_make_polygon(p: Coordinate, snap: Snap) {
    return update(this.item, {
      polygon: { $set: true },
    });
  }

  rotate(angle: number, rotation_centre?: Coordinate) {
    if (!rotation_centre) {
      let b = this.getBoundingRect();
      rotation_centre = [(b.x1 + b.x2) / 2.0, (b.y1 + b.y2) / 2.0];
    }

    let d_points = this.item.d_points.slice();

    // Rotate each point
    for (let i = 0; i < d_points.length; ++i) {
      d_points[i] = this._make_control(
        UtilityService.rotate_point(angle, rotation_centre, d_points[i]),
        d_points[i].length > 2,
      );
    }
    this._handles = null;

    return update(this.item, {
      d_points: { $set: d_points },
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

  find(findText: string): FindResult[] {
    return [];
  }

  mousemove_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; display: boolean } {
    return { item: this.item, display: false };
  }

  drag_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    return this.item;
  }
}
