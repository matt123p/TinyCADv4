import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { CONNECT_SIZE } from './updateNoConnect';
import {
  IsInsideResult,
  DrawingDelta,
  IsInside,
  ContextMenuList,
} from './updateInterfaces';
import { dsnJunction, Coordinate, DocItem } from '../model/dsnItem';
import { FindResult } from '../model/dsnView';

//
// The simple junction item
//
export class updateJunction implements IsInside {
  constructor(public item: dsnJunction) {}

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
    return 'auto';
  }

  // Determine if an point is inside this object
  // We return the handle number or -1 for not inside
  _isPointInsideRect(p: Coordinate, a: Coordinate, b: Coordinate) {
    // It is outside
    return false;
  }

  // Does the rectangle completely contain this item?
  is_inside_rect_item(a: Coordinate, b: Coordinate) {
    // It is outside
    return false;
  }

  relative_move(r: Coordinate) {
    if (r[0] !== 0 || r[1] !== 1) {
      return update(this.item, {
        point: { $set: [this.item.point[0] - r[0], this.item.point[1] - r[1]] },
      });
    } else {
      return this.item;
    }
  }

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    // Sorry, not me
    return items;
  }

  is_inside(
    delta: DrawingDelta,
    p: Coordinate,
    is_selected: boolean,
  ): IsInsideResult {
    // Sorry, not me
    return null;
  }

  area_a() {
    return [
      this.item.point[0] - CONNECT_SIZE,
      this.item.point[1] - CONNECT_SIZE,
    ];
  }

  area_b() {
    return [
      this.item.point[0] + CONNECT_SIZE,
      this.item.point[1] + CONNECT_SIZE,
    ];
  }

  getBoundingRect() {
    var a = this.area_a();
    var b = this.area_b();
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  }

  rotate(angle: number, rotation_centre: Coordinate) {
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
    });
  }

  find(findText: string): FindResult[] {
    return [];
  }

  can_rotate() {
    return false;
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
  }
}
