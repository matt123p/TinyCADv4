import React, { memo } from 'react';
import { Text, DocItem, DocItemTypes } from '../../model/dsnItem';
import { TextAreaData } from '../../model/textArea';
import { updateTextData } from '../../manipulators/updateTextArea';
import { getFont, measureText, measureTextOffset } from '../../util/measureText';

interface TextEditAreaProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  'draw-data': TextAreaData;
  'draw-item': Text;
  'move-handle': number;
  parent: DocItem;
  selected: boolean;
  selected_handle: number;
  'draw-colour': string;
  hover: boolean;
}

interface KicadOverlineSegment {
  value: string;
  overline: boolean;
}

interface KicadOverlineParsed {
  display: string;
  segments: KicadOverlineSegment[];
  rawToVisible: number[];
}

class TTextEditArea extends React.PureComponent<TextEditAreaProps, {}> {
  public static defaultProps = {
    'draw-colour': 'black',
    'move-handle': 0,
    selected: false,
    selected_handle: -1,
    hover: false,
  };

  render() {
    if (!this.props['draw-data']) {
      return null;
    }
    const textArea = this.props['draw-data'].textArea;

    const renderPinNameOverline = this.shouldRenderKicadPinOverline();
    const parsedByBlock = this.props['draw-data'].textBlocks.map((block) =>
      renderPinNameOverline
        ? this.parseKicadOverline(block.value)
        : {
            display: block.value,
            segments: [{ value: block.value, overline: false }],
            rawToVisible: new Array(block.value.length + 1)
              .fill(0)
              .map((_, i) => i),
          },
    );

    let text_blocks = this.props['draw-data'].textBlocks.map((block, index) => {
      const parsed = parsedByBlock[index];
      return (
        <text
          x={block.x}
          y={block.y}
          fill={this.props['draw-colour']}
          key={index}
          style={{
            pointerEvents: 'none',
            fontSize: this.props['draw-item'].font_size,
            fontFamily: this.props['draw-item'].font_name,
            fontWeight: this.props['draw-item'].font_bold ? 'bold' : 'normal',
            fontStyle: this.props['draw-item'].font_italic
              ? 'italic'
              : 'normal',
            whiteSpace: 'pre',
          }}
        >
          {parsed.segments.map((segment, segIndex) => (
            <tspan
              key={segIndex}
              style={segment.overline ? { textDecoration: 'overline' } : undefined}
            >
              {segment.value}
            </tspan>
          ))}
        </text>
      );
    });

    let selection_blocks = this.text_selected()
      ? this.props['draw-data'].textBlocks
          .map((block, index) => {
            if (!renderPinNameOverline) {
              if (block.sel_width <= 0 || block.sel_height <= 0) {
                return null;
              }
              return (
                <rect
                  className="text-selection"
                  x={block.sel_x}
                  y={block.sel_y}
                  key={index + 1000}
                  width={block.sel_width}
                  height={block.sel_height}
                />
              );
            }

            const parsed = parsedByBlock[index];
            const rawStart = Math.max(
              0,
              Math.min(
                block.value.length,
                this.props['draw-data'].sel_start - block.start,
              ),
            );
            const rawEnd = Math.max(
              0,
              Math.min(
                block.value.length,
                this.props['draw-data'].sel_end - block.start,
              ),
            );
            const localStart = Math.min(rawStart, rawEnd);
            const localEnd = Math.max(rawStart, rawEnd);

            if (localEnd <= localStart) {
              return null;
            }

            const visibleStart = parsed.rawToVisible[localStart] ?? 0;
            const visibleEnd = parsed.rawToVisible[localEnd] ?? visibleStart;
            const selX =
              measureText(
                getFont(this.props['draw-item']),
                parsed.display.slice(0, visibleStart),
              ) + 1;
            const selWidth =
              measureText(
                getFont(this.props['draw-item']),
                parsed.display.slice(0, visibleEnd),
              ) -
              measureText(
                getFont(this.props['draw-item']),
                parsed.display.slice(0, visibleStart),
              );

            if (selWidth <= 0) {
              return null;
            }

            return (
              <rect
                className="text-selection"
                x={selX}
                y={block.y - this.props['draw-item'].font_size * 1.0}
                key={index + 1000}
                width={selWidth}
                height={this.props['draw-item'].font_size * 1.5}
              />
            );
          })
          .filter((x) => !!x)
      : null;

    let highlight = null;
    let move = null;
    if (this.props.selected) {
      if (this.props['draw-data'].textArea.drawMultiline) {
        highlight = (
          <rect
            x={0}
            y={0}
            width={this.props['draw-data'].width}
            height={this.props['draw-data'].height}
            className="selectedHighlight"
          />
        );
      } else {
        highlight = (
          <rect
            x={0 - 3}
            y={0 - 3}
            width={this.props['draw-data'].width + 6}
            height={this.props['draw-data'].height + 6}
            className="selectedHighlight"
          />
        );

        if (textArea.allowMove) {
          move = (
            <rect
              x={-5}
              y={-5}
              width="5"
              height="5"
              style={{
                fill: 'none',
                fillOpacity: 0.75,
                stroke: 'black',
                strokeWidth: 1,
              }}
            />
          );
        }
      }
    }

    let selectable =
      this.props.hover && !highlight ? (
        <rect
          x={0}
          y={0}
          width={this.props['draw-data'].width}
          height={this.props['draw-data'].height}
          className="selectableHighlight"
        />
      ) : null;

    // Draw the caret
    let caret = null;
    if (this.text_selected()) {
      let caretX = this.props['draw-data'].textEdit?.x;
      let caretY = this.props['draw-data'].textEdit?.y;
      let caretHeight = this.props['draw-data'].textEdit?.height;

      if (renderPinNameOverline) {
        const rawEdit = this.props['draw-data'].edit_position;
        const blockIndex = this.findBlockForRawPosition(rawEdit);
        if (blockIndex >= 0) {
          const block = this.props['draw-data'].textBlocks[blockIndex];
          const parsed = parsedByBlock[blockIndex];
          const localRaw = Math.max(
            0,
            Math.min(block.value.length, rawEdit - block.start),
          );
          const visibleIndex = parsed.rawToVisible[localRaw] ?? 0;
          caretX =
            measureText(
              getFont(this.props['draw-item']),
              parsed.display.slice(0, visibleIndex),
            ) + 1;
          caretY = block.y;
          caretHeight = this.props['draw-item'].font_size;
        }
      }

      caret =
        caretX != null && caretY != null && caretHeight != null ? (
          <line
            x1={caretX}
            y1={caretY}
            x2={caretX}
            y2={caretY - caretHeight}
            className="text-caret"
          />
        ) : null;
    }

    let offsetY = measureTextOffset(getFont(this.props['draw-item']));

    const update_textArea = new updateTextData(
      textArea.drawX,
      textArea.drawY,
      textArea.drawPoint,
      textArea.drawItem,
      textArea.dragHandle,
      textArea.moveHandle,
      textArea.drawMultiline,
      textArea.drawRotation,
      textArea.drawWidth,
      textArea.drawHeight,
      textArea.drawCentre,
      textArea.allowMove,
    );
    return (
      <g
        transform={update_textArea.transform(
          this.props['draw-data'],
          this.props.dx,
          this.props.dy,
          this.props.dr,
          this.props.scale_x,
          this.props.scale_y,
          offsetY,
        )}
      >
        {highlight}
        {selectable}
        {text_blocks}
        {selection_blocks}
        {caret}
        {move}
      </g>
    );
  }

  private text_selected() {
    return (
      this.props.selected &&
      this.props['draw-data'].textArea.dragHandle === this.props.selected_handle
    );
  }

  private shouldRenderKicadPinOverline(): boolean {
    const drawItem = this.props['draw-item'] as any;
    const isPinFromParent =
      this.props.parent != null && this.props.parent.NodeName === DocItemTypes.Pin;
    const isPinFromItem =
      drawItem?.NodeName === DocItemTypes.Pin ||
      (typeof drawItem?.name === 'string' && typeof drawItem?.number === 'string');

    return (
      (isPinFromParent || isPinFromItem) &&
      this.props['draw-data'].textArea.dragHandle === -2
    );
  }

  private parseKicadOverline(value: string): KicadOverlineParsed {
    if (!value || value.indexOf('~{') === -1) {
      return {
        display: value,
        segments: [{ value, overline: false }],
        rawToVisible: new Array(value.length + 1).fill(0).map((_, i) => i),
      };
    }

    const segments: KicadOverlineSegment[] = [];
    const rawToVisible: number[] = new Array(value.length + 1).fill(0);
    let visibleCount = 0;
    let i = 0;
    let plain = '';

    rawToVisible[0] = 0;

    while (i < value.length) {
      if (value[i] === '~' && value[i + 1] === '{') {
        const close = value.indexOf('}', i + 2);
        if (close === -1) {
          plain += value[i];
          i += 1;
          visibleCount += 1;
          rawToVisible[i] = visibleCount;
          continue;
        }

        i += 1;
        rawToVisible[i] = visibleCount;
        i += 1;
        rawToVisible[i] = visibleCount;

        if (plain.length > 0) {
          segments.push({ value: plain, overline: false });
          plain = '';
        }

        let overlineValue = '';
        while (i < close) {
          overlineValue += value[i];
          i += 1;
          visibleCount += 1;
          rawToVisible[i] = visibleCount;
        }

        segments.push({ value: overlineValue, overline: true });

        i += 1;
        rawToVisible[i] = visibleCount;
        continue;
      }

      plain += value[i];
      i += 1;
      visibleCount += 1;
      rawToVisible[i] = visibleCount;
    }

    if (plain.length > 0) {
      segments.push({ value: plain, overline: false });
    }

    const display = segments.map((s) => s.value).join('');

    return {
      display,
      segments: segments.length > 0 ? segments : [{ value, overline: false }],
      rawToVisible,
    };
  }

  private findBlockForRawPosition(rawPosition: number): number {
    const blocks = this.props['draw-data'].textBlocks;
    for (let i = 0; i < blocks.length; i += 1) {
      const start = blocks[i].start;
      const end = start + blocks[i].value.length;
      if (rawPosition >= start && rawPosition <= end) {
        return i;
      }
    }
    return blocks.length > 0 ? blocks.length - 1 : -1;
  }
}

export default memo(TTextEditArea);
