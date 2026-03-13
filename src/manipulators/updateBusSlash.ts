import { updatePointBase } from './updatePointBase';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { ContextMenuList, IsInsideResult, IsInside } from './updateInterfaces';
import { dsnBusSlash, Coordinate } from '../model/dsnItem';
import { Size } from '../model/dsnDrawing';

//
// The simple bus slash object
//

export class updateBusSlash extends updatePointBase implements IsInside {
  constructor(public item: dsnBusSlash) {
    super(item);
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
  }

  area_a(): Size {
    return [this.item.point[0], this.item.point[1]];
  }

  area_b(): Size {
    var size = 20;
    if (this.item.rotation === 0) {
      return [this.item.point[0] - size, this.item.point[1] + size];
    } else {
      return [this.item.point[0] - size, this.item.point[1] - size];
    }
  }

  // Determine if an point is inside this object
  // We return the handle number or -1 for not inside
  is_inside_item(p: Coordinate, is_selected: boolean): IsInsideResult {
    const size = 20;
    let area_a: Coordinate;
    let area_b: Coordinate;
    if (this.item.rotation === 0) {
      area_a = [this.item.point[0] - size, this.item.point[1]];
      area_b = [this.item.point[0], this.item.point[1] + size];
    } else {
      area_a = [this.item.point[0] - size, this.item.point[1] - size];
      area_b = [this.item.point[0], this.item.point[1]];
    }

    // First is it inside the rectangle?
    if (this._isPointInsideRect(p, area_a, area_b)) {
      // It is inside the main object
      return { item: this.item, handle: 0, distance: 0 };
    }

    // Sorry, not me
    return null;
  }

  getBoundingRect() {
    var a = this.area_a();
    var b = this.area_b();
    return { x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
  }

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
}
