import { DrawingDelta } from '../manipulators/updateInterfaces';
import { Coordinate, dsnRectBase, DocItem, dsnText } from '../model/dsnItem';
import { Updater } from '../manipulators/updateFactory';
import { isText } from '../model/dsnTypeGuards';
import update from 'immutability-helper';

export interface SymbolContext {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnRectBase | dsnText;
}

//
// The utility service
//
export class UtilityService {
  //
  // Rotate an message so that the incoming point is in un-rotated co-ordinates
  //
  static rotateMsg(delta: DrawingDelta, p: Coordinate): Coordinate {
    return this.rotatePointMsg(delta.dr, [delta.dx, delta.dy], p);
  }

  static rotatePointMsg(
    rotation: number,
    a: Coordinate,
    p: Coordinate,
  ): Coordinate {
    // Convert P to relative co-ordinates
    p = [p[0] - a[0], p[1] - a[1]];

    // Now unrotate
    p = UtilityService.unrotateSymCordinate(rotation, p);

    // Convert back to absolute co-ordinates
    p = [p[0] + a[0], p[1] + a[1]];

    return p;
  }

  //
  // Is a point inside a rectangle?
  //
  static isPointInsideRect(
    p: Coordinate,
    a: Coordinate,
    b: Coordinate,
  ): boolean {
    const rect = this.normalizeRect(a, b);

    // First is it inside the rectangle?
    if (
      p[0] < rect.a[0] ||
      p[0] > rect.b[0] ||
      p[1] < rect.a[1] ||
      p[1] > rect.b[1]
    ) {
      // It is outside
      return false;
    }

    // It is inside
    return true;
  }

  static normalizeRect(a: Coordinate, b: Coordinate) {
    return {
      a: [Math.min(a[0], b[0]), Math.min(a[1], b[1])] as Coordinate,
      b: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] as Coordinate,
    };
  }

  static simpleIsInsideRect(
    updater: Updater,
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    a = UtilityService.rotateMsg(delta, a);
    b = UtilityService.rotateMsg(delta, b);
    const rect = UtilityService.normalizeRect(
      [a[0] - delta.dx, a[1] - delta.dy],
      [b[0] - delta.dx, b[1] - delta.dy],
    );

    if (
      updater.is_inside_rect_item(rect.a, rect.b)
    ) {
      // We have a hit!
      items.push(updater.item as DocItem);
    }

    return items;
  }

  //
  // Calculate the drawing points, taking into account the symbol
  // rotation
  //
  static simpleRefreshPoints(props: SymbolContext) {
    // Rotate the co-ordinates
    const dx = props.dx ? props.dx : 0;
    const dy = props.dy ? props.dy : 0;
    const dr = props.dr ? props.dr : 0;

    const p = UtilityService.rotateSymCordinate(props.dr, props.data.point);
    const b = UtilityService.rotateSymCordinate(props.dr, props.data.point_b);
    const rotation = isText(props.data)
      ? UtilityService.rotateRotation(dr, props.data.rotation) % 2
      : 0;

    // Calculate the rectangle, but keep width and height +ve
    return {
      width: Math.abs(b[0] - p[0]) * props.scale_x,
      height: Math.abs(b[1] - p[1]) * props.scale_y,
      x: Math.min(b[0], p[0]) * props.scale_x + dx,
      y: Math.min(b[1], p[1]) * props.scale_y + dy,
      txt_rotation: rotation,
    };
  }

  //
  // This function rotates a co-ordinate for a symbol
  // given the symbol's information
  //
  static rotateSymCordinate(dr: number, p: Coordinate): Coordinate {
    // Has mirror been applied?
    // tslint:disable-next-line: no-bitwise
    if ((dr & 4) !== 0) {
      // Mirror V
      p = p.slice(0);
      p[0] = -p[0];
    }

    // tslint:disable-next-line: no-bitwise
    switch (dr & 3) {
      case 0: // 0 Degrees
        // Do nothing
        break;
      case 1: // 90 Degrees
        p = [-p[1], p[0]];
        break;
      case 2: // 180 degrees
        p = [-p[0], -p[1]];
        break;
      case 3: // 270 degrees
        p = [p[1], -p[0]];
        break;
    }

    return p;
  }

  //
  // This function rotates a co-ordinate for a symbol
  // given the symbol's information
  //
  static unrotateSymCordinate(dr: number, p: Coordinate) {
    // tslint:disable-next-line: no-bitwise
    switch (dr & 3) {
      case 0: // 0 Degrees
        // Do nothing
        break;
      case 1: // 90 Degrees
        p = [p[1], -p[0]];
        break;
      case 2: // 180 degrees
        p = [-p[0], -p[1]];
        break;
      case 3: // 270 degrees
        p = [-p[1], p[0]];
        break;
    }

    // Has mirror been applied?
    // tslint:disable-next-line: no-bitwise
    if ((dr & 4) !== 0) {
      // Mirror V
      p = p.slice(0);
      p[0] = -p[0];
    }

    return p;
  }

  static rotateRotation(dr: number, rotation: number) {
    // tslint:disable-next-line: no-bitwise
    let r = dr & 3;
    // tslint:disable-next-line: no-bitwise
    if ((dr & 4) !== 0) {
      // Mirror V
      if (rotation === 0 || rotation === 2) {
        r += 2;
      }
    }
    return (rotation + r) % 4;
  }

  // Determine if an object is selected
  static isSelected(selected_array: number[], o: DocItem) {
    if (!selected_array) {
      return false;
    }
    for (var obj in selected_array) {
      if (selected_array[obj] === o._id) {
        return true;
      }
    }
    return false;
  }

  // Is this item selected as a single item
  static isSingleItemSelected(selected_array: number[], o: DocItem) {
    if (!selected_array || !o || selected_array.length !== 1) {
      return false;
    }
    return selected_array[0] === o._id;
  }

  // If a single object is selected then this will
  // return it
  static singleSelectedItem(items: DocItem[], selected_array: number[]) {
    if (!selected_array) {
      return null;
    }
    if (selected_array.length === 1) {
      return items.find((e) => {
        return e._id === selected_array[0];
      });
    }
    return null;
  }

  // Update an item in an array
  static updateDupArray(a: any[], before: any, after: any) {
    // Is there any need to make a change?
    if (before === after) {
      return a;
    }

    for (const i in a) {
      if (a[i] === before) {
        return update(a, {
          [i]: { $set: after },
        });
      }
    }

    return a;
  }

  //
  // Rotate a point around a rotation centre,
  // note that angle is -1 for left and +1 for right
  //
  static rotate_point(
    angle: number,
    rotation_centre: Coordinate,
    point: Coordinate,
  ): Coordinate {
    let centre_x = rotation_centre[0];
    let centre_y = rotation_centre[1];

    // Translate of rect to 0,0
    let x = point[0] - centre_x;
    let y = point[1] - centre_y;

    // Rotate
    let c = 0; // cos(90)
    let s = 1; // sin(90)
    if (angle < 0) {
      c = 0; // cos(-90)
      s = -1; // sin(-90)
    }
    let rx = x * c - y * s;
    let ry = x * s + y * c;

    // Translate back
    x = rx + centre_x;
    y = ry + centre_y;

    return [x, y];
  }

  //
  // Is a point inside a polygon?
  // Use the ray casting method
  //
  static isPointInsidePolygon(point: Coordinate, vs: Coordinate[]): boolean {
    var x = point[0],
      y = point[1];

    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i][0],
        yi = vs[i][1];
      var xj = vs[j][0],
        yj = vs[j][1];

      var intersect =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }

    return inside;
  }
}
