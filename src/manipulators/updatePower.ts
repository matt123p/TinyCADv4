//
// The power object
//

import { dragObject } from './dragObject';
import update from 'immutability-helper';
import { UtilityService } from '../util/utilityService';
import { Snap } from './snap';
import {
  SimpleAdd,
  MoveAdd,
  SimpleDrag,
  IsInside,
  DrawingDelta,
  IsInsideResult,
} from './updateInterfaces';
import { updatePointTextBase } from './updatePointTextBase';
import { dsnPower, Coordinate, DocItem } from '../model/dsnItem';
import { updateTextData } from './updateTextArea';
import { IsInsideTextResult } from '../model/textArea';
import { ViewTracker } from '../model/dsnView';
import { updateWire } from './updateWire';

export class updatePower
  extends updatePointTextBase
  implements SimpleAdd, MoveAdd, SimpleDrag, IsInside
{
  constructor(public item: dsnPower) {
    super(item);
  }

  post_construction() {
    return this.updateText(-2, this.item.text);
  }

  // Get a netlist label name for this power symbol
  get_power_label() {
    // Use the power value as netlist name where it is available
    if (this.item.text && this.item.text !== '') {
      return this.item.text;
    }

    // Differentiate between the different power symbol shapes
    // and use fixed/default netlist names.
    switch (this.item.which) {
      case 0: // Bar
        return 'TCPOWERBAR';
      case 1: // Circle
        return 'TCPOWERCIRCLE';
      case 2: // Wave
        return 'TCPOWERWAVE';
      case 3: // Arrow
        return 'TCPOWERARROW';
      case 4: // Earth
        return 'TCPOWEREARTH';
    }

    // Just in case... (or rather not a case ;-)
    return 'TCPOWER';
  }

  set_which(n: number) {
    if (this.item.which !== n) {
      const item = update(this.item, {
        which: { $set: n },
      });
      const UpdateTextArea = this.create_updateTextArea(
        item,
        this.item.point,
        this.item.rotation,
      );
      return update(item, {
        textData: {
          $set: UpdateTextArea.create_text_blocks(
            this.item.textData,
            this.item.text,
          ),
        },
      });
    } else {
      return this.item;
    }
  }

  active_points() {
    return [this.item.point];
  }

  _move(tracker: ViewTracker, snap: Snap, p: Coordinate, items?: DocItem[]) {
    // Restore the actual position (without snap)
    let point = this.item.point.slice();
    if (tracker.a != null) {
      point = [tracker.a[0], tracker.a[1]];
    }

    // Move
    point = [point[0] + p[0], point[1] + p[1]];

    // Save state for next time
    tracker.a = point.slice();

    // Snap - during drag operations, skip magnetic snapping for performance
    // Magnetic snapping is only needed when adding new items, not when dragging existing ones
    let _magnetic = null;
    point = snap.snap(point);

    // Update
    if (this.item.point[0] !== point[0] || this.item.point[1] !== point[1]) {
      return update(this.item, {
        point: { $set: point },
        _magnetic: { $set: _magnetic },
      });
    } else {
      return this.item;
    }
  }

  dragStart(tracker: ViewTracker, items: DocItem[], handle: number) {
    tracker._drag = new dragObject();
    tracker._drag.move_object(items, this.item, this.item.point);

    return { items: items, obj: this.item };
  }

  dragEnd(tracker: ViewTracker, items: DocItem[], handle: number) {
    if (this.item._magnetic) {
      // Now we have to split the wire we are joining to
      if (this.item._magnetic.wire != null) {
        const update_mag_wire = new updateWire(this.item._magnetic.wire);
        let dr = update_mag_wire.split_wire(this.item._magnetic.point, items);
        items = UtilityService.updateDupArray(
          dr.items,
          this.item._magnetic.wire,
          dr.obj,
        );
      }
    }
    tracker._drag = null;

    let obj = update(this.item, {
      _magnetic: { $set: null },
    });

    return { items: items, obj: obj };
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
    return update(this.item, {
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

  //
  // Handle creating a new version of this object
  //

  move_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    return this.item;
  }

  drag_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ): DocItem {
    return this.item;
  }

  drag_handle(
    tracker: ViewTracker,
    items: DocItem[],
    handle: number,
  ): DocItem[] {
    return items;
  }

  mousemove_add(
    p: Coordinate,
    snap: Snap,
    tracker: ViewTracker,
    items: DocItem[],
  ) {
    // Are we close to a magnetic point?
    let _magnetic = snap.snap_magnetic(p, true, items);

    let r = update(this.item, {
      _no_show: { $set: true },
      _magnetic: { $set: _magnetic },
    });

    return { item: r, display: _magnetic != null };
  }

  begin_add(p: Coordinate, tracker: ViewTracker, snap: Snap, items: DocItem[]) {
    // Are we close to a magnetic point?
    let _magnetic = snap.snap_magnetic(p, true, items);
    let point = this.item.point;
    if (_magnetic == null) {
      // No, so just snap the point normally
      point = snap.snap(p);
    } else {
      point = _magnetic.point;

      // Now we have to split the wire we are joining to
      if (_magnetic.wire != null) {
        const update_mag_wire = new updateWire(_magnetic.wire);
        let dr = update_mag_wire.split_wire(this.item._magnetic.point, items);
        items = UtilityService.updateDupArray(
          dr.items,
          this.item._magnetic.wire,
          dr.obj,
        );
      }
    }

    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      point,
      this.item.rotation,
    );
    let r = update(this.item, {
      point: { $set: point },
      _no_show: { $set: null },
      textData: {
        $set: UpdateTextArea.create_text_blocks(
          this.item.textData,
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

  is_inside_rect(
    delta: DrawingDelta,
    rect_a: Coordinate,
    rect_b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    // Is this inside the line?
    const POWER_SIZE = 14;
    const a = [this.item.point[0] - 2, this.item.point[1]];
    const b = [this.item.point[0] + 2, this.item.point[1] + POWER_SIZE];
    const pa = [Math.min(a[0], a[0] + b[0]), Math.min(a[1], a[1] + b[1])];
    const pb = [Math.max(a[0], a[0] + b[0]), Math.max(a[1], a[1] + b[1])];
    const prect_a = UtilityService.rotatePointMsg(
      this.item.rotation,
      this.item.point,
      rect_a,
    );
    const prect_b = UtilityService.rotatePointMsg(
      this.item.rotation,
      this.item.point,
      rect_b,
    );

    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    if (
      UpdateTextArea.is_inside_rect(
        this.item.textData,
        delta,
        rect_a,
        rect_b,
      ) ||
      (pa[0] >= prect_a[0] &&
        pa[1] >= prect_a[1] &&
        pb[0] <= prect_b[0] &&
        pb[1] <= prect_b[1])
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
    // Test against text areas
    if (this.item.textData) {
      const UpdateTextArea = this.create_updateTextArea(
        this.item,
        this.item.point,
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

    // Is this point inside this item?
    const p = UtilityService.rotatePointMsg(
      this.item.rotation,
      this.item.point,
      tp,
    );

    // Is this inside the line?
    const POWER_SIZE = 14;
    const pa = [this.item.point[0], this.item.point[1] + POWER_SIZE];
    const a = [this.item.point[0] - 2, this.item.point[1]];
    const b = [pa[0] + 2, pa[1]];
    if (UtilityService.isPointInsideRect(p, a, b)) {
      // We have a hit!
      return { item: this.item, distance: 0, handle: 0 };
    }

    // Is this inside the shape?
    let shape_a: Coordinate;
    let shape_b: Coordinate;

    if (this.item.which === 0) {
      // Bar
      shape_a = [
        this.item.point[0] - POWER_SIZE / 2 - 2,
        this.item.point[1] + POWER_SIZE - 2,
      ];
      shape_b = [
        this.item.point[0] + POWER_SIZE / 2 + 3,
        this.item.point[1] + POWER_SIZE + 2,
      ];
    } else {
      // Shape
      shape_a = [
        this.item.point[0] - POWER_SIZE / 2,
        this.item.point[1] + POWER_SIZE,
      ];
      shape_b = [
        this.item.point[0] + POWER_SIZE / 2,
        this.item.point[1] + POWER_SIZE * 2,
      ];
    }

    if (UtilityService.isPointInsideRect(p, shape_a, shape_b)) {
      // We have a hit!
      return { item: this.item, distance: 0, handle: 0 };
    }

    return null;
  }

  protected create_updateTextArea(
    item: dsnPower,
    point: Coordinate,
    rotation: number,
  ): updateTextData {
    const POWER_SIZE = 14;
    let SPACING;
    if (item.which !== 0) {
      SPACING = POWER_SIZE * 2 + POWER_SIZE / 4;
    } else {
      SPACING = POWER_SIZE + POWER_SIZE / 4;
    }

    SPACING += item.font_size;

    return new updateTextData(
      point[0],
      point[1] + SPACING,
      point,
      item,
      -2,
      0,
      false,
      rotation,
      0,
      0,
      true,
      false,
    );
  }
}
