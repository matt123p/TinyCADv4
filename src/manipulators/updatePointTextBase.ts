//
// The label object
//

import { updatePointBase } from './updatePointBase';
import { measureText, getFont } from '../util/measureText';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { ContextMenuList, CopyData, UpdateText } from './updateInterfaces';
import { Snap } from './snap';
import { dsnPointTextBase, Coordinate, DocItem } from '../model/dsnItem';
import { Size } from '../model/dsnDrawing';
import { updateTextData } from './updateTextArea';
import { ViewTracker, FindResult } from '../model/dsnView';

export abstract class updatePointTextBase
  extends updatePointBase
  implements UpdateText
{
  constructor(public item: dsnPointTextBase) {
    // Call Super constructor
    super(item);
  }

  find(findText: string): FindResult[] {
    if (this.item.text.toLowerCase().indexOf(findText) !== -1) {
      return [
        {
          symbol: this.item.NodeName,
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

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -1: // Not selected
        return 'auto';
      case -2: // Text icon
        switch (this.item.rotation) {
          case 1:
          case 3:
            return 'vertical-text';
          case 0:
          case 2:
          default:
            return 'text';
        }
        break;
      default:
        // Anything else
        return 'move';
    }
  }

  x() {
    return this.item.point[0];
  }

  y() {
    return this.item.point[1] - this.height();
  }

  width() {
    const high_width = measureText(getFont(this.item), this.item.text);
    return Math.max(high_width + 4, 25);
  }

  height() {
    return this.item.font_size + 4;
  }

  getBoundingRect() {
    return {
      x1: this.x(),
      y1: this.y(),
      x2: this.x() + this.height(),
      y2: this.y() + this.height(),
    };
  }

  public area_a(): Size {
    throw new Error('Method not implemented.');
  }

  public area_b(): Size {
    throw new Error('Method not implemented.');
  }

  // Menu Handlers
  rotate(angle: number, rotation_centre?: Coordinate) {
    let rotation = this.item.rotation + angle;
    if (rotation > 3) {
      rotation = 0;
    }
    if (rotation < 0) {
      rotation = 3;
    }

    let point = this.item.point;
    if (rotation_centre) {
      point = UtilityService.rotate_point(
        angle,
        rotation_centre,
        this.item.point,
      );
    }

    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      point,
      rotation,
    );
    return update(this.item as DocItem, {
      point: { $set: point },
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

  updateText(handle: number, new_text: string): DocItem {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    return update(this.item as DocItem, {
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
    altKey: boolean,
    metaKey: boolean,
  ): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_keydown(
        this.item.textData,
        keyCode,
        shiftKey,
        ctrlKey,
        altKey,
        metaKey,
      );
      return update(this.item as DocItem, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item as DocItem;
    }
  }

  handleKeyPress(handle: number, keyCode: number): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_keypress(this.item.textData, keyCode);
      return update(this.item as DocItem, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item as DocItem;
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
      this.item.rotation,
    );
    const edit_position = UpdateTextArea.find_positon(this.item.textData, p);
    return update(this.item as DocItem, {
      textData: {
        $set: UpdateTextArea.mouse_click(
          this.item.textData,
          edit_position,
          clear_selection,
        ),
      },
    });
  }

  on_mouse_double_click(handle: number, p: Coordinate): DocItem {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    const edit_position = UpdateTextArea.find_positon(this.item.textData, p);
    return update(this.item as DocItem, {
      textData: {
        $set: UpdateTextArea.select_word(this.item.textData, edit_position),
      },
    });
  }

  handleTextPaste(handle: number, pasteText: string): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.rotation,
      );
      let textData = UpdateTextArea.on_paste(this.item.textData, pasteText);
      return update(this.item as DocItem, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item as DocItem;
    }
  }

  handleTextCut(handle: number): DocItem {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.rotation,
      );
      let textData = UpdateTextArea.delete_sel(this.item.textData);
      return update(this.item as DocItem, {
        text: { $set: textData.drawText },
        textData: { $set: textData },
      });
    } else {
      return this.item as DocItem;
    }
  }

  handleTextCopy(handle: number, cut: boolean): CopyData {
    if (handle === -2) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
        this.item.rotation,
      );
      let {
        textData: textData,
        text: text,
        copy_data: copy_data,
      } = UpdateTextArea.on_copy(this.item.textData, cut);
      return {
        item: update(this.item as DocItem, {
          text: { $set: text },
          textData: { $set: textData },
        }),
        copy_data: copy_data,
      };
    } else {
      return { item: this.item as DocItem, copy_data: null };
    }
  }

  mouse_move(
    tracker: ViewTracker,
    p: Coordinate,
    handle: number,
    snap: Snap,
    items?: DocItem[],
  ): { obj: DocItem; r: Coordinate } {
    const mr = super.mouse_move(tracker, p, 0, snap, items);
    const obj = mr.obj as dsnPointTextBase;
    const UpdateTextArea = this.create_updateTextArea(
      obj,
      obj.point,
      obj.rotation,
    );
    return {
      obj: update(obj as DocItem, {
        textData: {
          $set: UpdateTextArea.create_text_blocks(obj.textData, obj.text),
        },
      }),
      r: mr.r,
    };
  }

  relative_move(r: Coordinate): DocItem {
    const obj = super.relative_move(r) as dsnPointTextBase;
    const UpdateTextArea = this.create_updateTextArea(
      obj,
      obj.point,
      obj.rotation,
    );
    return update(obj as DocItem, {
      textData: {
        $set: UpdateTextArea.create_text_blocks(obj.textData, obj.text),
      },
    });
  }

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    const mr = super.begin_add(p, tracker, snap, items);
    const obj = mr.obj as dsnPointTextBase;
    const UpdateTextArea = this.create_updateTextArea(
      obj,
      obj.point,
      obj.rotation,
    );
    return {
      obj: update(obj, {
        textData: {
          $set: UpdateTextArea.create_text_blocks(obj.textData, obj.text),
        },
      }) as DocItem,
      end: mr.end,
      items: mr.items,
    };
  }

  protected abstract create_updateTextArea(
    item: dsnPointTextBase,
    point: Coordinate,
    rotation: number,
  ): updateTextData;
}
