import { Lexer, Token, Tokens } from 'marked';
import { Text } from '../model/dsnItem';
import { measureText } from './measureText';
import { markdownHeadingScales } from './markdownSource';

interface Style {
  size: number;
  bold: boolean;
  italic: boolean;
  strike?: boolean;
  code?: boolean;
}
interface Run extends Style {
  value: string;
}
export type MarkdownShape =
  | ({ kind: 'text'; x: number; y: number } & Run)
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      weight: number;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      shaded?: boolean;
    }
  | { kind: 'bullet'; x: number; y: number; radius: number };

/** A small Markdown subset rendered with text and vector shapes, never HTML. */
export function layoutMarkdown(
  source: string,
  base: Text,
  width: number,
): MarkdownShape[] {
  const shapes: MarkdownShape[] = [];
  const normal: Style = {
    size: base.font_size,
    bold: base.font_bold,
    italic: base.font_italic,
  };
  const padding = 3,
    right = width - padding;
  let y = padding;
  if (right <= padding || base.font_size <= 0) return shapes;
  const font = (s: Style) =>
    `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${
      base.font_name
    }`;
  function inline(tokens: Token[], style: Style): Run[] {
    return tokens.flatMap((token) => {
      switch (token.type) {
        case 'strong':
          return inline(token.tokens, { ...style, bold: true });
        case 'em':
          return inline(token.tokens, { ...style, italic: true });
        case 'del':
          return inline(token.tokens, { ...style, strike: true });
        case 'codespan':
          return [{ ...style, code: true, value: token.text }];
        case 'br':
          return [{ ...style, value: '\n' }];
        case 'checkbox':
          return [];
        case 'text':
          return token.tokens
            ? inline(token.tokens, style)
            : [{ ...style, value: token.text }];
        case 'escape':
          return [{ ...style, value: token.text }];
        default:
          return [{ ...style, value: token.raw }];
      }
    });
  }
  function flow(runs: Run[], left: number, style: Style, literal = false) {
    let line: Run[] = [],
      used = 0;
    const available = Math.max(1, right - left);
    function flush(force = false) {
      if (!line.length && !force) return;
      const size = Math.max(style.size, ...line.map((run) => run.size));
      let x = left;
      for (const run of line) {
        const w = measureText(font(run), run.value);
        if (run.code)
          shapes.push({
            kind: 'rect',
            x,
            y,
            width: w,
            height: size * 1.2,
            shaded: true,
          });
        shapes.push({ kind: 'text', ...run, x, y: y + size });
        if (run.strike)
          shapes.push({
            kind: 'line',
            x1: x,
            x2: x + w,
            y1: y + size * 0.7,
            y2: y + size * 0.7,
            weight: Math.max(0.5, run.size / 16),
          });
        x += w;
      }
      y += size * 1.4;
      line = [];
      used = 0;
    }
    function append(value: string, run: Style) {
      const previous = line[line.length - 1];
      if (
        previous &&
        font(previous) === font(run) &&
        previous.strike === run.strike &&
        previous.code === run.code
      ) {
        used +=
          measureText(font(run), previous.value + value) -
          measureText(font(run), previous.value);
        previous.value += value;
      } else {
        line.push({ ...run, value });
        used += measureText(font(run), value);
      }
    }
    for (const run of runs)
      for (let part of run.value.replace(/\t/g, '    ').split(/(\n| +)/)) {
        if (!part) continue;
        if (part === '\n') {
          flush(true);
          continue;
        }
        if (literal) {
          append(part, run);
          continue;
        }
        if (!line.length && /^ +$/.test(part)) continue;
        if (used && used + measureText(font(run), part) > available) {
          flush();
          if (/^ +$/.test(part)) continue;
        }
        while (measureText(font(run), part) > available) {
          let low = 1,
            high = part.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (measureText(font(run), part.slice(0, middle)) <= available)
              low = middle;
            else high = middle - 1;
          }
          append(part.slice(0, low), run);
          flush();
          part = part.slice(low);
        }
        if (part) append(part, run);
      }
    flush();
  }
  function blocks(tokens: Token[], left = padding, compact = false) {
    for (const token of tokens)
      switch (token.type) {
        case 'space':
        case 'checkbox': // The containing list item draws its vector marker.
          break;
        case 'heading': {
          const style = {
            ...normal,
            size: normal.size * markdownHeadingScales[token.depth - 1],
            bold: true,
          };
          flow(inline(token.tokens, style), left, style);
          y += normal.size * 0.35;
          break;
        }
        case 'paragraph':
        case 'text':
          flow(
            token.tokens
              ? inline(token.tokens, normal)
              : [{ ...normal, value: token.text }],
            left,
            normal,
          );
          if (!compact) y += normal.size * 0.45;
          break;
        case 'code': {
          const top = y;
          const background: MarkdownShape = {
            kind: 'rect',
            x: left,
            y,
            width: Math.max(0, right - left),
            height: 0,
            shaded: true,
          };
          shapes.push(background);
          y += padding;
          flow(
            [{ ...normal, value: token.text }],
            left + padding,
            normal,
            true,
          );
          if (!token.text) y += normal.size * 1.4;
          y += padding;
          background.height = y - top;
          y += normal.size * 0.45;
          break;
        }
        case 'hr':
          y += normal.size * 0.3;
          shapes.push({
            kind: 'line',
            x1: left,
            x2: right,
            y1: y,
            y2: y,
            weight: 1,
          });
          y += normal.size * 0.7;
          break;
        case 'blockquote': {
          const top = y;
          blocks(token.tokens, left + normal.size * 0.8, compact);
          shapes.push({
            kind: 'line',
            x1: left + 2,
            x2: left + 2,
            y1: top,
            y2: Math.max(top + normal.size, y - normal.size * 0.3),
            weight: 2,
          });
          break;
        }
        case 'list': {
          const start = typeof token.start === 'number' ? token.start : 1;
          const markerWidth = token.ordered
            ? Math.max(
                normal.size,
                measureText(font(normal), `${start + token.items.length - 1}.`),
              )
            : normal.size;
          token.items.forEach((item: Tokens.ListItem, index: number) => {
            const top = y;
            // Marked requires a label after the task marker. Also allow an empty
            // checkbox, useful while composing a checklist in a drawing.
            const emptyTask = !item.task && /^\[([ xX])\]\s*$/.exec(item.text);
            if (item.task || emptyTask) {
              const size = normal.size * 0.65,
                x = left,
                topBox = top + normal.size * 0.3;
              shapes.push({
                kind: 'rect',
                x,
                y: topBox,
                width: size,
                height: size,
              });
              if (item.checked || (emptyTask && emptyTask[1] !== ' ')) {
                shapes.push({
                  kind: 'line',
                  x1: x + size * 0.15,
                  y1: topBox + size * 0.5,
                  x2: x + size * 0.4,
                  y2: topBox + size * 0.8,
                  weight: 1.5,
                });
                shapes.push({
                  kind: 'line',
                  x1: x + size * 0.4,
                  y1: topBox + size * 0.8,
                  x2: x + size * 0.9,
                  y2: topBox + size * 0.15,
                  weight: 1.5,
                });
              }
            } else if (token.ordered)
              shapes.push({
                kind: 'text',
                ...normal,
                x: left,
                y: top + normal.size,
                value: `${start + index}.`,
              });
            else
              shapes.push({
                kind: 'bullet',
                x: left + normal.size * 0.2,
                y: top + normal.size * 0.65,
                radius: normal.size * 0.12,
              });
            if (!emptyTask)
              blocks(item.tokens, left + markerWidth + normal.size * 0.45, true);
            if (y === top) y += normal.size * 1.4;
          });
          if (!compact) y += normal.size * 0.45;
          break;
        }
        default:
          flow([{ ...normal, value: token.raw.trimEnd() }], left, normal, true);
          y += normal.size * 0.45;
      }
  }
  blocks(Lexer.lex(source.replace(/\r\n?/g, '\n'), { gfm: true }));
  return shapes;
}
