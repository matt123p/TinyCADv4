//
// The power object
//

import { updatePointBase } from './updatePointBase';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import {
  DrawingDelta,
  IsInsideResult,
  IsInside,
  ContextMenuList,
  CopyData,
  SimpleAdd,
} from './updateInterfaces';
import { dsnPin, Coordinate, DocItem } from '../model/dsnItem';
import { updateTextData } from './updateTextArea';
import { IsInsideTextResult } from '../model/textArea';
import { FindResult, ViewTracker } from '../model/dsnView';
import { Snap } from './snap';
import { UtilityLine } from '../util/utilityLine';
import { measureText, getFont } from '../util/measureText';

interface updateTextAreas {
  name: updateTextData;
  number: updateTextData;
}

export class updatePin extends updatePointBase implements SimpleAdd, IsInside {
  constructor(public item: dsnPin) {
    super(item);
  }

  post_construction() {
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    return update(this.item, {
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.name,
          this.item.number,
        ),
      },
    });
  }

  set_which(which: number, elec: number) {
    if (this.item.which !== which || this.item.elec !== elec) {
      const item = update(this.item, {
        which: { $set: which },
        elec: { $set: elec },
      });
      const UpdateTextAreas = this.create_updateTextArea(
        item,
        this.item.point,
        this.item.rotation,
      );
      return update(item, {
        textData: {
          $set: this.create_text_blocks(
            UpdateTextAreas,
            this.item,
            this.item.name,
            this.item.number,
          ),
        },
      });
    } else {
      return this.item;
    }
  }

  _move(tracker: ViewTracker, snap: Snap, p: Coordinate, items: DocItem[]) {
    // Restore the actual position (without snap)
    let point = this.item.point;
    if (tracker.a != null) {
      point = [tracker.a[0], tracker.a[1]];
    }

    // Move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time
    tracker.a = point.slice();

    // Snap
    point = snap.snap(point);

    if (point[0] !== this.item.point[0] || point[1] !== this.item.point[1]) {
      const UpdateTextAreas = this.create_updateTextArea(
        this.item,
        point,
        this.item.rotation,
      );
      return update(this.item, {
        textData: {
          $set: this.create_text_blocks(
            UpdateTextAreas,
            this.item,
            this.item.name,
            this.item.number,
          ),
        },
        point: { $set: point },
      });
    } else {
      return this.item;
    }
  }

  relative_move(r: Coordinate): DocItem {
    const p = [this.item.point[0] - r[0], this.item.point[1] - r[1]];
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      p,
      this.item.rotation,
    );
    return update(this.item, {
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.name,
          this.item.number,
        ),
      },
      point: { $set: p },
    });
  }

  shown(show_power: boolean, editingLibrary: boolean, heterogeneous: boolean) {
    switch (this.item.which) {
      case 4: // Power
        return show_power || heterogeneous;
      case 5: // Hidden
        return editingLibrary;
      default:
        return true;
    }
  }

  getFont() {
    return this.item.font_size + 'px ' + this.item.font_name;
  }

  updateText(handle: number, new_text: string): DocItem {
    switch (handle) {
      case -2:
        return update(this.item, {
          name: { $set: new_text },
        });
      case -3:
        return update(this.item, {
          number: { $set: new_text },
        });
    }

    return this.item;
  }

  find(findText: string): FindResult[] {
    if (this.item.name.toLowerCase().indexOf(findText) !== -1) {
      return [
        {
          symbol: 'Pin',
          text: this.item.name,
          a: this.item.point.slice(),
          id: this.item._id,
        },
      ];
    } else if (this.item.number.toLowerCase().indexOf(findText) !== -1) {
      return [
        {
          symbol: 'Pin',
          text: this.item.number,
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

  getBoundingRect() {
    // TODO:
    // This doesn't take into account the text length, text width or the pin width

    var x1 = this.item.point[0];
    var y1 = this.item.point[1];
    var x2 = x1;
    var y2 = y1;

    var spacing = this.item.length + this.text_space();

    switch (this.item.rotation) {
      case 1: // Pointing Down
        y2 = y1 + spacing;
        break;
      case 2: // Pointing Left
        x2 = x1 - spacing;
        break;
      case 3: // Pointing Up
        y2 = y1 - spacing;
        break;
      case 0: // Pointing Right
      default:
        x2 = x1 + spacing;
        break;
    }

    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    };
  }

  //
  // Convert the handle to a cursor definition
  //
  getCursor(handle: number): string {
    switch (handle) {
      case -1: // Not selected
        return 'auto';
      case -2: // Text icon
      case -3: // Text icon
        if (this.item.rotation === 1 || this.item.rotation === 3) {
          return 'vertical-text';
        } else {
          return 'text';
        }
      // case 0:		// Middle
      default:
        // Anything else
        return 'move';
    }
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

    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      point,
      rotation,
    );
    return update(this.item, {
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.name,
          this.item.number,
        ),
      },
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

  public area_a(): [number, number] {
    throw new Error('Method not implemented.');
  }
  public area_b(): [number, number] {
    throw new Error('Method not implemented.');
  }

  //
  // Handle creating a new version of this object
  //

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    // No, so just snap the point normally
    const point = snap.snap(p);

    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      point,
      this.item.rotation,
    );
    let r = update(this.item, {
      point: { $set: point },
      textData: {
        $set: this.create_text_blocks(
          UpdateTextAreas,
          this.item,
          this.item.name,
          this.item.number,
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

  handleKeyDown(
    handle: number,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
  ): DocItem {
    return this.item;
  }

  handleKeyPress(handle: number, keyCode: number): DocItem {
    return this.item;
  }

  on_mouse_click(
    handle: number,
    p: Coordinate,
    clear_selection: boolean,
  ): DocItem {
    let edit_position;

    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      p,
      this.item.rotation,
    );
    switch (handle) {
      case -2:
        edit_position = UpdateTextAreas.name.find_positon(
          this.item.textData.name,
          p,
        );
        return update(this.item, {
          textData: {
            name: {
              $set: UpdateTextAreas.name.mouse_click(
                this.item.textData.name,
                edit_position,
                clear_selection,
              ),
            },
          },
        });
      case -3:
        edit_position = UpdateTextAreas.number.find_positon(
          this.item.textData.number,
          p,
        );
        return update(this.item, {
          textData: {
            number: {
              $set: UpdateTextAreas.number.mouse_click(
                this.item.textData.number,
                edit_position,
                clear_selection,
              ),
            },
          },
        });
    }

    return this.item;
  }

  handleTextPaste(handle: number, text: string): DocItem {
    return this.item;
  }

  handleTextCopy(handle: number, cut: boolean): CopyData {
    return { item: this.item, copy_data: null };
  }

  wantKeyPress(handle: number) {
    return false;
  }

  public sizing() {
    return this.item.length <= 20 ? 20 : 30;
  }

  public text_space() {
    if (this.item.length <= 10) {
      return 0;
    }
    if (this.item.length <= 20) {
      return (this.item.length - 10) / 10 * (this.sizing()/8);
    }
    else {
      return this.sizing() / 8;
    }
  }

  public dot_size() {
    return this.sizing() / 6;
  }

  public line_size() {
    return this.item.length - this.dot_size() * 2;
  }

  is_inside_rect(
    delta: DrawingDelta,
    rect_a: Coordinate,
    rect_b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    // Is this pin visible?
    if (
      !(
        this.item.part === delta.part &&
        this.shown(delta.show_power, delta.editingLibrary, delta.heterogeneous)
      )
    ) {
      // Not visible
      return items;
    }

    // Is this point inside this item?
    const drawing_data = this.calculate_points(delta);
    const a = [drawing_data.anchor[0] - 2, drawing_data.anchor[1] - 2];
    let b;
    switch (drawing_data.rotation) {
      case 0: // 0 Degrees (right)
        b = [drawing_data.length + 2, 2];
        break;
      case 1: // 90 Degrees (down)
        b = [2, drawing_data.length + 2];
        break;
      case 2: // 180 Degrees (left)
        b = [-(drawing_data.length + 2), 2];
        break;
      case 3: // 270 Degrees (up)
        b = [2, -(drawing_data.length + 2)];
        break;
    }

    const pa = [Math.min(a[0], a[0] + b[0]), Math.min(a[1], a[1] + b[1])];
    const pb = [Math.max(a[0], a[0] + b[0]), Math.max(a[1], a[1] + b[1])];

    // Test against text areas & the line
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    if (
      (this.item.show_name &&
        UpdateTextAreas.name.is_inside_rect(
          this.item.textData.name,
          delta,
          rect_a,
          rect_b,
        )) ||
      (this.item.show_number &&
        UpdateTextAreas.number.is_inside_rect(
          this.item.textData.number,
          delta,
          rect_a,
          rect_b,
        )) ||
      (pa[0] >= rect_a[0] &&
        pa[1] >= rect_a[1] &&
        pb[0] <= rect_b[0] &&
        pb[1] <= rect_b[1])
    ) {
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
    // Is this pin visible?
    if (
      !(
        this.item.part === delta.part &&
        this.shown(delta.show_power, delta.editingLibrary, delta.heterogeneous)
      )
    ) {
      // Not visible
      return null;
    }

    // Test against text areas
    const UpdateTextAreas = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    if (this.item.textData.name) {
      const name = UpdateTextAreas.name.on_isinside(
        this.item.textData.name,
        delta,
        tp,
      );
      if (name !== IsInsideTextResult.Inside_None) {
        return { item: this.item, handle: 0, distance: 0 };
      }
    }

    if (this.item.textData.number) {
      const number = UpdateTextAreas.number.on_isinside(
        this.item.textData.number,
        delta,
        tp,
      );
      if (number !== IsInsideTextResult.Inside_None) {
        return { item: this.item, handle: 0, distance: 0 };
      }
    }

    // Is this point inside this item?
    const drawing_data = this.calculate_points(delta);
    const a = [drawing_data.anchor[0], drawing_data.anchor[1]];
    let b;
    switch (drawing_data.rotation) {
      case 0: // 0 Degrees (right)
        b = [a[0] + drawing_data.length, a[1]];
        break;
      case 1: // 90 Degrees (down)
        b = [a[0], a[1] + drawing_data.length];
        break;
      case 2: // 180 Degrees (left)
        b = [a[0] - drawing_data.length, a[1]];
        break;
      case 3: // 270 Degrees (up)
        b = [a[0], a[1] - drawing_data.length];
        break;
    }

    const dr = UtilityLine.distance2PointFromLine(tp, a, b);
    if (dr < 100) {
      return {
        item: this.item,
        handle: 0,
        distance: Math.sqrt(dr),
      };
    }

    return null;
  }

  public calculate_points(delta: DrawingDelta) {
    const dx = delta.dx ? delta.dx : 0;
    const dy = delta.dy ? delta.dy : 0;
    const dr = delta.dr ? delta.dr : 0;

    const dot_size = this.dot_size();
    const line_size = this.line_size();
    const text_space = this.text_space();
    let connect_size = 4;

    const point = UtilityService.rotateSymCordinate(dr, this.item.point);
    const anchor = [point[0] + dx, point[1] + dy];
    const rotation = UtilityService.rotateRotation(dr, this.item.rotation);
    let txt_rotation = 0;

    switch (rotation) {
      case 0:
        txt_rotation = 0;
        break;
      case 1:
        txt_rotation = 3;
        break;
      case 2:
        txt_rotation = 2;
        break;
      case 3:
        txt_rotation = 1;
        break;
    }

    const pa = [point[0] + line_size + dx, point[1] + dy];
    const pb = [point[0] + this.item.length + dx, point[1] - dot_size + dy];
    const pc = [point[0] + this.item.length + dx, point[1] + dot_size + 1 + dy];
    const pd = [point[0] + this.item.length + dx, point[1] + dy];

    let draw_dot = false;
    let draw_line = false;
    let draw_triangle = false;
    let draw_cross = false;
    let draw_no_connect = this.item.elec === 6;
    let hidden_colour = false;

    if (draw_no_connect) {
      connect_size = 4;
    }

    switch (this.item.which) {
      case 1: // Dot
        draw_line = true;
        draw_dot = true;
        break;
      case 2: // Clock
        draw_line = true;
        draw_triangle = true;
        break;
      case 3: // Dot Clock
        draw_line = true;
        draw_dot = true;
        draw_triangle = true;
        break;
      case 4: // Power
        draw_line = true;
        hidden_colour = true;
        break;
      case 5: // Hidden
        draw_line = true;
        hidden_colour = true;
        break;
      case 6: // Cross
        draw_line = false;
        draw_cross = true;
        connect_size = 2;
        break;
      default:
        // Normal
        if (this.item.length !== 0) {
          draw_line = true;
        } else {
          // zero length pins don't draw a line, just the "hotspot"
          draw_line = false;
        }
        break;
    }

    let pn1 = [point[0] + connect_size + dx, point[1] + connect_size + dy];
    let pn2 = [point[0] + connect_size + dx, point[1] - connect_size + dy];
    const length = draw_line && draw_dot ? line_size : this.item.length;

    // Text positions
    let spacing = this.item.length + text_space;
    spacing += draw_triangle ? dot_size * 2 : 0;

    let pta = [point[0] + spacing, point[1] + this.item.font_size / 2.0 - 2];
    let number_gap = text_space;
    // Compensate for text block x=1 offset: for right/top (txt_rotation 0,1)
    // the offset pushes text toward the tip, but for left/bottom (2,3) it
    // pushes toward the body. Add 2 units for left/bottom to equalise.
    if (txt_rotation === 0 || txt_rotation === 1) {
      number_gap -= 2;
    }
    let ptb = [
      point[0] + number_gap + this.item.number_pos,
      point[1] - this.item.font_size * 0.2,
    ];

    return {
      anchor: anchor,
      point: point,
      pa: pa,
      pb: pb,
      pc: pc,
      pd: pd,
      length: length,
      pta: pta,
      ptb: ptb,
      pn1: pn1,
      pn2: pn2,
      draw_dot: draw_dot,
      draw_line: draw_line,
      draw_triangle: draw_triangle,
      draw_cross: draw_cross,
      draw_no_connect: draw_no_connect,
      hidden_colour: hidden_colour,
      spacing: spacing,
      txt_rotation: txt_rotation,
      rotation: rotation,
    };
  }

  private create_text_blocks(
    UpdateTextAreas: updateTextAreas,
    item: dsnPin,
    name: string,
    number: string,
  ) {
    {
      return {
        name: UpdateTextAreas.name.create_text_blocks(
          item.textData?.name,
          name,
        ),
        number: UpdateTextAreas.number.create_text_blocks(
          item.textData?.number,
          number,
        ),
      };
    }
  }

  private create_updateTextArea(
    item: dsnPin,
    point: Coordinate,
    rotation: number,
  ): updateTextAreas {
    const dot_size = this.dot_size();
    const text_space = this.text_space();

    var txt_rotation = 0;

    switch (rotation) {
      case 0:
        txt_rotation = 0;
        break;
      case 1:
        txt_rotation = 3;
        break;
      case 2:
        txt_rotation = 2;
        break;
      case 3:
        txt_rotation = 1;
        break;
    }

    let draw_dot = false;
    let draw_triangle = false;

    switch (item.which) {
      case 1: // Dot
        draw_dot = true;
        break;
      case 2: // Clock
        draw_triangle = true;
        break;
      case 3: // Dot Clock
        draw_dot = true;
        draw_triangle = true;
        break;
      case 4: // Power
        break;
      case 5: // Hidden
        break;
      case 6: // Cross
        break;
      case 8: // Clock Low
        draw_triangle = true;
        break;
      case 10: // Falling Edge Clock
        draw_triangle = true;
        break;
      default:
        // Normal
        break;
    }

    // Text positions
    let spacing = item.length + text_space;
    spacing += draw_triangle ? dot_size * 2 : 0;

    let pta = [point[0] + spacing, point[1] + this.item.font_size / 2.0 - 2];
    let number_gap = text_space;
    // Compensate for text block x=1 offset: for right/top (txt_rotation 0,1)
    // the offset pushes text toward the tip, but for left/bottom (2,3) it
    // pushes toward the body. Add 2 units for left/bottom to equalise.
    if (txt_rotation === 0 || txt_rotation === 1) {
      number_gap -= 2;
    }
    let ptb = [
      point[0] + number_gap + this.item.number_pos,
      point[1] - this.item.font_size * 0.2,
    ];

    return {
      name: new updateTextData(
        pta[0],
        pta[1],
        point,
        item,
        -2,
        0,
        false,
        txt_rotation,
        0,
        0,
        false,
        false,
      ),
      number: new updateTextData(
        ptb[0],
        ptb[1],
        point,
        item,
        -3,
        0,
        false,
        txt_rotation,
        0,
        0,
        false,
        false,
      ),
    };
  }
}
