import {
  MoveAdd,
  IsInsideResult,
  IsInside,
  ContextMenuList,
} from './updateInterfaces';
import { updateRectBase } from './updateRectBase';
import { dsnEllipse, Coordinate, DocItem } from '../model/dsnItem';
import { Snap } from './snap';
import { ViewTracker } from '../model/dsnView';
import { UtilityService } from '../util/utilityService';

//
// The simple ellipse object
//
export class updateEllipse extends updateRectBase implements MoveAdd, IsInside {
  constructor(public item: dsnEllipse, private readonly circular = false) {
    super(item);
  }

  mouse_move(tracker: ViewTracker, delta: Coordinate, handle: number, snap: Snap) {
    const moved = super.mouse_move(tracker, delta, handle, snap);
    if (!this.circular || handle === 0 || moved.obj === this.item) return moved;
    const item = moved.obj as dsnEllipse;
    const width = item.point_b[0] - item.point[0];
    const height = item.point_b[1] - item.point[1];
    const size = handle === 5 || handle === 7 ? width : handle === 6 || handle === 8 ? height :
      Math.abs(delta[0]) >= Math.abs(delta[1]) ? width : height;
    if (size <= 0) return { obj: this.item, r: [0, 0] };
    const axisOrigin = (first: number, last: number, fromFirst: boolean, fromLast: boolean) =>
      fromFirst ? last - size : fromLast ? first : (first + last - size) / 2;
    const x = axisOrigin(item.point[0], item.point_b[0], [1, 3, 5].includes(handle), [2, 4, 7].includes(handle));
    const y = axisOrigin(item.point[1], item.point_b[1], [1, 2, 6].includes(handle), [3, 4, 8].includes(handle));
    return { obj: { ...item, point: [x, y], point_b: [x + size, y + size] },
      r: [this.item.point[0] - x, this.item.point[1] - y] };
  }

  getStyleSelector() {
    return {
      line: true,
      border_style: false,
      fill: true,
      text: false,
      text_colour: false,
    };
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
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
        if (UtilityService.isPointInsideRect(p, a, b)) {
          return { item: this.item, handle: i + 1, distance: 0 };
        }
      }
    }

    // Is this point inside the ellipse?
    // See: https://math.stackexchange.com/questions/76457/check-if-a-point-is-within-an-ellipse
    let rx = Math.abs((this.item.point_b[0] - this.item.point[0]) / 2);
    let ry = Math.abs((this.item.point_b[1] - this.item.point[1]) / 2);
    let dx = p[0] - (Math.min(this.item.point[0], this.item.point_b[0]) + rx);
    let dy =
      ((p[1] - (Math.min(this.item.point[1], this.item.point_b[1]) + ry)) *
        rx) /
      ry;
    let lw = this.item.stroked ? this.item.line_width : 1;
    let dr = Math.sqrt(dx * dx + dy * dy) - (rx + lw);

    if (this.item.filled && this.item.fill_colour !== 'none' && dr <= 0) {
      return { item: this.item, handle: 0, distance: 0 };
    } else if (dr < 10 && dr > -10) {
      return { item: this.item, handle: 0, distance: dr };
    }

    // Sorry, not me
    return null;
  }

  move_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    return this.item;
  }

  mousemove_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): { item: DocItem; display: boolean } {
    return { item: this.item, display: false };
  }
}
