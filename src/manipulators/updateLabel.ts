//
// The label object
//

import { IsInside, DrawingDelta, IsInsideResult } from './updateInterfaces';
import { updatePointTextBase } from './updatePointTextBase';
import { measureText, getFont } from '../util/measureText';
import update from 'immutability-helper';
import { dsnLabel, Coordinate, DocItem } from '../model/dsnItem';
import { IsInsideTextResult } from '../model/textArea';
import { updateTextData } from './updateTextArea';
import { UtilityService } from '../util/utilityService';

export class updateLabel extends updatePointTextBase implements IsInside {
  constructor(public item: dsnLabel) {
    // Call Super constructor
    super(item);
  }

  post_construction() {
    return this.updateText(-2, this.item.text);
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
    item: dsnLabel,
    point: Coordinate,
    rotation: number,
  ): updateTextData {
    let drawWidth = measureText(getFont(item), item.text);
    let height = item.font_size * 1.5;
    let spacing = height / 5;
    let arrow_distance = height;
    let extra_width = 0;
    switch (item.which) {
      case 1: // label_in
      case 2: // label_out
        extra_width += arrow_distance + spacing;
        break;
      case 3: // label_io
        extra_width += arrow_distance * 2;
        break;
    }

    let i_spacing = !(item.which === 1 || item.which === 3)
      ? 0
      : -arrow_distance;

    let text_point = [];

    // Draw the outline
    if (item.which !== 0) {
      text_point = [point[0] - i_spacing, point[1] + item.font_size / 2];

      // We must rotate the rotation to match what TinyCAD.exe does
      switch (rotation) {
        case 0:
          rotation = 2;
          break;
        case 1:
          rotation = 3;
          break;
        case 2:
          rotation = 0;
          break;
        case 3:
          rotation = 1;
          break;
      }
    } else {
      text_point = [point[0], point[1]];
    }

    return new updateTextData(
      text_point[0],
      text_point[1],
      point,
      item,
      -2,
      0,
      false,
      (4 - rotation) % 4,
      drawWidth,
      0,
      false,
      false,
    );
  }
}
