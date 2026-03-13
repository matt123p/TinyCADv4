//
// The no-connect object
//

import { updatePointBase } from './updatePointBase';
import { get_global_id } from '../util/global_id';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { IsInside, ContextMenuList } from './updateInterfaces';
import { dsnNoConnect, Coordinate } from '../model/dsnItem';
import { Size } from '../model/dsnDrawing';

export const CONNECT_SIZE = 4;

export class updateNoConnect extends updatePointBase implements IsInside {
  constructor(public item: dsnNoConnect) {
    super(item);
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
  }

  area_a(): Size {
    return [
      this.item.point[0] - CONNECT_SIZE,
      this.item.point[1] - CONNECT_SIZE,
    ];
  }

  area_b(): Size {
    return [
      this.item.point[0] + CONNECT_SIZE,
      this.item.point[1] + CONNECT_SIZE,
    ];
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
}
