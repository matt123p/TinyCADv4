import React, { memo, useMemo } from 'react';
import { dsnText } from '../../model/dsnItem';
import { markdownStyles, renderMarkdown } from '../../util/markdown';

interface MarkdownTextProps {
  item: dsnText;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}

/** HTML layout inside SVG preserves Markdown lists, tables and code indentation. */
function MarkdownText({
  item,
  x,
  y,
  width,
  height,
  rotated,
}: MarkdownTextProps) {
  const html = useMemo(() => renderMarkdown(item.text), [item.text]);
  const contentWidth = Math.max(0, rotated ? height : width);
  const contentHeight = Math.max(0, rotated ? width : height);
  return (
    <g
      transform={
        rotated
          ? `translate(${x} ${y + height}) rotate(270)`
          : `translate(${x} ${y})`
      }
      style={{ pointerEvents: 'none' }}
    >
      <foreignObject
        width={contentWidth}
        height={contentHeight}
        data-markdown="true"
      >
        <div {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}>
          <style>{markdownStyles}</style>
          <div
            className="tinycad-markdown"
            style={{
              width: contentWidth,
              height: contentHeight,
              padding: 3,
              fontFamily: item.font_name,
              fontSize: item.font_size,
              fontWeight: item.font_bold ? 'bold' : 'normal',
              fontStyle: item.font_italic ? 'italic' : 'normal',
              color: item.font_colour,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </foreignObject>
    </g>
  );
}

export default memo(MarkdownText);
