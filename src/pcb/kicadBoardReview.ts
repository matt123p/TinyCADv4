import { parseSexpr } from '../io/kicad/kicadSexprParser';
import type { SExprList } from '../io/kicad/kicadSexprParser';
import { digest } from '../util/sha256';

export const kicadBoardReviewByteLimit = 16 * 1024 * 1024;

type ViaKind = 'through' | 'blind' | 'buried' | 'microvia' | 'unknown';
const outerCopper = new Set(['F.Cu', 'B.Cu']);
const viaModifiers = new Set(['locked', 'free', 'remove_unused_layers', 'keep_end_layers']);
const viaKinds = new Set(['blind', 'buried', 'micro']);
const child = (node: SExprList, tag: string) =>
  node.children.find((entry) => entry.tag === tag);

function viaKind(via: SExprList, layers: readonly string[], validSpan: boolean): ViaKind {
  const types = [
    ...via.values.filter((value) => typeof value !== 'string' || !viaModifiers.has(value)),
    ...via.children.map(({ tag }) => tag).filter((tag) => viaKinds.has(tag)),
  ];
  if (types.length === 1 && types[0] === 'micro') return 'microvia';
  if (!validSpan || types.length > 1) return 'unknown';
  const exterior = layers.filter((layer) => outerCopper.has(layer)).length;
  if (types[0] === 'blind' || types[0] === 'buried') {
    if (exterior === 0) return 'buried';
    if (exterior === 1 && types[0] === 'blind') return 'blind';
  }
  return !types.length && exterior === 2 ? 'through' : 'unknown';
}

export async function reviewKicadBoard(bytes: Uint8Array, filename: string) {
  if (bytes.byteLength > kicadBoardReviewByteLimit)
    throw new Error('Choose a KiCad board no larger than 16 MiB.');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const expressions = new WeakMap<SExprList, readonly [number, number]>();
  const root = parseSexpr(source, {
    maxDepth: 32, singleRoot: true, numericTags: true,
    onList(list, start, end) {
      if (list.tag === 'via') expressions.set(list, [start, end]);
    },
  });
  const version = child(root, 'version')?.values[0];
  const copperLayers = (child(root, 'layers')?.children ?? []).flatMap(({ values }) =>
    typeof values[0] === 'string' && values[0].endsWith('.Cu') ? [values[0]] : []);
  const copper = new Set(copperLayers);
  if (root.tag !== 'kicad_pcb' || typeof version !== 'number' ||
      !Number.isSafeInteger(version) || version < 1 ||
      copper.size !== copperLayers.length || !copper.has('F.Cu') || !copper.has('B.Cu'))
    throw new Error('Expected a KiCad board with its version and copper stack.');

  const vias = root.children.filter(({ tag }) => tag === 'via');
  const unsupportedVias = vias.flatMap((via, index) => {
    const spans = via.children.filter(({ tag }) => tag === 'layers');
    const values = spans[0]?.values ?? [];
    const layers = values.filter((layer): layer is string => typeof layer === 'string');
    const validSpan = spans.length === 1 && values.length === 2 && layers.length === 2 &&
      layers[0] !== layers[1] && layers.every((layer) => copper.has(layer));
    const kind = viaKind(via, layers, validSpan);
    if (kind === 'through') return [];
    const coordinates = child(via, 'at')?.values;
    const positionMm = coordinates?.length === 2 && coordinates.every((atom) => typeof atom === 'number' && Number.isFinite(atom))
      ? coordinates : null;
    const identifier = (child(via, 'uuid') ?? child(via, 'tstamp'))?.values[0];
    const [start, end] = expressions.get(via);
    return [{
      ordinal: index + 1, kind, layers, validSpan, positionMm,
      identifier: typeof identifier === 'string' ? identifier : null,
      expression: source.slice(start, end),
    }];
  });
  return {
    kind: 'tinycad-kicad-board-review' as const,
    version: 1,
    source: {
      filename,
      sha256: await digest(bytes),
      formatVersion: version,
      coordinateFrame: 'kicad-x-right-y-down',
      copperLayers,
    },
    productionExportAllowed: false as const,
    viaCount: vias.length,
    unsupportedVias,
  };
}

export type KicadBoardReview = Awaited<ReturnType<typeof reviewKicadBoard>>;
