import { placeFootprintPoint } from './footprint';
import type { FootprintGraphic } from './footprintDetails';
import { footprintStrokeGlyphs } from './footprintStrokeFont';
import type { BoardPoint } from './geometry';

type TextGraphic = Extract<FootprintGraphic, { kind: 'text' }>;
type TextFields = { reference?: string; value?: string };

const maxTextCharacters = 128;

export function resolveFootprintText(text: string, fields: TextFields) {
  return text.replace(/[$]\{([^}]*)\}/g, (_, field: string) => {
    if (field === 'VALUE') return fields.value ?? '';
    if (field !== 'REFERENCE')
      throw new Error('Unsupported footprint text field ' + field + '.');
    if (!fields.reference)
      throw new Error('The footprint reference field has no placed reference.');
    return fields.reference;
  });
}

export function footprintTextStrokes(item: TextGraphic, text = item.text) {
  if (!item.visible || !text.trim()) return [];
  if (text.length > maxTextCharacters)
    throw new Error('Footprint text exceeds the supported 128 characters.');
  if (item.strokeNm < 2)
    throw new Error('Footprint text needs a positive stroke width.');

  const lines = text
    .replace(/\r\n?/g, '\n')
    .replaceAll('\t', '    ')
    .split('\n');
  const capWidth = item.sizeNm.x;
  const capHeight = item.sizeNm.y;
  const pitch = 1.3 * capWidth;
  const leading = 1.6 * capHeight;
  const height = capHeight + (lines.length - 1) * leading;
  const top = item.align.includes('top')
    ? 0
    : item.align.includes('bottom')
    ? height
    : height / 2;
  const handedness = item.align.includes('mirror') ? -1 : 1;
  return lines.flatMap((line, row) => {
    const characters = [...line];
    const width = Math.max(0, (characters.length - 1) * pitch + capWidth);
    const left = item.align.includes('left')
      ? 0
      : item.align.includes('right')
      ? -width
      : -width / 2;
    return characters.flatMap((character, column) => {
      if (character === ' ') return [];
      const glyph = footprintStrokeGlyphs[character];
      if (!glyph)
        throw new Error(
          'Unsupported footprint text glyph ' + JSON.stringify(character) + '.',
        );
      return glyph.split('/').map((stroke) =>
        stroke.split(' ').map(
          (position): BoardPoint =>
            placeFootprintPoint(
              {
                x: Math.round(
                  (left +
                    column * pitch +
                    (Number(position[0]) * capWidth) / 4) *
                    handedness,
                ),
                y: Math.round(
                  top - row * leading - (Number(position[1]) * capHeight) / 6,
                ),
              },
              {
                positionNm: item.at,
                rotationMicrodegree: item.rotationMicrodegree,
                side: 'top',
              },
            ),
        ),
      );
    });
  });
}
