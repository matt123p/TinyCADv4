import { Lexer, Token } from 'marked';
import { Text } from '../model/dsnItem';
import {
  TextArea,
  TextAreaBlock,
  TextAreaData,
  TextAreaRun,
} from '../model/textArea';
import { measureText } from './measureText';

const headingScales = [2, 1.5, 1.25, 1, 0.875, 0.85];

/** Style the original source, including delimiters. No HTML or source rewriting. */
export function markdownSourceRuns(source: string, base: Text): TextAreaRun[] {
  const normal: TextAreaRun = {
    start: 0,
    end: source.length,
    font_size: base.font_size,
    font_bold: base.font_bold,
    font_italic: base.font_italic,
  };
  const styles = new Array<TextAreaRun>(source.length).fill(normal);
  let fence: { marker: string; length: number } | undefined;
  const lines = Array.from(source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g));

  const paint = (start: number, end: number, change: Partial<TextAreaRun>) => {
    for (let index = start; index < end; ++index) {
      styles[index] = { ...styles[index], ...change };
    }
  };
  const inline = (tokens: Token[], start: number) => {
    let offset = start;
    for (const token of tokens) {
      const end = offset + token.raw.length;
      const change =
        token.type === 'strong'
          ? { font_bold: true }
          : token.type === 'em'
          ? { font_italic: true }
          : token.type === 'del'
          ? { strike: true }
          : token.type === 'link'
          ? { underline: true }
          : null;
      if (change) paint(offset, end, change);
      if ('tokens' in token && Array.isArray(token.tokens)) {
        // Child raw text excludes the outer delimiters; find it without decoding
        // escapes or entities, keeping every editable source offset intact.
        let cursor = 0;
        for (const child of token.tokens as Token[]) {
          const position = token.raw.indexOf(child.raw, cursor);
          if (position >= 0) {
            inline([child], offset + position);
            cursor = position + child.raw.length;
          }
        }
      }
      offset = end;
    }
  };

  let inlineStart = 0;
  const flushInline = (end: number) => {
    if (end > inlineStart)
      inline(
        Lexer.lexInline(source.slice(inlineStart, end), { gfm: true }),
        inlineStart,
      );
  };
  lines.forEach((match, index) => {
    const line = match[1];
    const start = match.index!;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
      }
      inlineStart = start + match[0].length;
      return;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      flushInline(start);
      inlineStart = start + match[0].length;
      fence = { marker: marker[1][0], length: marker[1].length };
      return;
    }
    // Four-space indentation is a code block, not emphasis or a heading.
    if (/^( {4}|\t)/.test(line)) {
      flushInline(start);
      inlineStart = start + match[0].length;
      return;
    }
    const heading = /^ {0,3}(?:> ?)*(#{1,6})(?:[ \t]+|$)/.exec(line);
    const underline = lines[index + 1]?.[1];
    const setext = line.trim() && /^ {0,3}(=+|-+)[ \t]*$/.exec(underline ?? '');
    const depth =
      heading?.[1].length ?? (setext ? (setext[1][0] === '=' ? 1 : 2) : 0);
    if (depth) {
      const end = setext
        ? lines[index + 1].index! + lines[index + 1][0].length
        : start + match[0].length;
      paint(start, end, {
        font_size: base.font_size * headingScales[depth - 1],
        font_bold: true,
      });
    }
  });
  flushInline(source.length);

  const runs: TextAreaRun[] = [];
  styles.forEach((style, index) => {
    const previous = runs[runs.length - 1];
    if (
      previous &&
      previous.font_size === style.font_size &&
      previous.font_bold === style.font_bold &&
      previous.font_italic === style.font_italic &&
      previous.strike === style.strike &&
      previous.underline === style.underline
    ) {
      previous.end = index + 1;
    } else {
      runs.push({ ...style, start: index, end: index + 1 });
    }
  });
  return runs;
}

function runFont(run: TextAreaRun, base: Text): string {
  return `${run.font_italic ? 'italic ' : ''}${run.font_bold ? 'bold ' : ''}${
    run.font_size
  }px ${base.font_name}`;
}

/** One layout supplies SVG spans, wrapping, caret positions, selection and hit testing. */
export function layoutMarkdownSource(
  area: TextArea,
  data: TextAreaData,
  source: string,
) {
  const width = area.drawRotation % 2 ? area.drawHeight : area.drawWidth;
  const height = area.drawRotation % 2 ? area.drawWidth : area.drawHeight;
  const runs = markdownSourceRuns(source, area.drawItem);
  const blocks: TextAreaBlock[] = [];
  let top = 0;
  let offset = 0;
  let runIndex = 0;
  let textEdit: TextAreaData['textEdit'] = null;

  // Include a final empty line so a caret after Return remains visible.
  const lines = Array.from(source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g));
  for (const line of lines) {
    if (line.index !== offset) continue;
    if (offset === source.length && offset > 0 && !/[\r\n]$/.test(source))
      continue;
    const lineEnd = offset + line[1].length;
    do {
      const start = offset;
      const offsets = [0];
      const spans: TextAreaRun[] = [];
      let blockHeight = area.font_size;
      let textWidth = 0;
      let lastSpace = -1;
      while (runIndex > 0 && runs[runIndex - 1].end > offset) --runIndex;
      while (offset < lineEnd) {
        while (runs[runIndex]?.end <= offset) ++runIndex;
        const run = runs[runIndex];
        if (!run) break;
        const spanStart = offset;
        const font = runFont(run, area.drawItem);
        const before = textWidth;
        while (offset < Math.min(run.end, lineEnd)) {
          const next =
            before + measureText(font, source.slice(spanStart, offset + 1));
          if (next > Math.max(1, width - 2) && offset > start) break;
          textWidth = next;
          ++offset;
          offsets.push(textWidth);
          if (source[offset - 1] === ' ') lastSpace = offset;
        }
        if (offset > spanStart) {
          spans.push({ ...run, start: spanStart - start, end: offset - start });
          blockHeight = Math.max(blockHeight, run.font_size);
        }
        if (offset < Math.min(run.end, lineEnd)) break;
      }
      // Prefer word boundaries without discarding source spaces.
      if (offset < lineEnd && lastSpace > start) {
        offset = lastSpace;
        offsets.length = offset - start + 1;
        spans.forEach((span) => {
          span.end = Math.min(span.end, offset - start);
        });
      }
      const contentEnd = offset;
      if (offset === lineEnd) {
        offset += line[2].length;
        for (let index = contentEnd; index < offset; ++index)
          offsets.push(offsets[offsets.length - 1]);
      }
      const value = source.slice(start, offset);
      const selectedStart = Math.max(
        0,
        Math.min(value.length, Math.min(data.sel_start, data.sel_end) - start),
      );
      const selectedEnd = Math.max(
        0,
        Math.min(value.length, Math.max(data.sel_start, data.sel_end) - start),
      );
      const baseline = top + blockHeight;
      const block: TextAreaBlock = {
        x: 1,
        y: baseline,
        width: offsets[offsets.length - 1],
        height: blockHeight,
        value,
        start,
        sourceRuns: spans.filter((span) => span.end > span.start),
        caretOffsets: offsets,
        sel_x: 1 + offsets[selectedStart],
        sel_y: top,
        sel_width: offsets[selectedEnd] - offsets[selectedStart],
        sel_height: blockHeight * 1.5,
      };
      blocks.push(block);
      if (
        !textEdit &&
        data.edit_position >= start &&
        (data.edit_position < offset || (!line[2] && offset === source.length))
      ) {
        const position = Math.min(value.length, data.edit_position - start);
        textEdit = {
          x: 1 + offsets[position],
          y: baseline,
          height: blockHeight,
        };
      }
      top += blockHeight * 1.5;
      if (contentEnd === lineEnd) break;
    } while (offset < lineEnd);
  }
  return { textBlocks: blocks, textEdit, width, height, centre_x: -width };
}
