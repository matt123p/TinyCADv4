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
