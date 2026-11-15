import { measureText } from '../../renderer/serverMeasureText';
export interface IcPin {
  name: string;
  number: string;
  side: 'north' | 'south' | 'east' | 'west';
  order: number;
  electricalType?: number;
}
const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
export function createIc(name: string, pins: IcPin[]) {
  const checkText = (s: string, limit: number) =>
    typeof s === 'string' &&
    !!s.trim() &&
    s === s.trim() &&
    s.length <= limit &&
    !/[\x00-\x1f]/.test(s);
  if (
    !checkText(name, 128) ||
    !Array.isArray(pins) ||
    !pins.length ||
    pins.length > 256
  )
    throw new Error('Provide a name and 1–256 verified pins.');
  const sides = ['north', 'south', 'east', 'west'] as const;
  const numbers = new Set<string>(),
    positions = new Set<string>();
  for (const p of pins) {
    if (
      !p ||
      !checkText(p.name, 128) ||
      !checkText(p.number, 32) ||
      !sides.includes(p.side) ||
      !Number.isInteger(p.order) ||
      p.order < 1 ||
      p.order > 256 ||
      !Number.isInteger(p.electricalType ?? 8) ||
      (p.electricalType ?? 8) < 0 ||
      (p.electricalType ?? 8) > 11
    )
      throw new Error(
        'Invalid pin: check name, string number, side, order and electricalType (0–11).',
      );
    if (
      numbers.has(p.number.toLowerCase()) ||
      positions.has(`${p.side}:${p.order}`)
    )
      throw new Error(
        'Physical pin numbers and per-side orders must be unique.',
      );
    numbers.add(p.number.toLowerCase());
    positions.add(`${p.side}:${p.order}`);
  }
  const groups = Object.fromEntries(
    sides.map((side) => [
      side,
      pins.filter((p) => p.side === side).sort((a, b) => a.order - b.order),
    ]),
  ) as Record<IcPin['side'], IcPin[]>;
  const widthOf = (s: string, size = 10) =>
    measureText(`${size}px Arial`, s) * 1.1;
  const depth = (side: IcPin['side']) =>
    groups[side].length
      ? Math.max(...groups[side].map((p) => widthOf(p.name))) / 5 + 1
      : 0;
  const span = (side: IcPin['side']) =>
    groups[side].length ? (groups[side].length - 1) * 2 + 2 : 0;
  const grid = (v: number) => Math.ceil(v / 2) * 2;
  let width = grid(
    Math.max(
      12,
      Math.max(span('north'), span('south'), widthOf(name, 12) / 5) +
        2 * Math.max(depth('west'), depth('east')) +
        4,
    ),
  );
  let height = grid(
    Math.max(
      12,
      Math.max(span('west'), span('east'), 2.4) +
        2 * Math.max(depth('north'), depth('south')) +
        4,
    ),
  );
  width = Math.max(width, grid(height / 2));
  height = Math.max(height, grid(width / 2));
  const pinLength =
    Math.ceil(Math.max(20, ...pins.map((p) => widthOf(p.number) + 8)) / 5) * 5;
  const stem = pinLength / 5,
    positionsOut: any[] = [];
  // NOTE_TEXT uses the editor's padded text renderer. Legacy TEXT imports only
  // reserve font-size + 2 units, which clips the title's baseline/descenders.
  const titleWidth = Math.ceil(widthOf(name, 12) + 6);
  const titleHeight = 24;
  const titleX = (width - titleWidth / 5) / 2;
  const titleY = (height - titleHeight / 5) / 2;
  // A component name is literal text, even when it contains Markdown punctuation.
  const title = name.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, '\\$&');
  let definition = `<TinyCAD><NAME>${escape(
    name,
  )}</NAME><FONT id="1"><HEIGHT>12</HEIGHT><WIDTH>0</WIDTH><WEIGHT>400</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT><STYLE id="1"><STYLE>0</STYLE><COLOR>000000</COLOR><THICKNESS>1</THICKNESS></STYLE><RECTANGLE a="0,0" b="${width},${height}" style="1" fill="0"/><NOTE_TEXT a="${titleX},${titleY}" b="${
    titleX + titleWidth / 5
  },${
    titleY + titleHeight / 5
  }" direction="3" font="1" style="1" fill="0" border_style="2" color="000000">${escape(
    title,
  )}</NOTE_TEXT>`;
  for (const side of sides)
    groups[side].forEach((p, i, group) => {
      const along =
        (side === 'west' || side === 'east' ? height : width) / 2 +
        (i - (group.length - 1) / 2) * 2;
      const x =
        side === 'west' ? -stem : side === 'east' ? width + stem : along;
      const y =
        side === 'north' ? -stem : side === 'south' ? height + stem : along;
      const direction = { north: 1, south: 0, west: 3, east: 2 }[side];
      definition += `<PIN pos="${x},${y}" which="0" elec="${
        p.electricalType ?? 8
      }" direction="${direction}" part="0" number="${escape(
        p.number,
      )}" show="3" length="${pinLength}" number_pos="0" centre_name="0">${escape(
        p.name,
      )}</PIN>`;
      positionsOut.push({ ...p, electricalType: p.electricalType ?? 8, x, y });
    });
  return {
    definition: definition + '</TinyCAD>',
    width,
    height,
    pinPitch: 2,
    pinLength,
    pins: positionsOut,
  };
}
