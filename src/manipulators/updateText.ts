import { updateRectBase } from './updateRectBase';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import {
  MoveAdd,
  IsInside,
  DrawingDelta,
  IsInsideResult,
  ContextMenuList,
  CopyData,
} from './updateInterfaces';
import { Snap } from './snap';
import { dsnText, DocItem, Coordinate, dsnRectBase } from '../model/dsnItem';
import { TextAreaData, IsInsideTextResult } from '../model/textArea';
import { updateTextData } from './updateTextArea';
import { ViewTracker, FindResult } from '../model/dsnView';

//
// The simple text object
//
export class updateText extends updateRectBase implements MoveAdd, IsInside {
  constructor(public item: dsnText) {
    super(item);
  }

  post_construction() {
    return this.updateText(-2, this.item.text);
  }

  getStyleSelector() {
    return {
      line: true,
      border_style: true,
      fill: true,
      text: true,
      text_colour: true,
    };
  }

  getFont() {
    return this.item.font_size + 'px ' + this.item.font_name;
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -3: // Text icon
      case -2: // Text icon
        if (this.item.rotation === 1 || this.item.rotation === 3) {
          return 'vertical-text';
        } else {
          return 'text';
        }
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

  updateText(handle: number, new_text: string): DocItem {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.point_b,
      this.item.rotation,
    );
    return update(this.item, {
      text: { $set: new_text },
      textData: {
        $set: UpdateTextArea.create_text_blocks(this.item.textData, new_text),
      },
    });
  }

  handleKeyDown(
    handle: number,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
  ): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.point_b,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_keydown(
        this.item.textData,
        keyCode,
        shiftKey,
        ctrlKey,
      );
      return update(this.item, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item;
    }
  }

  handleKeyPress(handle: number, keyCode: number): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.point_b,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_keypress(this.item.textData, keyCode);
      return update(this.item, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item;
    }
  }

  wantKeyPress(handle: number): boolean {
    return handle === -2;
  }

  on_mouse_click(
    handle: number,
    p: Coordinate,
    clear_selection: boolean,
  ): DocItem {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.point_b,
      this.item.rotation,
    );
    const edit_position = UpdateTextArea.find_positon(this.item.textData, p);
    return update(this.item, {
      textData: {
        $set: UpdateTextArea.mouse_click(
          this.item.textData,
          edit_position,
          clear_selection,
        ),
      },
    });
  }

  handleTextPaste(handle: number, pasteText: string): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.point_b,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_paste(this.item.textData, pasteText);
      return update(this.item, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item;
    }
  }

  handleTextCopy(handle: number, cut: boolean): CopyData {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.point_b,
        this.item.rotation,
      );
      let {
        textData: textData,
        text: text,
        copy_data: copy_data,
      } = UpdateTextArea.on_copy(this.item.textData, cut);
      return {
        item: update(this.item, {
          text: { $set: text },
          textData: { $set: textData },
        }),
        copy_data: copy_data,
      };
    } else {
      return { item: this.item, copy_data: null };
    }
  }

  public find(findText: string): FindResult[] {
    if (this.item.text.toLowerCase().indexOf(findText) !== -1) {
      return [
        {
          symbol: 'Text',
          text: this.item.text,
          a: this.item.point.slice(),
          id: this.item._id,
        },
      ];
    } else {
      return [];
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

    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      [x1, y1],
      [x2, y2],
      rotation,
    );
    return update(this.item, {
      point: { $set: [x1, y1] },
      point_b: { $set: [x2, y2] },
      rotation: { $set: rotation },
      textData: {
        $set: UpdateTextArea.create_text_blocks(
          this.item.textData,
          this.item.text,
        ),
      },
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

  mouse_move(
    tracker: ViewTracker,
    p: Coordinate,
    handle: number,
    snap: Snap,
  ): { obj: DocItem; r: Coordinate } {
    var old_a = [this.item.point[0], this.item.point[1]];
    var old_b = [this.item.point_b[0], this.item.point_b[1]];
    let obj: dsnRectBase = this.item;

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

    // Enforce a > b restriction
    if (obj.point[0] > obj.point_b[0] || obj.point[1] > obj.point_b[1]) {
      obj.point = old_a;
      obj.point_b = old_b;
    }

    // Update the text blocks
    const item = obj as dsnText;
    const UpdateTextArea = this.create_updateTextArea(
      item,
      item.point,
      item.point_b,
      item.rotation,
    );
    item.textData = UpdateTextArea.create_text_blocks(item.textData, item.text);

    return {
      obj: obj as DocItem,
      r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
    };
  }

  relative_move(r: Coordinate): DocItem {
    if (r[0] === 0 && r[1] === 0) {
      return this.item;
    }

    const point = [this.item.point[0] - r[0], this.item.point[1] - r[1]];
    const point_b = [this.item.point_b[0] - r[0], this.item.point_b[1] - r[1]];
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      point,
      point_b,
      this.item.rotation,
    );

    return update(this.item, {
      point: { $set: point },
      point_b: { $set: point_b },
      textData: {
        $set: UpdateTextArea.create_text_blocks(
          this.item.textData,
          this.item.text,
        ),
      },
    });
  }

  begin_add(
    p: Coordinate,
    tracker: ViewTracker,
    snap: Snap,
    items: DocItem[],
  ): { obj: DocItem; end: boolean; items: DocItem[] } {
    let snap_p = snap.snap(p);
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      snap_p,
      snap_p,
      this.item.rotation,
    );
    let r = update(this.item, {
      point: { $set: snap_p },
      point_b: { $set: snap_p },
      textData: {
        $set: UpdateTextArea.create_text_blocks(
          this.item.textData,
          this.item.text,
        ),
      },
    });

    return { obj: r, end: false, items: items };
  }

  drag_add(
    p: any[],
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    var snap_p = snap.snap(p);
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      snap_p,
      this.item.rotation,
    );
    return update(this.item, {
      point_b: { $set: snap_p },
      textData: {
        $set: UpdateTextArea.create_text_blocks(
          this.item.textData,
          this.item.text,
        ),
      },
    });
  }

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.point_b,
      this.item.rotation,
    );
    if (UpdateTextArea.is_inside_rect(this.item.textData, delta, a, b)) {
      // We have a hit!
      items.push(this.item);
    }

    return items;
  }

  is_inside(
    delta: DrawingDelta,
    tp: Coordinate,
    is_selected: boolean,
  ): IsInsideResult {
    // Test against text areas
    if (this.item.textData) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.point_b,
        this.item.rotation,
      );
      const text = UpdateTextArea.on_isinside(this.item.textData, delta, tp);
      switch (text) {
        case IsInsideTextResult.Inside_Text:
          return { item: this.item, distance: 0, handle: -2 };
        case IsInsideTextResult.Inside_Rect:
          return { item: this.item, distance: 0, handle: 0 };
      }
    }

    // Check the handles
    let a = UtilityService.rotateMsg(delta, tp);
    a = [a[0] - delta.dx, a[1] - delta.dy];
    return this.is_inside_item(a, is_selected);
  }

  private create_updateTextArea(
    item: dsnText,
    point: Coordinate,
    point_b: Coordinate,
    rotation: number,
  ) {
    return new updateTextData(
      point[0],
      point[1],
      point,
      item,
      -2,
      0,
      true,
      rotation,
      point_b[0] - point[0],
      point_b[1] - point[1],
      false,
      false,
    );
  }
}
