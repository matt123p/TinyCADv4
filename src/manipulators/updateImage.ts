import { MoveAdd, IsInside, ContextMenuList } from './updateInterfaces';
import { Snap } from './snap';
import { updateRectBase } from './updateRectBase';
import { dsnImage, Coordinate, DocItem } from '../model/dsnItem';
import { ViewTracker } from '../model/dsnView';

//
// The simple image object
//

export class updateImage extends updateRectBase implements MoveAdd, IsInside {
  constructor(public item: dsnImage) {
    super(item);
  }

  getStyleSelector() {
    return {
      line: false,
      border_style: false,
      fill: false,
      text: false,
      text_colour: false,
    };
  }

  getContextMenu(items: ContextMenuList, p: Coordinate) {
    return items;
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
    const moved = super._move_handle(
      tracker,
      snap,
      p,
      a_x,
      a_y,
      b_x,
      b_y,
    ) as dsnImage;
    if (!this.item.fixed_aspect) return moved;
    const width = this.item.point_b[0] - this.item.point[0];
    const height = this.item.point_b[1] - this.item.point[1];
    let w = moved.point_b[0] - moved.point[0];
    let h = moved.point_b[1] - moved.point[1];
    if (width <= 0 || height <= 0 || w <= 0 || h <= 0) return this.item;
    const horizontal = a_x || b_x;
    const vertical = a_y || b_y;
    if (
      horizontal &&
      (!vertical || Math.abs(w / width - 1) >= Math.abs(h / height - 1))
    )
      h = (w * height) / width;
    else w = (h * width) / height;
    const x = a_x
      ? this.item.point_b[0] - w
      : b_x
      ? this.item.point[0]
      : (this.item.point[0] + this.item.point_b[0] - w) / 2;
    const y = a_y
      ? this.item.point_b[1] - h
      : b_y
      ? this.item.point[1]
      : (this.item.point[1] + this.item.point_b[1] - h) / 2;
    return {
      ...moved,
      point: [x, y] as Coordinate,
      point_b: [x + w, y + h] as Coordinate,
    };
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
