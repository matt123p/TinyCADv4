import { canonicalJson } from '../util/canonicalJson';
import { digest } from '../util/sha256';
import type { BoardDocument, CopperLayer } from './board';
import { validateBoard } from './board';
import { boardLayers, placedBoardLayer } from './boardLayers';
import type {
  BoardComponent,
  BoardFootprint,
  EmbeddedDevice,
  EmbeddedFootprint,
} from './boardAssets';
import { editableProfile } from './boardProfiles';
import { preferredTrackWidth, resolveBoardRules } from './boardRules';
import { viaIsTented } from './boardRouting';
import type { ContourEdge } from './contours';
import type { FootprintGraphic } from './footprintDetails';
import { footprintArc } from './footprintArc';
import { samePoint } from './geometry';
import type { BoardPoint } from './geometry';
import {
  kicadPad,
  kicadString as q,
  mm,
  shapePolygon,
  xy,
  xyList,
} from './kicadBoardPads';
import type { PadShape } from './padstack';

const fileVersion = 20241229;
const KiCadVersion = '9.0';
const copper = (side: CopperLayer['id']) => (side === 'top' ? 'F.Cu' : 'B.Cu');
const layerSide = (side: CopperLayer['id']) => (side === 'top' ? 'F.' : 'B.');
const otherSide = (side: CopperLayer['id']) =>
  side === 'top' ? 'bottom' : 'top';
const form = (...items: (string | number | undefined)[]) =>
  '(' +
  items.filter((item) => item !== undefined && item !== '').join(' ') +
  ')';
const at = (spot: BoardPoint, rotation?: number) =>
  form('at', xy(spot), rotation === undefined ? undefined : mm(rotation * 1e6));
const stroke = (width: number) =>
  form('stroke', form('width', mm(width)), '(type solid)');
const itemLayer = (layer: string) => form('layer', q(layer));
const uuid = (id: string) => form('uuid', q(id));
const encoder = new TextEncoder();

interface ExportNote {
  kind: 'translation' | 'omission';
  code: string;
  detail: string;
  objects: readonly string[];
}
type RecordNote = (
  kind: ExportNote['kind'],
  code: string,
  detail: string,
  ...objects: string[]
) => void;
type BoardNetLookup = ReadonlyMap<string, { number: number; name: string }>;

function edgeItem(edge: ContourEdge) {
  const start = form('start', xy(edge.start));
  const end = form('end', xy(edge.end));
  const style = [stroke(50_000), itemLayer('Edge.Cuts')];
  if (edge.kind === 'line') return form('gr_line', start, end, ...style);
  const { centre, clockwise } = edge;
  const from = Math.atan2(edge.start.y - centre.y, edge.start.x - centre.x);
  const to = Math.atan2(edge.end.y - centre.y, edge.end.x - centre.x);
  const full = 2 * Math.PI;
  const direction = clockwise ? -1 : 1;
  const angle =
    from + direction * ((((to - from) * direction + full) % full) / 2);
  const radius = Math.hypot(edge.start.x - centre.x, edge.start.y - centre.y);
  const mid = {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  };
  return form('gr_arc', start, form('mid', xy(mid)), end, ...style);
}

function graphic(
  item: FootprintGraphic,
  project: (point: BoardPoint) => BoardPoint,
  side: CopperLayer['id'],
  rotation: number,
  scope: 'fp' | 'gr' = 'fp',
) {
  const back = side === 'bottom';
  const layer = placedBoardLayer(item.layer, side);
  const p = (tag: string, point: BoardPoint) => form(tag, xy(project(point)));
  if (item.kind === 'text') {
    const turn =
      rotation +
      (back ? -item.rotationMicrodegree : item.rotationMicrodegree) / 1e6;
    const align = item.align.filter((value) => value !== 'mirror');
    if (item.align.includes('mirror') !== back) align.push('mirror');
    const font = form(
      'font',
      form('size', mm(item.sizeNm.x), mm(item.sizeNm.y)),
      form('thickness', mm(item.strokeNm)),
    );
    return form(
      scope + '_text',
      scope === 'fp' ? 'user' : undefined,
      q(item.text),
      at(project(item.at), turn),
      itemLayer(layer),
      item.visible ? undefined : '(hide yes)',
      form(
        'effects',
        font,
        align.length ? form('justify', ...align) : undefined,
      ),
    );
  }
  const command = item.kind === 'polygon' ? 'poly' : item.kind;
  const geometry =
    item.kind === 'polygon'
      ? [form('pts', xyList(item.points.map(project)))]
      : item.kind === 'circle'
      ? [p('center', item.center), p('end', item.end)]
      : [
          p('start', item.start),
          item.kind === 'arc' ? p('mid', item.mid) : undefined,
          p('end', item.end),
        ];
  const fill = ['rect', 'circle', 'polygon'].includes(item.kind)
    ? form('fill', item.filled ? 'solid' : 'none')
    : undefined;
  return form(
    scope + '_' + command,
    ...geometry,
    stroke(item.strokeNm),
    fill,
    itemLayer(layer),
  );
}

const field = (name: string, value: string, side: string, rotation: number) =>
  form(
    'property',
    q(name),
    q(value),
    at({ x: 0, y: 0 }, rotation),
    itemLayer(side + 'Fab'),
    '(hide yes)',
    '(effects (font (size 1 1) (thickness 0.15)))',
  );

function footprintItems(
  placement: BoardFootprint,
  part: BoardComponent,
  device: EmbeddedDevice,
  library: EmbeddedFootprint,
  nets: BoardNetLookup,
  layerCount: number,
  note: RecordNote,
) {
  const rotation = placement.rotationMicrodegree / 1e6;
  const mirror = (point: BoardPoint) => ({
    x: placement.side === 'bottom' ? -point.x : point.x,
    y: point.y,
  });
  const side = layerSide(placement.side);
  const assignments = new Map(
    device.assignments.map((assignment) => [assignment.padId, assignment]),
  );
  const signals = new Map(
    part.signals?.map(({ signalId, netId }) => [signalId, netId]),
  );
  const pads: string[] = [];
  const independentApertures: string[] = [];
  for (const pad of library.pads) {
    const objects = [placement.id, pad.id];
    if (!pad.stack) {
      note(
        'omission',
        'pad-geometry-missing',
        'The pad has no physical stack.',
        ...objects,
      );
      continue;
    }
    const stack = pad.stack;
    const assigned = assignments.get(pad.id);
    const netId =
      assigned?.kind === 'signal' ? signals.get(assigned.signalId) : undefined;
    const net = netId && nets.get(netId);
    const electrical = net
      ? ' (net ' + net.number + ' ' + q(net.name) + ')'
      : '';
    const label = stack.drill && !stack.drill.plated ? '' : pad.label;
    const project = (point: BoardPoint) =>
      mirror({
        x: point.x + pad.positionNm.x,
        y: point.y + pad.positionNm.y,
      });
    const mountSides = (['top', 'bottom'] as const).map((local) => {
      const physical = placement.side === 'top' ? local : otherSide(local);
      return {
        local,
        physical,
        land:
          layerCount > 1 || physical === 'top'
            ? stack.copper[local]
            : undefined,
      };
    });
    const maskAndPaste = (['mask', 'paste'] as const).flatMap((kind) =>
      mountSides.flatMap(({ local, physical }) => {
        const aperture = stack[kind]?.[local];
        return aperture
          ? [
              {
                aperture,
                local,
                layer:
                  layerSide(physical) + (kind === 'mask' ? 'Mask' : 'Paste'),
                kind,
              },
            ]
          : [];
      }),
    );
    const inherit = new Set<string>();
    const exportedPads: string[] = [];
    const emit = (
      shape: PadShape | undefined,
      hole: typeof stack.drill,
      padLayers: readonly string[],
      netTerm = electrical,
    ) =>
      exportedPads.push(
        kicadPad(label, shape, hole, project, rotation, padLayers, netTerm),
      );
    try {
      if (stack.drill) {
        const top = mountSides[0].land;
        const bottom = mountSides[1].land;
        const compatible = stack.drill.plated
          ? layerCount === 1
            ? top || bottom
            : top && bottom && canonicalJson(top) === canonicalJson(bottom)
          : !top && !bottom;
        if (!compatible)
          throw new Error(
            'Copper faces and drill cannot be represented as one KiCad through pad.',
          );
        const land = stack.drill.plated ? top ?? bottom : undefined;
        const padLayers = ['*.Cu'];
        const masks = maskAndPaste.filter(({ kind }) => kind === 'mask');
        if (
          masks.length === 2 &&
          land &&
          masks.every(
            ({ aperture }) => canonicalJson(aperture) === canonicalJson(land),
          )
        ) {
          padLayers.push('*.Mask');
          masks.forEach(({ layer }) => inherit.add(layer));
        }
        emit(
          land,
          stack.drill,
          padLayers,
          stack.drill.plated ? electrical : '',
        );
      } else {
        for (const { local, physical, land } of mountSides) {
          if (!land) continue;
          const matching = maskAndPaste.filter(
            (entry) =>
              entry.local === local &&
              canonicalJson(entry.aperture) === canonicalJson(land),
          );
          emit(land, undefined, [
            copper(physical),
            ...matching.map(({ layer }) => layer),
          ]);
          matching.forEach(({ layer }) => inherit.add(layer));
        }
        if (!exportedPads.length)
          throw new Error('There is no pad land on a physical copper layer.');
        if (exportedPads.length > 1)
          note(
            'translation',
            'split-surface-pad',
            'Independent copper faces became separate pads with a shared number and net.',
            ...objects,
          );
      }
    } catch (error) {
      note(
        'omission',
        'pad-geometry',
        error instanceof Error ? error.message : String(error),
        ...objects,
      );
      continue;
    }
    pads.push(...exportedPads);
    const separate = maskAndPaste.filter(({ layer }) => !inherit.has(layer));
    for (const { aperture, layer } of separate) {
      independentApertures.push(
        form(
          'fp_poly',
          form('pts', xyList(shapePolygon(aperture, project))),
          stroke(0),
          '(fill solid)',
          itemLayer(layer),
        ),
      );
    }
    if (separate.length)
      note(
        'translation',
        'pad-apertures',
        'Independent mask or paste openings became filled footprint graphics on their original layers.',
        ...objects,
      );
  }
  if (library.graphics?.some((item) => item.kind === 'text'))
    note(
      'translation',
      'text-font',
      'Footprint text uses KiCad stroke glyphs. Review text artwork after opening.',
      placement.id,
    );
  for (const model of library.models ?? [])
    note(
      'omission',
      'step-model',
      'STEP model attachment was omitted. Source: ' + model.source,
      placement.id,
    );
  if (part.role === 'net-tie')
    note(
      'omission',
      'net-tie-intent',
      'The pad nets were retained. Review KiCad net-tie groups before continuing.',
      part.id,
    );
  if (
    !placement.locked &&
    (placement.positionLocked || placement.rotationLocked)
  )
    note(
      'omission',
      'partial-placement-lock',
      'The footprint has an independent position or rotation lock in TinyCAD. KiCad export supports the full footprint lock.',
      placement.id,
    );
  const flags =
    part.role === 'dnp'
      ? ' (attr dnp)'
      : part.role === 'pcb-only'
      ? ' (attr board_only)'
      : '';
  const name = library.name.replaceAll(':', '-');
  const contents = [
    field('Reference', part.reference ?? '', side, rotation),
    field('Value', part.value ?? '', side, rotation),
    ...(library.datasheetUrl
      ? [field('Datasheet', library.datasheetUrl, side, rotation)]
      : []),
    ...(library.graphics?.flatMap((item, index) => {
      const invalid =
        (item.strokeNm === 0 && !item.filled) ||
        (item.kind === 'circle' && samePoint(item.center, item.end)) ||
        (item.kind === 'rect' &&
          (item.start.x === item.end.x || item.start.y === item.end.y)) ||
        (item.kind === 'arc' && !footprintArc(item));
      if (invalid) {
        note(
          'omission',
          'graphic-geometry',
          'Footprint graphic has no supported visible geometry.',
          placement.id,
          'graphic:' + index,
        );
        return [];
      }
      return [graphic(item, mirror, placement.side, rotation)];
    }) ?? []),
    ...pads,
    ...independentApertures,
  ];
  return {
    pads: pads.length,
    text: form(
      'footprint',
      q('TinyCAD:' + name),
      itemLayer(copper(placement.side)),
      uuid(placement.id),
      at(placement.positionNm, rotation),
      placement.locked ? '(locked yes)' : undefined,
      flags,
      '\n    ' + contents.join('\n    ') + '\n  ',
    ),
  };
}

export async function exportKicadBoard(board: BoardDocument) {
  validateBoard(board);
  const notes: ExportNote[] = [];
  const note: RecordNote = (kind, code, detail, ...objects) =>
    notes.push({ kind, code, detail, objects });
  for (const jumper of board.jumpers ?? [])
    note(
      'omission',
      'wire-jumper',
      'Wire jumper ' +
        jumper.reference +
        ', its copper lands and drill openings remain in the TinyCAD board.',
      jumper.id,
    );
  for (const area of board.placementAreas ?? [])
    note(
      'omission',
      'placement-area',
      'Placement ' +
        area.kind +
        ' “' +
        area.name +
        '” is recorded in the TinyCAD board.',
      area.id,
    );
  for (const region of board.routingRegions ?? [])
    note('omission', 'routing-region',
      'Routing region “' + region.name + '” is recorded in the TinyCAD board.', region.id);
  if (board.annotations?.datum)
    note('omission', 'measurement-datum', 'The measurement datum remains in the TinyCAD board.');
  for (const dimension of board.annotations?.dimensions ?? [])
    note('omission', 'board-dimension', 'A dimension annotation remains in the TinyCAD board.', dimension.id);
  const layerCount = board.copperLayers.length;
  if (layerCount === 1)
    note(
      'translation',
      'single-layer',
      'KiCad uses a two-layer stack. The additional back copper layer can contain plated pad or mechanical lands.',
    );
  if (board.sourceCircuit)
    note(
      'omission',
      'schematic-link',
      'TinyCAD schematic identities and update history remain in the native project.',
    );
  if (board.waivers?.length)
    note(
      'omission',
      'design-check-waivers',
      'TinyCAD waivers require independent review in KiCad.',
      ...board.waivers.map(({ id }) => id),
    );

  const names = new Set<string>();
  const nets = new Map(
    (board.nets ?? []).map((net, i) => {
      let name = net.name;
      let suffix = 1;
      while (names.has(name)) name = net.name + '~' + ++suffix;
      if (name !== net.name)
        note(
          'translation',
          'duplicate-net-name',
          'A duplicate net name was renamed to ' + name + '.',
          net.id,
        );
      if (net.aliases?.length)
        note(
          'omission',
          'net-aliases',
          'Alternate net names are recorded in the report.',
          net.id,
        );
      names.add(name);
      return [net.id, { number: i + 1, name }];
    }),
  );
  const linked = (id: string | undefined) => nets.get(id)?.number ?? 0;
  const footprints = new Map(
    board.footprintDefinitions?.map((item) => [item.id, item]),
  );
  const devices = new Map(
    board.deviceDefinitions?.map((item) => [item.id, item]),
  );
  const parts = new Map(board.components?.map((item) => [item.id, item]));
  const placed = new Set(
    board.footprints?.map(({ componentId }) => componentId),
  );
  for (const id of parts.keys())
    if (!placed.has(id))
      note(
        'omission',
        'unplaced-component',
        'Unplaced component has no KiCad placement.',
        id,
      );
  const mounted = (board.footprints ?? []).map((placement) => {
    const device = devices.get(placement.deviceId);
    return footprintItems(
      placement,
      parts.get(placement.componentId),
      device,
      footprints.get(device.footprintId),
      nets,
      layerCount,
      note,
    );
  });

  if (mounted.length || board.mechanicalHoles?.length)
    note(
      'translation',
      'embedded-footprints',
      'Footprints are embedded in the board. KiCad can flag their library locator until a local library is assigned.',
    );

  const tracks = (board.tracks ?? []).map((track) => {
    if (track.locked)
      note('omission', 'routing-lock', 'The routing lock remains in the TinyCAD board.', track.id);
    if (track.reviewRequired)
      note(
        'omission',
        'route-review',
        'The trace was exported. Its TinyCAD review flag remains in the native file.',
        track.id,
      );
    return form(
      'segment',
      form('start', xy(track.start)),
      form('end', xy(track.end)),
      form('width', mm(track.widthNm)),
      itemLayer(copper(track.layerId)),
      form('net', linked(track.netId)),
      uuid(track.id),
    );
  });
  const vias = (board.vias ?? []).map((via) => {
    if (via.locked)
      note('omission', 'routing-lock', 'The routing lock remains in the TinyCAD board.', via.id);
    if (via.reviewRequired)
      note(
        'omission',
        'route-review',
        'The via was exported. Its TinyCAD review flag remains in the native file.',
        via.id,
      );
    const tentedSides = [
      viaIsTented(via, 'top') ? 'front' : undefined,
      viaIsTented(via, 'bottom') ? 'back' : undefined,
    ].filter(Boolean);
    return form(
      'via',
      at(via.positionNm),
      form('size', mm(via.diameterNm)),
      form('drill', mm(via.drillNm)),
      '(layers "F.Cu" "B.Cu")',
      via.tenting === undefined ? undefined : form('tenting', ...(tentedSides.length ? tentedSides : ['none'])),
      form('net', linked(via.netId)),
      uuid(via.id),
    );
  });
  const mechanical = (board.mechanicalHoles ?? []).map((hole, index) => {
    if (hole.clearanceNm !== undefined || hole.screwHeadDiameterNm !== undefined)
      note(
        'omission',
        'mechanical-clearance',
        'The hole was retained. Its routing, screw-head or body clearance requires review in KiCad.',
        hole.id,
      );
    const center = {
      x: Math.round((hole.start.x + hole.end.x) / 2),
      y: Math.round((hole.start.y + hole.end.y) / 2),
    };
    const pad = kicadPad(
      '',
      hole.plated
        ? { ...hole, kind: 'capsule', widthNm: hole.landWidthNm }
        : undefined,
      hole,
      (p) => ({ x: p.x - center.x, y: p.y - center.y }),
      0,
      ['*.Cu'],
      '',
    );
    return form(
      'footprint',
      q('TinyCAD:Mechanical hole'),
      itemLayer('F.Cu'),
      uuid(hole.id),
      at(center),
      '(attr board_only exclude_from_bom exclude_from_pos_files)',
      field('Reference', 'MH' + (index + 1), 'F.', 0),
      field('Value', hole.plated ? 'Plated hole' : 'Non-plated hole', 'F.', 0),
      pad,
    );
  });
  const rules = resolveBoardRules(board);
  const scopedNets = (board.nets ?? []).filter(({ classId, routingRules }) => classId || routingRules);
  if (scopedNets.length || board.netClasses?.length)
    note('omission', 'net-routing-rules',
      'PCB net classes and per-net routing rules were not exported.',
      ...(board.netClasses ?? []).map(({ id }) => id), ...scopedNets.map(({ id }) => id));
  if (board.clearanceRules?.length)
    note('omission', 'pair-clearance-rules',
      'Class-to-class and copper object clearance rules were not exported.',
      ...board.clearanceRules.map(({ id }) => id));
  const zones = (board.zones ?? []).flatMap((zone) => {
    const net = nets.get(zone.netId);
    if (
      !net ||
      zone.padConnection !== zone.viaConnection ||
      zone.cutouts.length ||
      zone.islands === 'flag' ||
      zone.priority < 0 ||
      zone.priority > 2 ** 31 - 1
    ) {
      note(
        'omission',
        'zone-policy',
        'An unassigned zone, cutout, priority, or connection/island policy could not be mapped.',
        zone.id,
      );
      return [];
    }
    note(
      'translation',
      'zone-refill',
      'Editable zone settings were exported. Refill and check connections and clearances in KiCad.',
      zone.id,
    );
    const connection =
      zone.padConnection === 'thermal'
        ? undefined
        : zone.padConnection === 'direct'
        ? 'yes'
        : 'no';
    return [
      form(
        'zone',
        form('net', net.number),
        form('net_name', q(net.name)),
        itemLayer(copper(zone.layerId)),
        uuid(zone.id),
        form('priority', zone.priority),
        '(hatch edge 0.5)',
        form(
          'connect_pads',
          connection,
          form(
            'clearance',
            mm(Math.max(zone.clearanceNm ?? 0, rules.clearanceNm)),
          ),
        ),
        form('min_thickness', mm(zone.spokeWidthNm)),
        form(
          'fill',
          'yes',
          form('thermal_gap', mm(zone.thermalGapNm)),
          form('thermal_bridge_width', mm(zone.spokeWidthNm)),
          form('island_removal_mode', zone.islands === 'retain' ? 1 : 0),
        ),
        form('polygon', form('pts', xyList(zone.outline))),
      ),
    ];
  });

  const profile = editableProfile(board);
  const edges = [profile.outline, ...profile.cutouts].flatMap((contour) =>
    contour.map(edgeItem),
  );
  const thickness = board.fabrication?.thicknessNm ?? 1_600_000;
  if (board.fabrication?.profileId)
    note(
      'translation',
      'fabrication-profile',
      'Board thickness and effective copper minima were transferred. Additional TinyCAD process checks require review.',
    );
  if (!board.fabrication)
    note(
      'translation',
      'board-thickness',
      'A default thickness of 1.6 mm was used.',
    );
  if (board.fabrication?.stackup)
    note(
      'omission',
      'stackup-properties',
      'The dielectric, substrate and individual copper thicknesses stay in the native board. Enter the chosen fabrication stackup in KiCad.',
    );
  if (board.graphicLayers?.length)
    note(
      'omission',
      'layer-metadata',
      'TinyCAD layer labels and roles stay in the native PCB.',
      ...board.graphicLayers.map(({ id }) => id),
    );

  const boardContents = [
    form('version', fileVersion),
    '(generator "tinycad") (generator_version "1")',
    form('general', form('thickness', mm(thickness))),
    form('title_block', form('title', q(board.title))),
    form(
      'layers',
      ...boardLayers.map((layer) =>
        form(layer.kicadId, q(layer.id), layer.id.endsWith('.Cu') ? 'signal' : 'user',
          'kicadName' in layer ? q(layer.kicadName) : undefined),
      ),
    ),
    '(setup (pad_to_mask_clearance 0) (tenting front back))',
    ...Array.from(nets.values(), ({ number, name }) =>
      form('net', number, q(name)),
    ),
    ...mounted.map(({ text }) => text),
    ...mechanical,
    ...edges,
    ...(board.annotations?.graphics ?? []).filter((item) => item.kind !== 'text' || item.visible)
      .map((item) => graphic(item, (point) => point, 'top', 0, 'gr')),
    ...tracks,
    ...vias,
    ...zones,
  ];
  const pcb = '(kicad_pcb ' + boardContents.join('\n  ') + '\n)\n';
  const rule = (
    name: string,
    constraint: string,
    minimum: number,
    condition?: string,
    preferred?: number,
    maximum?: number,
  ) =>
    form(
      'rule',
      q('TinyCAD ' + name),
      condition && form('condition', q(condition)),
      form(
        'constraint', constraint, form('min', mm(minimum) + 'mm'),
        preferred === undefined ? undefined : form('opt', mm(preferred) + 'mm'),
        maximum === undefined ? undefined : form('max', mm(maximum) + 'mm'),
      ),
    );
  const designRules = [
    '(version 1)',
    rule('track width', 'track_width', rules.minWidthNm, undefined,
      rules.preferredWidthNm === undefined ? undefined : preferredTrackWidth(rules, rules.minWidthNm),
      rules.maxWidthNm),
    rule('copper clearance', 'clearance', rules.clearanceNm),
    rule('edge clearance', 'edge_clearance', rules.edgeClearanceNm),
    rule('via ring', 'annular_width', rules.minViaAnnulusNm, "A.Type == 'Via'"),
    '',
  ].join('\n');
  const report = {
    kind: 'tinycad-kicad-export',
    schemaVersion: 1,
    target: { application: 'KiCad', version: KiCadVersion, fileVersion },
    source: {
      boardId: board.boardId,
      revision: board.revision,
      digest: await digest(encoder.encode(canonicalJson(board))),
    },
    counts: {
      footprints: mounted.length,
      pads: mounted.reduce((sum, { pads }) => sum + pads, 0),
      mechanicalHoles: mechanical.length,
      tracks: tracks.length,
      vias: vias.length,
      nets: nets.size,
      profileEdges: edges.length,
      zones: zones.length,
    },
    coordinates: {
      lengthUnit: 'mm',
      x: 'right',
      y: 'down',
      datum: 'TinyCAD origin',
    },
    nets: (board.nets ?? []).map(({ id, name, aliases }) => ({
      id,
      name,
      aliases,
      target: nets.get(id),
    })),
    notes,
  };
  return { pcb, designRules, report };
}
