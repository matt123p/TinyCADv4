import { updatePointBase } from './updatePointBase';
import { dragObject } from './dragObject';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import {
  SimpleAdd,
  SimpleDrag,
  IsInside,
  DrawingDelta,
  IsInsideResult,
  ContextMenuList,
  CopyData,
} from './updateInterfaces';
import { Snap } from './snap';
import {
  dsnSymbol,
  Coordinate,
  DocItem,
  SymbolTextItem,
} from '../model/dsnItem';
import { IsInsideTextResult } from '../model/textArea';
import { updateTextData } from './updateTextArea';
import { updateFactory } from './updateFactory';
import { ViewTracker, FindResult } from '../model/dsnView';
import { DeltaCoordinate } from './updateView';
import { TextDisplayMethod } from '../model/tclib';

//
// The symbol object
//
export class updateSymbol
  extends updatePointBase
  implements SimpleAdd, SimpleDrag, IsInside
{
  private _drag: dragObject;

  constructor(public item: dsnSymbol) {
    super(item);
  }

  post_construction() {
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    return update(this.item, {
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          this.item.text,
        ),
      },
    });
  }

  getFont() {
    return this.item.font_size + 'px ' + this.item.font_name;
  }

  // Get the list of handles associated with a selected
  // object
  handles() {
    if (this.item.allow_resize) {
      const bb = this.getBoundingRect();
      return [
        [bb.x1, bb.y1], // Top left
        [bb.x2, bb.y1], // Top right

        [bb.x1, bb.y2], // Bottom left
        [bb.x2, bb.y2], // Bottom right

        [bb.x1, (bb.y1 + bb.y2) / 2], // Mid left
        [(bb.x1 + bb.x2) / 2, bb.y1], // Mid top
        [bb.x2, (bb.y1 + bb.y2) / 2], // Mid right
        [(bb.x1 + bb.x2) / 2, bb.y2], // Mid bottom
      ];
    } else {
      return [];
    }
  }

  updateText(handle: number, new_text: string): DocItem {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      if (this.item.text[index].description === 'Ref' && this.parts() > 1) {
        new_text = new_text.slice(0, -1);
      }

      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      const item = update(this.item, {
        text: {
          [index]: {
            value: {
              $set: new_text,
            },
          },
        },
      });

      return update(this.item, {
        textData: {
          $set: this.create_text_blocks(
            UpdateTextAreas,
            item,
            this.item.part,
            item.text,
          ),
        },
      });
    }
    return this.item;
  }

  handleKeyDown(
    handle: number,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
  ): DocItem {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      const textData = UpdateTextAreas[index].on_keydown(
        this.item.textData[index],
        keyCode,
        shiftKey,
        ctrlKey,
      );
      return update(this.item, {
        text: {
          [index]: { value: { $set: textData.drawText } },
        },
        textData: {
          [index]: { $set: textData },
        },
      });
    } else {
      return this.item;
    }
  }

  handleKeyPress(handle: number, keyCode: number): DocItem {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      const textData = UpdateTextAreas[index].on_keypress(
        this.item.textData[index],
        keyCode,
      );
      return update(this.item, {
        text: {
          [index]: { value: { $set: textData.drawText } },
        },
        textData: {
          [index]: { $set: textData },
        },
      });
    } else {
      return this.item;
    }
  }

  wantKeyPress(handle: number): boolean {
    const index = -handle - 100;
    return index >= 0 && index < this.item.text.length;
  }

  on_mouse_click(
    handle: number,
    p: Coordinate,
    clear_selection: boolean,
  ): DocItem {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      const edit_position = UpdateTextAreas[index].find_positon(
        this.item.textData[index],
        p,
      );
      const textData = UpdateTextAreas[index].mouse_click(
        this.item.textData[index],
        edit_position,
        clear_selection,
      );
      return update(this.item, {
        textData: {
          [index]: { $set: textData },
        },
      });
    } else {
      return this.item;
    }
  }

  handleTextPaste(handle: number, pasteText: string): DocItem {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      const textData = UpdateTextAreas[index].on_paste(
        this.item.textData[index],
        pasteText,
      );
      return update(this.item, {
        text: {
          [index]: { value: { $set: textData.drawText } },
        },
        textData: {
          [index]: { $set: textData },
        },
      });
    } else {
      return this.item;
    }
  }

  handleTextCopy(handle: number, cut: boolean): CopyData {
    const index = -handle - 100;
    if (index >= 0 && index < this.item.text.length) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        this.item.point,
      );
      let {
        textData: textData,
        text: text,
        copy_data: copy_data,
      } = UpdateTextAreas[index].on_copy(this.item.textData[index], cut);
      return {
        item: update(this.item, {
          text: {
            [index]: { value: { $set: text } },
          },
          textData: {
            [index]: { $set: textData },
          },
        }),
        copy_data: copy_data,
      };
    } else {
      return { item: this.item, copy_data: null };
    }
  }

  getContextMenu(items: ContextMenuList) {
    return items;
  }

  getBoundingRect() {
    return this._getBoundingRect(this.item.rotation);
  }

  _getBoundingRect(rotation: number) {
    let delta = {
      dx: this.item.point[0],
      dy: this.item.point[1],
      dr: rotation,
    };

    const outline = this.outline();
    const size = UtilityService.rotateSymCordinate(rotation, [
      outline.size[0] * this.item.scale_x,
      outline.size[1] * this.item.scale_y,
    ]);

    this.calcDelta(delta);
    const a = [delta.dx, delta.dy];
    const b = [a[0] - size[0], a[1] - size[1]];
    return {
      x1: Math.min(a[0], b[0]),
      y1: Math.min(a[1], b[1]),
      x2: Math.max(a[0], b[0]),
      y2: Math.max(a[1], b[1]),
    };
  }

  outline() {
    let outline = this.item._symbol.heterogeneous
      ? Math.max(this.item.part, 0)
      : 0;
    return this.item._symbol.outlines[outline];
  }

  active_points() {
    if (this.item._active_points == null) {
      this.item._active_points = [];
      let delta = { dx: 0, dy: 0 };
      this.calcDelta(delta);
      const outline = this.outline();
      for (let i = 0; i < outline.active_points.length; ++i) {
        let active_point = outline.active_points[i];

        // Is this a power pin?  If so, are we showing power pins?
        if (active_point.power && !this.item.show_power) {
          continue;
        }

        // Is this pin for this part in package?
        if (
          !this.item._symbol.heterogeneous &&
          active_point.part !== this.item.part
        ) {
          continue;
        }

        // Convert P to relative co-ordinates
        let p = [
          active_point.pos[0] * this.item.scale_x,
          active_point.pos[1] * this.item.scale_y,
        ];

        // Now unrotate
        p = UtilityService.rotateSymCordinate(this.item.rotation, p);

        // Convert back to absolute co-ordinates
        p = [p[0] + delta.dx, p[1] + delta.dy];

        this.item._active_points.push([
          p[0] + this.item.point[0],
          p[1] + this.item.point[1],
          active_point.pin,
        ]);
      }
    }

    return this.item._active_points;
  }

  power_pins() {
    if (this.item.show_power) {
      // We only return hidden power pins, as there we are showing
      // power pins, then we don't need to return them.
      return [];
    }

    let power_pins = [];
    let delta = { dx: 0, dy: 0 };
    this.calcDelta(delta);
    const outline = this.outline();

    for (let i = 0; i < outline.active_points.length; ++i) {
      let active_point = outline.active_points[i];

      // Is this a power pin?
      if (!active_point.power) {
        // No
        continue;
      }

      // Convert P to relative co-ordinates
      let p = [
        active_point.pos[0] * this.item.scale_x,
        active_point.pos[1] * this.item.scale_y,
      ];

      // Now unrotate
      p = UtilityService.rotateSymCordinate(this.item.rotation, p);

      // Convert back to absolute co-ordinates
      p = [p[0] + delta.dx, p[1] + delta.dy];

      power_pins.push([
        p[0] + this.item.point[0],
        p[1] + this.item.point[1],
        active_point.pin,
      ]);
    }

    return power_pins;
  }

  // How many parts per package in this symbol?
  parts() {
    return this.item?._symbol?.parts ?? 0;
  }

  // Convert a screen point in to the cordinate system of the
  // (scaled) symbol
  makePointScaled(scope: DeltaCoordinate, a: Coordinate) {
    const switched_axis = this.item.rotation == 1 || this.item.rotation == 3;
    const scale_x = switched_axis ? this.item.scale_y : this.item.scale_x;
    const scale_y = switched_axis ? this.item.scale_x : this.item.scale_y;
    const x = (a[0] - scope.dx) / scale_x;
    const y = (a[1] - scope.dy) / scale_y;
    return [x + scope.dx, y + scope.dy];
  }

  calcRefDelta(scope: DeltaCoordinate) {
    this._calcDelta(scope, this.item.rotation);
    const outline = this.outline();
    let ref_point_x = outline.ref_point[0] * this.item.scale_x;
    let ref_point_y = outline.ref_point[1] * this.item.scale_y;
    let ref_point = UtilityService.rotateSymCordinate(this.item.rotation, [
      ref_point_x,
      ref_point_y,
    ]);

    scope.dx = scope.dx - ref_point[0];
    scope.dy = scope.dy - ref_point[1];
  }

  calcDelta(scope: DeltaCoordinate) {
    this._calcDelta(scope, this.item.rotation);
  }

  _calcDelta(scope: DeltaCoordinate, rotation: number) {
    const outline = this.outline();

    // tslint:disable-next-line: no-bitwise
    switch (rotation & 3) {
      case 0: // No rotation
        // tslint:disable-next-line: no-bitwise
        if (rotation & 4) {
          // Mirror vertical
          scope.dx -= outline.size[0] * this.item.scale_x;
        }
        break;
      case 1: // 90 degree rotation
        scope.dx -= outline.size[1] * this.item.scale_y;
        // tslint:disable-next-line: no-bitwise
        if (rotation & 4) {
          // Mirror vertical
          scope.dy -= outline.size[0] * this.item.scale_x;
        }
        break;
      case 2: // 180 degree rotation
        scope.dx -= outline.size[0] * this.item.scale_x;
        scope.dy -= outline.size[1] * this.item.scale_y;
        // tslint:disable-next-line: no-bitwise
        if (rotation & 4) {
          // Mirror vertical
          scope.dx += outline.size[0] * this.item.scale_x;
        }
        break;
      case 3: // 270 degree rotation
        scope.dy -= outline.size[0] * this.item.scale_x;
        // tslint:disable-next-line: no-bitwise
        if (rotation & 4) {
          // Mirror vertical
          scope.dy += outline.size[0] * this.item.scale_x;
        }
        break;
    }
  }

  _move_symbol(tracker: ViewTracker, snap: Snap, p: Coordinate) {
    let old_a = this.item.point;
    let point = this.item.point.slice();

    // Restore the actual position (without snap)
    if (tracker.a != null) {
      point = [tracker.a[0], tracker.a[1]];
    }

    // Move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time
    tracker.a = [point[0], point[1]];

    // Snap
    point = snap.snap(point);

    let obj = this.item;
    if (point[0] !== this.item.point[0] || point[1] !== this.item.point[1]) {
      obj = update(obj, {
        point: { $set: point },
        _active_points: { $set: null },
      });
      const UpdateTextAreas = this.create_updateTextArea(obj, obj.point);
      obj = update(obj, {
        textData: {
          $set: this.create_text_blocks(
            UpdateTextAreas,
            this.item,
            this.item.part,
            this.item.text,
          ),
        },
      });
    }

    return {
      obj: obj,
      r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
    };
  }

  show_text(display: TextDisplayMethod, value: string) {
    switch (display) {
      case TextDisplayMethod.HideValue:
      case TextDisplayMethod.NeverShow:
        return false;

      case TextDisplayMethod.ShowValuePresent:
      case TextDisplayMethod.ShowNameValuePresent:
        return value?.length > 0;

      default:
      case TextDisplayMethod.ShowValue:
      case TextDisplayMethod.ShowValueExtra:
      case TextDisplayMethod.ShowNameValue:
        return true;
    }
  }

  _move_text(tracker: ViewTracker, snap: Snap, p: Coordinate, i: number) {
    let old_a = this.item.text[i].position.slice();
    let position = this.item.text[i].position.slice();

    // Restore the actual position (without snap)
    if (tracker.a != null) {
      position = [tracker.a[0], tracker.a[1]];
    }

    // Move
    position = [position[0] + p[0], position[1] + p[1]];

    // Save state for next time
    tracker.a = [position[0], position[1]];

    // Snap
    position = snap.snap(position);

    let obj = this.item;
    if (
      this.item.text[i].position[0] !== position[0] ||
      this.item.text[i].position[1] !== position[1]
    ) {
      obj = update(obj, {
        text: {
          [i]: {
            position: { $set: position },
          },
        },
      });
      const UpdateTextAreas = this.create_updateTextArea(obj, obj.point);
      obj = update(obj, {
        textData: {
          $set: this.create_text_blocks(
            UpdateTextAreas,
            obj,
            obj.part,
            obj.text,
          ),
        },
      });
    }

    return {
      obj: obj,
      r: [old_a[0] - position[0], old_a[1] - position[1]],
    };
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
    // Restore the actual position (without snap)
    let bb = this.getBoundingRect();
    let point = [bb.x1, bb.y1];
    let point_b = [bb.x2, bb.y2];
    const old_a = point.slice();
    const old_b = point_b.slice();

    // Determine which of the axis line up to the original point
    const point_x_is_a = point[0] === this.item.point[0];
    const point_y_is_a = point[1] === this.item.point[1];

    if (tracker.a != null) {
      if (a_x) {
        point[0] = tracker.a[0];
      }
      if (a_y) {
        point[1] = tracker.a[1];
      }
    }
    if (tracker.b != null) {
      if (b_x) {
        point_b[0] = tracker.b[0];
      }
      if (b_y) {
        point_b[1] = tracker.b[1];
      }
    }

    // Perform the move
    if (a_x) {
      point[0] += p[0];
    }
    if (a_y) {
      point[1] += p[1];
    }
    if (b_x) {
      point_b[0] += p[0];
    }
    if (b_y) {
      point_b[1] += p[1];
    }

    // Save state for next time...
    tracker.a = point.slice();
    tracker.b = point_b.slice();

    // ... and snap
    var snap_a = snap.snap(point);
    var snap_b = snap.snap(point_b);
    if (a_x) {
      point[0] = snap_a[0];
    }
    if (a_y) {
      point[1] = snap_a[1];
    }
    if (b_x) {
      point_b[0] = snap_b[0];
    }
    if (b_y) {
      point_b[1] = snap_b[1];
    }

    // Enforce a > b restriction
    if (point[0] >= point_b[0] || point[1] >= point_b[1]) {
      point = old_a;
      point_b = old_b;
    }

    // Have we moved?
    if (
      bb.x1 !== point[0] ||
      bb.y1 !== point[1] ||
      bb.x2 !== point_b[0] ||
      bb.y2 !== point_b[1]
    ) {
      // Convert point a & b to point & scale

      // Determine the new scale
      let size = this.outline().size;
      if (this.item.rotation == 1 || this.item.rotation == 3) {
        size = [size[1], size[0]];
      }
      let scale = [
        Math.abs(point[0] - point_b[0]) / size[0],
        Math.abs(point[1] - point_b[1]) / size[1],
      ];
      if (this.item.rotation == 1 || this.item.rotation == 3) {
        scale = [scale[1], scale[0]];
      }

      // Determine the new point of origin
      let point_a = [point[0], point[1]];
      if (!point_x_is_a) {
        point_a[0] = point_b[0];
      }
      if (!point_y_is_a) {
        point_a[1] = point_b[1];
      }

      // Write back to the object
      const obj = update(this.item, {
        point: { $set: point_a },
        scale_x: { $set: scale[0] },
        scale_y: { $set: scale[1] },
      });

      return {
        obj: obj as DocItem,
        r: [old_a[0] - obj.point[0], old_a[1] - obj.point[1]],
      };
    } else {
      return null;
    }
  }

  mouse_move(tracker: ViewTracker, p: Coordinate, handle: number, snap: Snap) {
    let r = {
      obj: this.item,
      r: [0, 0] as Coordinate,
    };

    if (this.item.allow_resize) {
      let r = null;

      switch (handle) {
        case 1: // Top left
          r = this._move_handle(tracker, snap, p, true, true, false, false);
          break;
        case 2: // Top right
          r = this._move_handle(tracker, snap, p, false, true, true, false);
          break;
        case 3: // Bottom left
          r = this._move_handle(tracker, snap, p, true, false, false, true);
          break;
        case 4: // Bottom right
          r = this._move_handle(tracker, snap, p, false, false, true, true);
          break;
        case 5: // Mid left
          r = this._move_handle(tracker, snap, p, true, false, false, false);
          break;
        case 6: // Mid top
          r = this._move_handle(tracker, snap, p, false, true, false, false);
          break;
        case 7: // Mid right
          r = this._move_handle(tracker, snap, p, false, false, true, false);
          break;
        case 8: // Mid bottom
          r = this._move_handle(tracker, snap, p, false, false, false, true);
          break;
      }

      if (r) {
        return r;
      }
    }

    if (handle === 0) {
      r = this._move_symbol(tracker, snap, p);
    } else if (handle >= 100) {
      r = this._move_text(tracker, snap, p, handle - 100);
    }

    return r;
  }

  relative_move(r: Coordinate) {
    if (r[0] === 0 && r[1] === 0) {
      return this.item;
    }
    const point = [this.item.point[0] - r[0], this.item.point[1] - r[1]];
    const UpdateTextAreas = this.create_updateTextArea(this.item, point);
    return update(this.item, {
      point: { $set: point },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          this.item.text,
        ),
      },
    });
  }

  dragStart(tracker: ViewTracker, items: DocItem[], handle: number) {
    this._drag = new dragObject();
    this._drag.move_object(items, this.item, this.item.point);
    return { items: items, obj: this.item };
  }

  dragEnd(tracker: ViewTracker, items: DocItem[], handle: number) {
    this._drag = null;
    return { items: items, obj: this.item };
  }

  drag_handle(
    tracker: ViewTracker,
    items: DocItem[],
    handle: number,
  ): DocItem[] {
    return items;
  }

  //
  // Convert the handle to a cursor definition
  //

  getCursor(handle: number): string {
    if (handle <= -100 && handle > -200) {
      return 'text';
    }

    if (this.item.allow_resize) {
      switch (handle) {
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
      }
    }

    switch (handle) {
      case -1: // Not selected
        return 'auto';
      // case 0:		// Middle
      default:
        // Anything else
        return 'move';
    }
  }

  // Hide/show a text field
  showShow(index: number) {
    const text = this.layout_text_fields(
      this.item.rotation,
      update(this.item.text, {
        [index]: {
          show: { $set: !this.item.text[index].show },
        },
      }),
    );

    const UpdateTextAreas = this.create_updateTextArea(
      { ...this.item, text: text },
      this.item.point,
    );
    return update(this.item, {
      text: { $set: text },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          text,
        ),
      },
    });
  }

  showValue(index: number, value: string) {
    const text = this.layout_text_fields(
      this.item.rotation,
      update(this.item.text, {
        [index]: { value: { $set: value } },
      }),
    );

    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    return update(this.item, {
      text: { $set: text },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          text,
        ),
      },
    });
  }

  showPPP(part: number) {
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    return update(this.item, {
      part: { $set: part },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          part,
          this.item.text,
        ),
      },
    });
  }

  showName(index: number, value: string) {
    const text = this.layout_text_fields(
      this.item.rotation,
      update(this.item.text, {
        [index]: { description: { $set: value } },
      }),
    );

    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    return update(this.item, {
      text: { $set: text },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          text,
        ),
      },
    });
  }

  showDelete(index: number) {
    let text = this.item.text.slice();
    text.splice(index, 1);
    text = this.layout_text_fields(this.item.rotation, text);
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    return update(this.item, {
      text: { $set: text },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          text,
        ),
      },
    });
  }

  showAdd() {
    let field = {
      position: [0, 0],
      value: '..',
      description: 'Other',
      type: 2,
      show: true,
      display: TextDisplayMethod.ShowValueExtra,
    };

    const item = update(this.item, {
      text: { $push: [field] },
    });

    item.text = this.layout_text_fields(item.rotation, item.text);
    const UpdateTextAreas = this.create_updateTextArea(item, this.item.point);
    return update(item, {
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          item.text,
        ),
      },
    });
  }

  // Menu Handlers
  rotate(angle: number, rotation_centre?: Coordinate) {
    // tslint:disable-next-line: no-bitwise
    let mirror = this.item.rotation & 12;
    // tslint:disable-next-line: no-bitwise
    let rotation = this.item.rotation & 3;

    rotation = rotation + angle;
    if (rotation > 3) {
      rotation = 0;
    }
    if (rotation < 0) {
      rotation = 3;
    }
    // tslint:disable-next-line: no-bitwise
    rotation = rotation | mirror;

    let point = this.item.point;
    if (rotation_centre) {
      // Get the delta pre-rotation
      let scope = { dx: 0, dy: 0 };
      this._calcDelta(scope, this.item.rotation);

      // Rotate
      point = UtilityService.rotate_point(angle, rotation_centre, [
        this.item.point[0] + scope.dx,
        this.item.point[1] + scope.dy,
      ]);

      // Get the delta post-rotation
      scope = { dx: 0, dy: 0 };
      this._calcDelta(scope, rotation);
      point = [point[0] - scope.dx, point[1] - scope.dy];
    }

    const text = this.layout_text_fields(rotation, this.item.text);

    const UpdateTextAreas = this.create_updateTextArea(this.item, point);
    return update(this.item, {
      point: { $set: point },
      rotation: { $set: rotation },
      text: { $set: text },
      _active_points: { $set: null },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
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

  menu_mirror_v() {
    return this.menu_mirror(false);
  }

  menu_mirror_h() {
    return this.menu_mirror(true);
  }

  menu_mirror(h: boolean) {
    // We change the mirroring from the point of view
    // of the current rotation so the user isn't confused
    // tslint:disable-next-line: no-bitwise
    let r = this.item.rotation & 3;
    let rotation = this.item.rotation;
    if (r === 0 || r === 2) {
      // tslint:disable-next-line: no-bitwise
      rotation ^= h ? 8 : 4;
    } else {
      // tslint:disable-next-line: no-bitwise
      rotation ^= h ? 4 : 8;
    }

    // The mirror_h and mirror_v are unnecessary, so collapse the mirroring
    switch (rotation) {
      case 8:
        rotation = 6;
        break;
      case 9:
        rotation = 7;
        break;
      case 10:
        rotation = 4;
        break;
      case 11:
        rotation = 5;
        break;
      case 12:
        rotation = 2;
        break;
      case 13:
        rotation = 3;
        break;
      case 14:
        rotation = 0;
        break;
      case 15:
        rotation = 1;
        break;
    }

    return update(this.item, {
      rotation: { $set: rotation },
      _active_points: { $set: null },
    });
  }

  //
  // Handle creating a new version of this object
  //
  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    const point = snap.snap(p);
    const UpdateTextAreas = this.create_updateTextArea(this.item, point);
    let r = update(this.item, {
      point: { $set: point },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.part,
          this.item.text,
        ),
      },
    });

    return { obj: r, end: true, items: items };
  }

  end_add(tracker: ViewTracker, items: DocItem[]) {
    return { item: this.item, end: true, items: items };
  }

  complete_add() {
    return this.item;
  }

  //
  // After rotation we must place the text items correctly
  //
  layout_text_fields(rotation: number, text: SymbolTextItem[]) {
    let r = this._getBoundingRect(rotation);
    let width = r.x2 - r.x1;
    let height = r.y2 - r.y1;
    let spacing = 5;
    let text_stride = this.item.font_size + spacing;
    let name = text.find((t) => t.description === 'Name');

    // Determine the new rotation
    // tslint:disable-next-line: no-bitwise
    rotation = rotation & 3;
    let vertical = rotation === 0 || rotation === 2;

    let x, y;
    if (vertical) {
      // Display the name at the top
      y = -height;
      x = spacing;
    } else {
      // Display rest below if left or right
      y = spacing;
      x = -width;
    }

    if (name.show) {
      if (vertical) {
        // Display to right hand side if display up or down
        name.position = [x, y];
        y += text_stride;
      }
      // Display above if left or right
      else {
        name.position = [x, -height - text_stride];
      }
    }

    // First place the shown fields
    for (let i = 0; i < text.length; i++) {
      // Don't do the name
      if (text[i] === name) {
        continue;
      }

      // Place the other fields
      if (text[i].show) {
        text[i].position = [x, y];
        y += text_stride;
      }
    }

    return text;
  }

  public area_a(): [number, number] {
    throw new Error('Method not implemented.');
  }
  public area_b(): [number, number] {
    throw new Error('Method not implemented.');
  }

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    // Determine the delta:
    const symbol_delta = {
      dx: this.item.point[0],
      dy: this.item.point[1],
      dr: this.item.rotation,
      part: this.item.part,
      show_power: this.item.show_power,
      editingLibrary: false,
      scale_x: this.item.scale_x,
      scale_y: this.item.scale_y,
      heterogeneous: this.item._symbol.heterogeneous,
    };
    this.calcRefDelta(symbol_delta);
    const sa = this.makePointScaled(symbol_delta, a);
    const sb = this.makePointScaled(symbol_delta, b);

    const symbol_items: DocItem[] = [];
    const outline = this.outline();
    for (let index = 0; index < outline.items.length; ++index) {
      const item = outline.items[index];
      const updater = updateFactory(item);
      const i = updater.is_inside_rect(symbol_delta, sa, sb, symbol_items);
      if (i.length > 0) {
        // We have a match
        items.push(this.item);
        return items;
      }
    }

    // Now do the text:
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    for (let index = 0; index < this.item.textData.length; ++index) {
      if (
        this.item.text[index].show &&
        UpdateTextAreas[index].is_inside_rect(
          this.item.textData[index],
          delta,
          a,
          b,
        )
      ) {
        items.push(this.item);
        return items;
      }
    }

    return items;
  }

  is_inside(
    delta: DrawingDelta,
    tp: Coordinate,
    is_selected: boolean,
  ): IsInsideResult {
    if (is_selected && this.item.allow_resize) {
      var h = this.handles();
      for (var i = 0; i < h.length; ++i) {
        var px = 4;
        var a = [h[i][0] - px, h[i][1] - px];
        var b = [h[i][0] + px, h[i][1] + px];
        if (UtilityService.isPointInsideRect(tp, a, b)) {
          return { item: this.item as DocItem, handle: i + 1, distance: 0 };
        }
      }
    }

    // Determine the delta:
    var symbol_delta = {
      dx: this.item.point[0],
      dy: this.item.point[1],
      dr: this.item.rotation,
      part: this.item.part,
      show_power: this.item.show_power,
      editingLibrary: false,
      scale_x: this.item.scale_x,
      scale_y: this.item.scale_y,
      heterogeneous: this.item._symbol.heterogeneous,
    };
    this.calcRefDelta(symbol_delta);
    const stp = this.makePointScaled(symbol_delta, tp);

    let best_distance: number = null;
    let best_match = null;
    const candidates: IsInsideResult[] = [];

    const outline = this.outline();
    for (let index = 0; index < outline.items.length; ++index) {
      const item = outline.items[index];
      const updater = updateFactory(item);
      const i = updater.is_inside(symbol_delta, stp, is_selected);
      if (i) {
        // Check distance...
        i.distance =
          i.distance / Math.max(this.item.scale_x, this.item.scale_y);
        if (best_distance === null || i.distance < best_distance!) {
          best_match = i;
          best_distance = i.distance;
        }
      }
    }
    if (best_match) {
      candidates.push({
        item: this.item,
        distance: best_match.distance,
        handle: 0,
      });
    }

    // Now do the text:
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
    );
    for (let index = 0; index < this.item.textData.length; ++index) {
      if (this.item.text[index].show) {
        const text = UpdateTextAreas[index].on_isinside(
          this.item.textData[index],
          delta,
          tp,
        );

        switch (text) {
          case IsInsideTextResult.Inside_Text:
            candidates.push({
              item: this.item,
              distance: 0,
              handle: -(index + 100),
            });
            break;
          case IsInsideTextResult.Inside_Rect:
            candidates.push({
              item: this.item,
              distance: 0,
              handle: index + 100,
            });
            break;
        }
      }
    }

    if (candidates.length > 0) {
      // Find the best match from candidates
      let best: IsInsideResult = candidates[0];
      for (const c of candidates) {
          // Inside_Text/Rect has distance 0, which is good.
          // Outline match has calculated distance.
          // Prefer text if distance is 0?
          if ((c.distance || 0) < (best.distance || 0)) {
              best = c;
          }
           // Prefer text handle (handle != 0) if distances are equal?
           // Since text distance is 0, and outline distance could be > 0.
      }
      
      // If we have outline match (handle 0) and text match (handle != 0) with both distance 0 (or close),
      // we probably want to default to outline unless text was specifically closer?
      // But text distance is hardcoded to 0 in original code.
      
      // Original code preferred outline (returns immediately).
      // So if outline matches, we should probably prefer it IF we want to preserve exact behavior.
      // But we want to return the object with candidates attached.
      
      // User request: give moving the text object (i.e. the attributes) priority over moving the entire symbol.
      let winner = candidates.find(c => c.handle !== 0);
      if (!winner) {
          winner = candidates.find(c => c.handle === 0);
      }
      if (!winner) {
          winner = candidates[0];
      }
      
      return {
          ...winner,
          candidates: candidates
      };
    }

    return null;
  }

  private create_text_blocks(
    UpdateTextAreas: updateTextData[],
    item: dsnSymbol,
    part: number,
    text: SymbolTextItem[],
  ) {
    return text.map((t, index) => {
      const hideFromValue =
        (t.display === TextDisplayMethod.ShowNameValuePresent ||
          t.display === TextDisplayMethod.ShowValuePresent) &&
        t.value?.length == 0;
      const hideAlways = t.display === TextDisplayMethod.NeverShow;
      if (!(hideFromValue || hideAlways) && t.show) {
        let value = t.value;
        if (t.description === 'Ref' && this.parts() > 1) {
          value += String.fromCharCode(65 + part);
        }
        if (
          t.display == TextDisplayMethod.ShowNameValue ||
          t.display == TextDisplayMethod.ShowNameValuePresent
        ) {
          value = t.description + '=' + t.value;
        }
        return UpdateTextAreas[index].create_text_blocks(
          item.textData ? item.textData[index] : null,
          value,
        );
      } else {
        return null;
      }
    });
  }

  private create_updateTextArea(
    item: dsnSymbol,
    point: Coordinate,
  ): updateTextData[] {
    const r = item.text.map((t, index) => {
      const dragHandle = -(index + 100);
      const moveHandle = index + 100;
      const p: Coordinate = [
        t.position[0] + point[0],
        t.position[1] + point[1],
      ];
      return new updateTextData(
        p[0],
        p[1] + item.font_size,
        p,
        item,
        dragHandle,
        moveHandle,
        false,
        0,
        0,
        0,
        false,
        true,
      );
    });
    return r;
  }
}
