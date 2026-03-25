import { measureText, getFont } from '../util/measureText';
import { UtilityService } from '../util/utilityService';
import update from 'immutability-helper';
import { Coordinate, Text } from '../model/dsnItem';
import { TextArea, TextAreaData, IsInsideTextResult } from '../model/textArea';
import { DrawingDelta } from './updateInterfaces';

export class updateTextData {
  private readonly textArea: TextArea;

  constructor(
    drawX: number,
    drawY: number,
    drawPoint: Coordinate,
    drawItem: Text,
    dragHandle: number,
    moveHandle: number,
    drawMultiline: boolean,
    drawRotation: number,
    drawWidth: number,
    drawHeight: number,
    drawCentre: boolean,
    allowMove: boolean,
  ) {
    this.textArea = {
      drawItem: drawItem,
      dragHandle: dragHandle,
      moveHandle: moveHandle,
      drawX: drawX,
      drawY: drawY,
      drawPoint: drawPoint,
      drawMultiline: drawMultiline,
      drawRotation: drawRotation % 4,
      drawWidth: drawWidth,
      drawHeight: drawHeight,
      drawCentre: drawCentre,
      font_size: drawItem.font_size,
      allowMove: allowMove,
    };
  }

  public create_text_blocks(textAreaData: TextAreaData, drawText: string) {
    return this.makeTextArea(textAreaData, drawText);
  }

  public clear_sel(textAreaData: TextAreaData) {
    return update(textAreaData, {
      sel_start: { $set: -1 },
      sel_end: { $set: -1 },
    });
  }

  public delete_sel(textAreaData: TextAreaData) {
    let txt = textAreaData.drawText;
    if (textAreaData.sel_start !== textAreaData.sel_end) {
      let sel_start = Math.min(textAreaData.sel_start, textAreaData.sel_end);
      let sel_end = Math.max(textAreaData.sel_start, textAreaData.sel_end);
      txt = txt.substring(0, sel_start) + txt.substring(sel_end);
      textAreaData = this.change_edit_position(
        textAreaData,
        sel_start,
        true,
        false,
        txt,
      );
      textAreaData = this.makeTextArea(textAreaData, txt);
      return textAreaData;
    }

    return textAreaData;
  }

  public update_sel_begin(textAreaData: TextAreaData, shiftKey: boolean) {
    if (shiftKey) {
      if (textAreaData.sel_start === textAreaData.sel_end) {
        return update(textAreaData, {
          sel_start: { $set: textAreaData.edit_position },
        });
      } else {
        return textAreaData;
      }
    } else {
      return update(textAreaData, {
        sel_start: { $set: -1 },
        sel_end: { $set: -1 },
      });
    }
  }

  update_sel_end(textAreaData: TextAreaData, shiftKey: boolean) {
    if (shiftKey) {
      return update(textAreaData, {
        sel_end: { $set: textAreaData.edit_position },
      });
    }
    return textAreaData;
  }

  change_edit_position(
    textAreaData: TextAreaData,
    adj: number,
    clear_selection: boolean,
    inc: boolean,
    text: string,
  ): TextAreaData {
    let edit_position: number;
    if (inc) {
      edit_position = textAreaData.edit_position + adj;
    } else {
      edit_position = adj;
    }

    if (edit_position < 0) {
      edit_position = 0;
    }
    if (edit_position > text.length) {
      edit_position = text.length;
    }

    if (clear_selection) {
      return update(textAreaData, {
        edit_position: { $set: edit_position },
        sel_start: { $set: edit_position },
        sel_end: { $set: edit_position },
      });
    } else {
      return update(textAreaData, {
        edit_position: { $set: edit_position },
      });
    }
  }

  private set_preferred_x(textAreaData: TextAreaData, preferredX: number | null) {
    return update(textAreaData, {
      preferred_x: { $set: preferredX },
    });
  }

  private get_current_x(textAreaData: TextAreaData) {
    return textAreaData.textEdit?.x ?? 1;
  }

  mouse_click(
    textAreaData: TextAreaData,
    edit_position: number,
    clear_selection: boolean,
  ) {
    if (clear_selection) {
      textAreaData = update(textAreaData, {
        edit_position: { $set: edit_position },
        sel_start: { $set: edit_position },
        sel_end: { $set: edit_position },
      });
      return this.set_preferred_x(
        this.makeTextArea(textAreaData, textAreaData.drawText),
        null,
      );
    } else {
      textAreaData = update(textAreaData, {
        sel_end: { $set: edit_position },
        edit_position: { $set: edit_position },
      });
      return this.set_preferred_x(
        this.makeTextArea(textAreaData, textAreaData.drawText),
        null,
      );
    }
  }

  select_word(textAreaData: TextAreaData, edit_position: number) {
    const text = textAreaData.drawText;
    if (text.length === 0) {
      return this.set_preferred_x(this.makeTextArea(textAreaData, text), null);
    }

    let anchor = Math.max(0, Math.min(edit_position, text.length - 1));
    let category = this.get_char_category(text[anchor]);

    if (
      category === 'space' &&
      anchor > 0 &&
      this.get_char_category(text[anchor - 1]) !== 'space'
    ) {
      anchor -= 1;
      category = this.get_char_category(text[anchor]);
    }

    let start = anchor;
    let end = anchor + 1;

    while (start > 0 && this.get_char_category(text[start - 1]) === category) {
      --start;
    }

    while (end < text.length && this.get_char_category(text[end]) === category) {
      ++end;
    }

    return this.set_preferred_x(
      this.makeTextArea(
        update(textAreaData, {
          edit_position: { $set: end },
          sel_start: { $set: start },
          sel_end: { $set: end },
        }),
        text,
      ),
      null,
    );
  }

  on_keydown(
    textAreaData: TextAreaData,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    metaKey: boolean,
  ) {
    let text = textAreaData.drawText;
    const useWordNavigation = this.isWordNavigationModifier(ctrlKey, altKey);
    const useLineNavigation = this.isLineNavigationModifier(ctrlKey, metaKey);
    let preservePreferredX = false;

    switch (keyCode) {
      case 65: // A
        if (ctrlKey || metaKey) {
          textAreaData = this.select_all(textAreaData);
        }
        break;
      case 35: // End
        textAreaData = this.update_sel_begin(textAreaData, shiftKey);
        textAreaData = this.change_edit_position(
          textAreaData,
          this.find_line_end(textAreaData),
          false,
          false,
          text,
        );
        textAreaData = this.update_sel_end(textAreaData, shiftKey);
        break;
      case 36: // Home
        textAreaData = this.update_sel_begin(textAreaData, shiftKey);
        textAreaData = this.change_edit_position(
          textAreaData,
          this.find_line_start(textAreaData),
          false,
          false,
          text,
        );
        textAreaData = this.update_sel_end(textAreaData, shiftKey);
        break;
      case 37: // Left
        textAreaData = this.update_sel_begin(textAreaData, shiftKey);
        if (useLineNavigation) {
          textAreaData = this.change_edit_position(
            textAreaData,
            this.find_line_start(textAreaData),
            false,
            false,
            text,
          );
        } else if (useWordNavigation) {
          textAreaData = this.change_edit_position(
            textAreaData,
            this.find_previous_word_boundary(text, textAreaData.edit_position),
            false,
            false,
            text,
          );
        } else {
          textAreaData = this.change_edit_position(
            textAreaData,
            -1,
            false,
            true,
            text,
          );
        }
        textAreaData = this.update_sel_end(textAreaData, shiftKey);
        break;
      case 38: // Up
        {
          textAreaData = this.update_sel_begin(textAreaData, shiftKey);
          const preferredX = textAreaData.preferred_x ?? this.get_current_x(textAreaData);
          textAreaData = this.set_preferred_x(textAreaData, preferredX);
          const pos = this.move_block(textAreaData, true);
          textAreaData = this.change_edit_position(
            textAreaData,
            pos,
            false,
            false,
            text,
          );
          textAreaData = this.update_sel_end(textAreaData, shiftKey);
          preservePreferredX = true;
        }
        break;
      case 39: // Right
        textAreaData = this.update_sel_begin(textAreaData, shiftKey);
        if (useLineNavigation) {
          textAreaData = this.change_edit_position(
            textAreaData,
            this.find_line_end(textAreaData),
            false,
            false,
            text,
          );
        } else if (useWordNavigation) {
          textAreaData = this.change_edit_position(
            textAreaData,
            this.find_next_word_boundary(text, textAreaData.edit_position),
            false,
            false,
            text,
          );
        } else {
          textAreaData = this.change_edit_position(
            textAreaData,
            1,
            false,
            true,
            text,
          );
        }
        textAreaData = this.update_sel_end(textAreaData, shiftKey);
        break;
      case 40: // Down
        {
          textAreaData = this.update_sel_begin(textAreaData, shiftKey);
          const preferredX = textAreaData.preferred_x ?? this.get_current_x(textAreaData);
          textAreaData = this.set_preferred_x(textAreaData, preferredX);
          const pos = this.move_block(textAreaData, false);
          textAreaData = this.change_edit_position(
            textAreaData,
            pos,
            false,
            false,
            text,
          );
          textAreaData = this.update_sel_end(textAreaData, shiftKey);
          preservePreferredX = true;
        }
        break;
      case 8: // Backspace
        if (textAreaData.sel_start !== textAreaData.sel_end) {
          textAreaData = this.delete_sel(textAreaData);
          text = textAreaData.drawText;
        } else if (useLineNavigation) {
          const lineStart = this.find_line_start(textAreaData);
          if (lineStart !== textAreaData.edit_position) {
            text =
              text.substring(0, lineStart) +
              text.substring(textAreaData.edit_position);
            textAreaData = this.change_edit_position(
              textAreaData,
              lineStart,
              false,
              false,
              text,
            );
          }
        } else if (useWordNavigation) {
          const wordStart = this.find_previous_word_boundary(
            text,
            textAreaData.edit_position,
          );
          if (wordStart !== textAreaData.edit_position) {
            text =
              text.substring(0, wordStart) +
              text.substring(textAreaData.edit_position);
            textAreaData = this.change_edit_position(
              textAreaData,
              wordStart,
              false,
              false,
              text,
            );
          }
        } else if (textAreaData.edit_position > 0 && text.length > 0) {
          text =
            text.substring(0, textAreaData.edit_position - 1) +
            text.substring(textAreaData.edit_position);
          textAreaData = this.change_edit_position(
            textAreaData,
            -1,
            false,
            true,
            text,
          );
        }
        break;
      case 46: // Delete
        if (textAreaData.sel_start !== textAreaData.sel_end) {
          textAreaData = this.delete_sel(textAreaData);
          text = textAreaData.drawText;
        } else if (useWordNavigation) {
          const wordEnd = this.find_next_word_boundary(
            text,
            textAreaData.edit_position,
          );
          if (wordEnd !== textAreaData.edit_position) {
            text =
              text.substring(0, textAreaData.edit_position) +
              text.substring(wordEnd);
          }
        } else if (
          textAreaData.edit_position < textAreaData.drawText.length &&
          text.length > 0
        ) {
          text =
            text.substring(0, textAreaData.edit_position) +
            text.substring(textAreaData.edit_position + 1);
        }
        break;
      default:
      // Unhandled key
    }

    textAreaData = this.makeTextArea(textAreaData, text);
    textAreaData = this.set_preferred_x(
      textAreaData,
      preservePreferredX ? textAreaData.preferred_x : null,
    );
    return textAreaData;
  }

  public on_keypress(textAreaData: TextAreaData, keyCode: number) {
    let r = this.delete_sel(textAreaData);
    let text = r.drawText;
    text =
      text.substring(0, textAreaData.edit_position) +
      String.fromCharCode(keyCode) +
      text.substring(textAreaData.edit_position);

    r = this.change_edit_position(r, 1, false, true, text);
    r = this.makeTextArea(r, text);
    r = this.set_preferred_x(r, null);
    return r;
  }

  public on_paste(textAreaData: TextAreaData, pasteText: string) {
    // Remove any selection
    let r = this.delete_sel(textAreaData);
    let text = r.drawText;

    // Insert this text in to the current location
    text =
      text.substring(0, textAreaData.edit_position) +
      pasteText +
      text.substring(textAreaData.edit_position);
    r = this.change_edit_position(r, pasteText.length, true, true, text);
    r = this.makeTextArea(r, text);
    r = this.set_preferred_x(r, null);

    return r;
  }

  // Cut or Copy
  public on_copy(textAreaData: TextAreaData, cut: boolean) {
    // Remove any selection
    const sel_start = Math.min(textAreaData.sel_start, textAreaData.sel_end);
    const sel_end = Math.max(textAreaData.sel_start, textAreaData.sel_end);
    const copy_data = textAreaData.drawText.substring(sel_start, sel_end);

    if (cut) {
      const nextTextData = this.delete_sel(textAreaData);
      return {
        textData: this.set_preferred_x(nextTextData, null),
        text: nextTextData.drawText,
        copy_data: copy_data,
      };
    } else {
      return {
        textData: textAreaData,
        text: textAreaData.drawText,
        copy_data: copy_data,
      };
    }
  }

  public transform(
    textAreaData: TextAreaData,
    dx: number,
    dy: number,
    dr: number,
    scale_x: number,
    scale_y: number,
    offsetY: number = 0,
  ): string {
    const t = this.transform_matrix(textAreaData, dx, dy, dr, scale_x, scale_y);
    // Apply offsetY perpendicular to the text direction to account for
    // text descent. Positive offsetY moves text closer to the pin line:
    //   - horizontal text: increase Y (move down)
    //   - vertical text (270°): increase X (move right)
    const adjustedOffset = offsetY * 0.5;
    if (t.rotate === 270) {
      t.translate[0] += adjustedOffset;
    } else {
      t.translate[1] += adjustedOffset;
    }
    let transform = `translate( ${t.translate[0]} ${t.translate[1]})`;
    if (t.rotate !== 0) {
      transform += ` rotate( 270 0 0 )`;
    }

    return transform;
  }

  // Find the nearest edit location within a block of a specific
  // x co-ordinate
  public find_positon(textAreaData: TextAreaData, p: Coordinate) {
    const sd = {
      dx: 0,
      dy: 0,
      dr: 0,
      part: 0,
      show_power: false,
      editingLibrary: false,
      heterogeneous: false,
      scale_x: 1.0,
      scale_y: 1.0,
    };
    const p1 = this.rotateMsg(textAreaData, sd, p);
    let nearestBlock = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < textAreaData.textBlocks.length; ++i) {
      let b = textAreaData.textBlocks[i];
      const top = b.y - b.height;
      const bottom = b.y;

      if (b.y >= p1[1] && b.y - b.height <= p1[1]) {
        return this.get_position_in_block(b, p1[0]);
      }

      const distance =
        p1[1] < top ? top - p1[1] : p1[1] > bottom ? p1[1] - bottom : 0;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestBlock = b;
      }
    }

    if (nearestBlock) {
      return this.get_position_in_block(nearestBlock, p1[0]);
    }

    return textAreaData.drawText.length;
  }

  // Find the block above (up=true) or below (up=false) the
  // current editing position and move to that block
  public move_block(textAreaData: TextAreaData, up: boolean) {
    if (!textAreaData.textEdit) {
      return textAreaData.edit_position;
    }

    let best_dist_x = 0;
    let best_dist_y = 0;
    let best_block = null;

    // TODO: Keep track of the target position from moving up/down
    const target_pos = textAreaData.preferred_x ?? textAreaData.textEdit.x;

    for (let i = 0; i < textAreaData.textBlocks.length; ++i) {
      let b = textAreaData.textBlocks[i];

      // is this block above/below the current block?
      if (
        (up && b.y < textAreaData.textEdit.y) ||
        (!up && b.y > textAreaData.textEdit.y)
      ) {
        let dist_y = Math.abs(b.y - textAreaData.textEdit.y);
        let dist_x = target_pos - (b.x + b.width);

        // Does this block actually hit our x-co-ordinate?
        if (target_pos >= b.x && target_pos <= b.x + b.width) {
          dist_x = 0;
        }

        if (dist_x >= 0) {
          if (
            best_block == null ||
            dist_y < best_dist_y ||
            (dist_y === best_dist_y && dist_x < best_dist_x)
          ) {
            best_block = b;
            best_dist_x = dist_x;
            best_dist_y = dist_y;
          }
        }
      }
    }

    // Ok, where is the editing position based on the block?
    if (best_block != null) {
      let bt = this.find_best_text(best_block.value, target_pos - best_block.x);
      if (
        bt.exact >= best_block.value.length &&
        best_block.start + bt.exact !== textAreaData.drawText.length
      ) {
        --bt.exact;
      }
      return best_block.start + bt.exact;
    }

    return textAreaData.edit_position;
  }

  public is_inside_rect(
    textAreaData: TextAreaData,
    sd: DrawingDelta,
    rect_a: Coordinate,
    rect_b: Coordinate,
  ) {
    // Is this text block inside the rectangle?
    let pa = this.rotateMsg(textAreaData, sd, rect_a);
    let pb = this.rotateMsg(textAreaData, sd, rect_b);
    const rect = UtilityService.normalizeRect(pa, pb);
    let a = [0, 0];
    let b = [textAreaData.width, textAreaData.height];

    return (
      a[0] >= rect.a[0] &&
      a[1] >= rect.a[1] &&
      b[0] <= rect.b[0] &&
      b[1] <= rect.b[1]
    );
  }

  public on_isinside(
    textAreaData: TextAreaData,
    sd: DrawingDelta,
    point: Coordinate,
  ): IsInsideTextResult {
    // Is this point inside this item?
    let p = this.rotateMsg(textAreaData, sd, point);

    // Is this inside the text area?
    let a = [0, 0];
    let b = [textAreaData.width, textAreaData.height];
    if (UtilityService.isPointInsideRect(p, a, b)) {
      // We have a hit on the text!
      return IsInsideTextResult.Inside_Text;
    } else if (
      this.textArea.allowMove &&
      UtilityService.isPointInsideRect(
        p,
        [a[0] - 5, a[1] - 5],
        [a[0] + 5, a[1] + 5],
      )
    ) {
      // We have a hit on the item
      return IsInsideTextResult.Inside_Rect;
    }

    return IsInsideTextResult.Inside_None;
  }

  //
  // Rotate an message so that the incoming point is in un-rotated co-ordinates
  //
  private rotateMsg(
    textAreaData: TextAreaData,
    sd: DrawingDelta,
    p: Coordinate,
  ) {
    // First perform rotation (as required)
    if (!sd) {
      sd = {
        dx: 0,
        dy: 0,
        dr: 0,
        part: 0,
        show_power: false,
        editingLibrary: false,
        heterogeneous: false,
        scale_x: 1.0,
        scale_y: 1.0,
      };
    }
    const matrix = this.transform_matrix(
      textAreaData,
      sd.dx,
      sd.dy,
      sd.dr,
      1.0,
      1.0,
    );

    let r = [p[0], p[1]];

    if (matrix.rotate === 270) {
      r = [-p[1], p[0]];
      r[0] += matrix.translate[1];
      r[1] -= matrix.translate[0];
    } else {
      r[0] -= matrix.translate[0];
      r[1] -= matrix.translate[1];
    }

    return r;
  }

  private transform_matrix(
    textAreaData: TextAreaData,
    dx: number,
    dy: number,
    dr: number,
    scale_x: number,
    scale_y: number,
  ) {
    if (!dx) {
      dx = 0;
    }
    if (!dy) {
      dy = 0;
    }
    if (!dr) {
      dr = 0;
    }

    let rotation = 0;
    let translate_x = 0;
    let translate_y = 0;
    const drawRotation = this.rotateRotation(dr, this.textArea.drawRotation);
    const spacing_x = this.textArea.drawX - this.textArea.drawPoint[0];
    const spacing_y = this.textArea.drawY - this.textArea.drawPoint[1];
    const scaling = UtilityService.rotateSymCordinate(dr, [scale_x, scale_y]);
    scale_x = Math.abs(scaling[0]);
    scale_y = Math.abs(scaling[1]);
    if (this.textArea.drawCentre) {
      switch (drawRotation) {
        case 0:
          translate_x = spacing_x + textAreaData.centre_x;
          translate_y = -this.textArea.font_size + spacing_y;
          break;
        case 1:
          rotation = 270;
          translate_y = -textAreaData.centre_x - spacing_x;
          translate_x = -spacing_y;
          break;
        case 2:
          translate_x = textAreaData.centre_x - spacing_x;
          translate_y = -spacing_y;
          break;
        case 3:
          rotation = 270;
          translate_y = -textAreaData.centre_x + spacing_x;
          translate_x = -this.textArea.font_size + spacing_y;
          break;
      }
    } else {
      switch (drawRotation) {
        case 0:
          if (this.textArea.drawMultiline) {
            translate_x = spacing_x * scale_x;
            translate_y = spacing_y * scale_y;
          } else {
            translate_x = spacing_x * scale_x;
            translate_y = -this.textArea.font_size + spacing_y * scale_y;
          }
          break;
        case 1:
          rotation = 270;
          if (this.textArea.drawMultiline) {
            translate_y = -spacing_x + textAreaData.width;
            translate_x = spacing_y * scale_x;
          } else {
            translate_y = -spacing_x * scale_y;
            translate_x = -this.textArea.font_size + spacing_y * scale_y;
          }
          break;
        case 2:
          if (this.textArea.drawMultiline) {
            translate_x = -spacing_x * scale_x;
            translate_y = spacing_y * scale_y;
          } else {
            translate_x = textAreaData.centre_x - spacing_x * scale_x;
            translate_y = -this.textArea.font_size + spacing_y * scale_y;
          }
          break;
        case 3:
          rotation = 270;
          if (this.textArea.drawMultiline) {
            translate_y = -textAreaData.centre_x + spacing_x * scale_y;
            translate_x = spacing_y;
          } else {
            translate_y = -textAreaData.centre_x + spacing_x * scale_y;
            translate_x = -this.textArea.font_size + spacing_y * scale_x;
          }
          break;
      }
    }

    // Apply dx,dy,dr
    const drawPoint = UtilityService.rotateSymCordinate(
      dr,
      this.textArea.drawPoint,
    );
    let p1 = [
      translate_x + drawPoint[0] * scale_x + dx,
      translate_y + drawPoint[1] * scale_y + dy,
    ];

    if (this.textArea.drawMultiline) {
      let p2 = UtilityService.rotateSymCordinate(dr, [
        textAreaData.width,
        textAreaData.height,
      ]);
      p1 = [Math.min(p1[0], p1[0] + p2[0]), Math.min(p1[1], p1[1] + p2[1])];
    }

    return {
      translate: p1,
      rotate: rotation,
    };
  }

  private find_best_text(text: string, target_width: number) {
    // If there is CR/LF then we cut at that
    let cut = text.indexOf('\r');
    if (cut >= 0) {
      text = text.substring(0, cut + 1);
    }

    // Do a binary search to match the text to the width (in pixels)
    let high_cut = text.length;
    let low_cut = 0;
    let mid_width = 0;

    let high_width = measureText(this.getFont(), text);
    if (target_width >= high_width) {
      return { cut: high_cut, width: high_width, exact: high_cut };
    }

    while (Math.abs(low_cut - high_cut) > 1) {
      let mid_cut = Math.floor((high_cut + low_cut) / 2);
      mid_width = measureText(this.getFont(), text.substring(0, mid_cut));

      // Ok, which way do we search next?
      if (mid_width > target_width) {
        high_cut = mid_cut;
      } else {
        low_cut = mid_cut;
      }
    }

    // We have the character the user clicked on, so the question
    // is, which end of the text is the user closest to?
    let mid_width1 = measureText(this.getFont(), text.substring(0, low_cut));
    let mid_width2 = measureText(
      this.getFont(),
      text.substring(0, low_cut + 1),
    );
    if (
      Math.abs(mid_width1 - target_width) > Math.abs(mid_width2 - target_width)
    ) {
      ++low_cut;
    }

    // Now scan back for a space
    cut = low_cut;
    while (cut > 0 && text.charAt(cut) !== ' ' && text.charAt(cut) !== '\r') {
      --cut;
    }

    if (cut === 0) {
      // We have to break the word as it is longer than
      // a line
      cut = low_cut;
    } else if (text.charAt(cut) === ' ' || text.charAt(cut) === '\r') {
      ++cut;
    }

    return { cut: cut, width: mid_width, exact: low_cut };
  }

  private rotateRotation(dr: number, rotation: number) {
    // tslint:disable-next-line: no-bitwise
    let r = dr & 3;
    // tslint:disable-next-line: no-bitwise
    if ((dr & 4) !== 0) {
      // Mirror V
      if (rotation === 0 || rotation === 2) {
        r += 2;
      }
    }

    switch (r % 4) {
      case 0:
        break;
      case 1:
        rotation += 3;
        break;
      case 2:
        rotation += 2;
        break;
      case 3:
        rotation += 1;
        break;
    }

    return rotation % 4;
  }

  private select_all(textAreaData: TextAreaData) {
    const textLength = textAreaData.drawText.length;
    return update(textAreaData, {
      edit_position: { $set: textLength },
      sel_start: { $set: 0 },
      sel_end: { $set: textLength },
    });
  }

  private isWordNavigationModifier(ctrlKey: boolean, altKey: boolean) {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    return isMac ? altKey : ctrlKey;
  }

  private isLineNavigationModifier(ctrlKey: boolean, metaKey: boolean) {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    return isMac ? metaKey : false;
  }

  private find_previous_word_boundary(text: string, position: number) {
    let nextPosition = position;

    while (nextPosition > 0 && this.get_char_category(text[nextPosition - 1]) === 'space') {
      --nextPosition;
    }

    const category = this.get_char_category(text[nextPosition - 1]);
    while (
      nextPosition > 0 &&
      this.get_char_category(text[nextPosition - 1]) === category
    ) {
      --nextPosition;
    }

    return nextPosition;
  }

  private find_next_word_boundary(text: string, position: number) {
    let nextPosition = position;

    while (nextPosition < text.length && this.get_char_category(text[nextPosition]) === 'space') {
      ++nextPosition;
    }

    const category = this.get_char_category(text[nextPosition]);
    while (
      nextPosition < text.length &&
      this.get_char_category(text[nextPosition]) === category
    ) {
      ++nextPosition;
    }

    return nextPosition;
  }

  private find_current_block(textAreaData: TextAreaData) {
    const position = textAreaData.edit_position;

    for (let index = 0; index < textAreaData.textBlocks.length; ++index) {
      const block = textAreaData.textBlocks[index];
      const blockEnd = block.start + block.value.length;
      if (position === block.start || position < blockEnd) {
        return block;
      }

      if (position === blockEnd) {
        const nextBlock = textAreaData.textBlocks[index + 1];
        if (!nextBlock || nextBlock.start !== position) {
          return block;
        }
      }
    }

    return textAreaData.textBlocks[textAreaData.textBlocks.length - 1] || null;
  }

  private get_block_end_position(block: { start: number; value: string }) {
    const visibleLength = block.value.endsWith('\r')
      ? block.value.length - 1
      : block.value.length;
    return block.start + visibleLength;
  }

  private get_position_in_block(
    block: { start: number; value: string; x: number; width: number },
    x: number,
  ) {
    if (x <= block.x) {
      return block.start;
    }

    if (x >= block.x + block.width) {
      return this.get_block_end_position(block);
    }

    let bt = this.find_best_text(block.value, x - block.x);
    return block.start + bt.exact;
  }

  private find_line_start(textAreaData: TextAreaData) {
    const block = this.find_current_block(textAreaData);
    return block ? block.start : 0;
  }

  private find_line_end(textAreaData: TextAreaData) {
    const block = this.find_current_block(textAreaData);
    if (!block) {
      return textAreaData.drawText.length;
    }

    return this.get_block_end_position(block);
  }

  private get_char_category(c: string | undefined) {
    if (!c) {
      return 'space';
    }

    if (/\s/.test(c)) {
      return 'space';
    }

    if (/[A-Za-z0-9_]/.test(c)) {
      return 'word';
    }

    return 'punct';
  }

  private makeTextArea(textAreaData: TextAreaData, drawText: string) {
    if (!textAreaData) {
      textAreaData = {
        textArea: this.textArea,
        drawText: drawText,
        textEdit: null,
        edit_position: 0,
        preferred_x: null,
        sel_start: -1,
        sel_end: -1,
        sel_end_pos: -1,
        sel_start_pos: -1,
        textBlocks: [],
        width: 0,
        height: 0,
        centre_x: 0,
      };
    }

    let y = this.textArea.font_size;
    let txt = drawText;
    let edit_position = textAreaData.edit_position;
    let sel_start = Math.min(textAreaData.sel_start, textAreaData.sel_end);
    let sel_end = Math.max(textAreaData.sel_start, textAreaData.sel_end);
    let s = 0;
    let r = [];
    let width = 0;
    let height = 0;
    let centre_x = 0;
    let textEdit = null;

    let y_end = 0;
    if (this.textArea.drawMultiline) {
      if (this.textArea.drawRotation === 0) {
        width = this.textArea.drawWidth;
        height = this.textArea.drawHeight;
        y_end = this.textArea.drawHeight;
      } else {
        width = this.textArea.drawHeight;
        height = this.textArea.drawWidth;
        y_end = this.textArea.drawWidth;
      }
    } else {
      y_end = this.textArea.font_size + 4;
    }

    while (y <= y_end) {
      let bt;

      if (this.textArea.drawMultiline) {
        bt = this.find_best_text(txt, width);
      } else {
        width = measureText(this.getFont(), txt);
        height = this.textArea.font_size;
        bt = {
          cut: txt.length,
          width: width,
          exact: txt.length,
        };
      }

      // Cut out the text to display
      let next_text = txt.substring(0, bt.cut);
      txt = txt.substring(bt.cut);

      let trailing_cr =
        this.textArea.drawMultiline &&
        next_text[next_text.length - 1] === '\r' &&
        txt.length === 0;

      // Is the selection position within this text block?
      if (
        trailing_cr &&
        textEdit == null &&
        edit_position >= next_text.length
      ) {
        textEdit = {
          x: 1,
          y: y + this.textArea.font_size * 1.5,
          height: this.textArea.font_size,
        };
      } else if (
        textEdit == null &&
        (edit_position < next_text.length || txt.length === 0)
      ) {
        // Yes so determine it's location
        let metrics = measureText(
          this.getFont(),
          next_text.slice(0, edit_position),
        );
        textEdit = {
          x: metrics + 1,
          y: y,
          height: this.textArea.font_size,
        };
      } else {
        edit_position -= next_text.length;
      }

      let sel_start_pos = -1;
      let sel_end_pos = -1;
      if (sel_end < 0) {
        sel_end_pos = -1;
      } else if (sel_end >= next_text.length) {
        sel_end_pos = bt.width;
      } else {
        sel_end_pos = measureText(this.getFont(), next_text.slice(0, sel_end));
      }

      if (sel_start <= 0) {
        sel_start_pos = 0;
      } else if (sel_start < next_text.length) {
        sel_start_pos = measureText(
          this.getFont(),
          next_text.slice(0, sel_start),
        );
      } else {
        sel_start_pos = sel_end_pos;
      }

      if (this.textArea.drawCentre) {
        centre_x = -bt.width / 2;
      } else {
        centre_x = -bt.width;
      }

      r.push({
        x: 1,
        y: y,
        width: bt.width,
        height: this.textArea.font_size,
        value: next_text,
        sel_x: sel_start_pos + 1,
        sel_y: y - this.textArea.font_size * 1.0,
        sel_width: sel_end_pos - sel_start_pos,
        sel_height: this.textArea.font_size * 1.5,
        start: s,
      });

      y += this.textArea.font_size * 1.5;
      s += next_text.length;
      sel_start -= next_text.length;
      sel_end -= next_text.length;

      if (bt.cut === 0) {
        // That's all folks!
        break;
      }
    }

    return update(textAreaData, {
      textArea: { $set: this.textArea },
      textBlocks: { $set: r },
      textEdit: { $set: textEdit },
      drawText: { $set: drawText },
      width: { $set: width },
      height: { $set: height },
      centre_x: { $set: centre_x },
    });
  }

  private getFont() {
    return getFont(this.textArea.drawItem);
  }
}
