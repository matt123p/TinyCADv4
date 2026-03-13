//
// The label object
//

import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { updatePointTextBase } from './updatePointTextBase';
import {
  dsnBusLabel,
  Coordinate,
  DocItem,
  dsnPointTextBase,
} from '../model/dsnItem';
import { DrawingDelta, IsInsideResult } from './updateInterfaces';
import { IsInsideTextResult, TextAreaData } from '../model/textArea';
import { updateTextData } from './updateTextArea';

export class updateBusLabel extends updatePointTextBase {
  constructor(public item: dsnBusLabel) {
    // Call Super constructor
    super(item);
  }

  post_construction() {
    return this.updateText(-2, this.item.text);
  }

  // Rotation functions
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

  is_inside_rect(
    delta: DrawingDelta,
    a: Coordinate,
    b: Coordinate,
    items: DocItem[],
  ): DocItem[] {
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    if (UpdateTextArea.is_inside_rect(this.item.textData, delta, a, b)) {
      // We have a hit!
      items.push(this.item);
    }

    return items;
  }

  handles(): Coordinate[] {
    return [this.item.point];
  }

  is_inside(
    delta: DrawingDelta,
    tp: Coordinate,
    is_selected: boolean,
  ): IsInsideResult {
    // Test against text areas
    const UpdateTextArea = this.create_updateTextArea(
      this.item,
      this.item.point,
      this.item.rotation,
    );
    // Check the handle(s)
    if (is_selected) {
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

    const text = UpdateTextArea.on_isinside(this.item.textData, delta, tp);
    switch (text) {
      case IsInsideTextResult.Inside_Text:
        return { item: this.item, distance: 0, handle: -2 };
      case IsInsideTextResult.Inside_Rect:
        return { item: this.item, distance: 0, handle: 0 };
    }

    return null;
  }
  protected create_updateTextArea(
    item: dsnPointTextBase,
    point: Coordinate,
    rotation: number,
  ): updateTextData {
    return new updateTextData(
      point[0],
      point[1],
      point,
      item,
      -2,
      0,
      false,
      rotation,
      0,
      0,
      false,
      false,
    );
  }
}
