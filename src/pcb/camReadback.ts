import type { CamFiles, CamSnapshot } from './camWriter';
import type { ContourEdge, PolygonRegion } from './contours';
import type { BoardDrill } from './copper';
import { isBoardPoint, samePoint, validateOutline } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

const FILE_LIMIT = 8_000_000;

interface Paint {
  dark: boolean;
  polygon: PolygonRegion;
}

/** Independent reader for the G0 Gerber dialect. It consumes commands and reconstructs primitives. */
export function readGerber(source: string) {
  if (typeof source !== 'string' || source.length > FILE_LIMIT)
    throw new Error('Invalid Gerber data size.');
  source = source.trim();
  const tokens = /\s*(%[^%]+%|[^*%\s][^*%]*\*)/gy;
  let fileFunction: string | undefined;
  let metric = false;
  let coordinateScale = 0;
  let imagePositive = false;
  let apertureWidth = 0;
  let apertureSelected = false;
  let multiQuadrant = false;
  let ended = false;
  let mode: 'line' | 'cw' | 'ccw' = 'line';
  let dark = true;
  let current: BoardPoint | undefined;
  let activeContour: ContourEdge[] | undefined;
  let ring: BoardPoint[] | undefined;
  const contours: ContourEdge[][] = [];
  const paints: Paint[] = [];
  const malformed = () =>
    new Error('Malformed or unsupported G0 Gerber command.');
  const nm = (digits: string) => {
    const value = Number(digits) * coordinateScale;
    if (!Number.isSafeInteger(value)) throw malformed();
    return value;
  };
  while (tokens.lastIndex < source.length) {
    const token = tokens.exec(source)?.[1];
    if (!token || ended) throw malformed();
    const format = /^%FSLAX[1-6]([1-6])Y[1-6]\1\*%$/.exec(token);
    const role = /^%TF\.FileFunction,([^*]+)\*%$/.exec(token);
    const aperture = /^%ADD10C,([0-9]+\.[0-9]{1,6})\*%$/.exec(token);
    if (format && !coordinateScale)
      coordinateScale = 10 ** (6 - Number(format[1]));
    else if (role && !fileFunction) fileFunction = role[1];
    else if (token === '%MOMM*%' && !metric) metric = true;
    else if (token === '%TF.FilePolarity,Positive*%' && !imagePositive)
      imagePositive = true;
    else if (aperture && !apertureWidth)
      apertureWidth = Math.round(Number(aperture[1]) * 1_000_000);
    else if (token === 'D10*' && apertureWidth) apertureSelected = true;
    else if (token === '%LPD*%' && !ring) dark = true;
    else if (token === '%LPC*%' && !ring) dark = false;
    else if (token === 'G75*') multiQuadrant = true;
    else if (token === 'G01*') mode = 'line';
    else if (token === 'G02*' && multiQuadrant) mode = 'cw';
    else if (token === 'G03*' && multiQuadrant) mode = 'ccw';
    else if (token === 'G36*' && !ring && !activeContour) ring = [];
    else if (
      token === 'G37*' &&
      ring?.length >= 4 &&
      samePoint(ring[0], ring[ring.length - 1])
    ) {
      const outer = ring.slice(0, -1);
      validateOutline(outer, 100_000);
      paints.push({ dark, polygon: { outer, holes: [] } });
      ring = undefined;
      current = undefined;
    } else if (token === 'M02*' && !ring) ended = true;
    else {
      const move =
        /^X([+-]?\d+)Y([+-]?\d+)(?:I([+-]?\d+)J([+-]?\d+))?D0([12])\*$/.exec(
          token,
        );
      if (
        !move ||
        !metric ||
        !coordinateScale ||
        !fileFunction ||
        !imagePositive ||
        !apertureSelected
      )
        throw malformed();
      const [, x, y, i, j, draw] = move;
      const end = { x: nm(x), y: nm(y) };
      if (!isBoardPoint(end)) throw malformed();
      if (draw === '2') {
        if (i || (ring && ring.length)) throw malformed();
        if (ring) ring.push(end);
        else {
          if (!dark) throw malformed();
          activeContour = [];
          contours.push(activeContour);
        }
      } else {
        if (!current) throw malformed();
        if (ring) {
          if (mode !== 'line' || i) throw malformed();
          ring.push(end);
        } else if (!activeContour || !dark) throw malformed();
        else if (mode === 'line' && !i)
          activeContour.push({ kind: 'line', start: current, end });
        else if (mode !== 'line' && i && j) {
          const centre = { x: current.x + nm(i), y: current.y + nm(j) };
          if (!isBoardPoint(centre)) throw malformed();
          activeContour.push({
            kind: 'arc',
            start: current,
            end,
            centre,
            clockwise: mode === 'cw',
          });
        } else throw malformed();
      }
      current = end;
    }
  }
  if (
    !ended ||
    !fileFunction ||
    !metric ||
    !coordinateScale ||
    !imagePositive ||
    !apertureSelected
  )
    throw malformed();
  return { fileFunction, apertureWidth, contours, paints };
}

type DrillRecord = Omit<BoardDrill, 'id'>;

/** Rebuilds full drill and slot records from tool declarations and modal XNC commands. */
export function readXnc(source: string) {
  const malformed = () => new Error('Malformed or unsupported G0 XNC command.');
  if (typeof source !== 'string' || source.length > FILE_LIMIT)
    throw malformed();
  const lines = source.trim().split(/\r?\n/);
  if (lines.shift() !== 'M48') throw malformed();
  let fileFunction: string | undefined;
  let body = false,
    metric = false,
    ended = false;
  let mode: 'drill' | 'move' | 'down' | 'drawn' | undefined;
  let tool = 0;
  let start: BoardPoint | undefined;
  const tools = new Map<number, number>();
  const drills: DrillRecord[] = [];
  const decimal = /^([+-]?)(\d{1,6})(?:\.(\d{1,6}))?$/;
  const fileFunctionPrefix = '; #@! TF.FileFunction,';
  const nm = (part: string) => {
    const match = decimal.exec(part);
    if (!match) throw malformed();
    return (
      (match[1] === '-' ? -1 : 1) *
      (Number(match[2]) * 1_000_000 + Number((match[3] ?? '').padEnd(6, '0')))
    );
  };
  for (const line of lines) {
    if (ended) throw malformed();
    if (!body) {
      if (line === 'METRIC' && !metric) metric = true;
      else if (line.startsWith(fileFunctionPrefix) && !fileFunction)
        fileFunction = line.slice(fileFunctionPrefix.length);
      else if (line === '%' && metric && fileFunction) body = true;
      else {
        const declaration = /^T([0-9]{2})C(.+)$/.exec(line);
        if (!metric || !declaration) throw malformed();
        const number = Number(declaration[1]);
        if (number < 1 || tools.has(number)) throw malformed();
        const diameter = nm(declaration[2]);
        if (diameter < 2 || diameter > 1_000_000_000) throw malformed();
        tools.set(number, diameter);
      }
      continue;
    }
    if (line === 'G05' && (!mode || mode === 'drill' || mode === 'move'))
      mode = 'drill';
    else if (
      /^T[0-9]{1,2}$/.test(line) &&
      (mode === 'drill' || mode === 'move')
    ) {
      tool = Number(line.slice(1));
      if (!tools.has(tool)) throw malformed();
    } else if (line === 'M15' && tool && mode === 'move') mode = 'down';
    else if (line === 'M16' && mode === 'drawn') mode = 'move';
    else if (line === 'M30' && (mode === 'drill' || mode === 'move'))
      ended = true;
    else {
      const coordinate = /^(G00|G01)?X([^Y]+)Y(.+)$/.exec(line);
      if (!coordinate || !tool) throw malformed();
      const [, action, x, y] = coordinate;
      const point = { x: nm(x), y: nm(y) };
      if (!isBoardPoint(point)) throw malformed();
      const plated = fileFunction.startsWith('Plated,');
      const widthNm = tools.get(tool);
      if (action === 'G00' && (mode === 'drill' || mode === 'move')) {
        start = point;
        mode = 'move';
      } else if (
        action === 'G01' &&
        mode === 'down' &&
        !samePoint(point, start)
      ) {
        drills.push({ start, end: point, widthNm, plated });
        mode = 'drawn';
      } else if (!action && mode === 'drill')
        drills.push({ start: point, end: point, widthNm, plated });
      else throw malformed();
    }
  }
  if (!ended || !fileFunction) throw malformed();
  return { fileFunction, drills };
}

const pointKey = ({ x, y }: BoardPoint) => `${x},${y}`;

function contourKey(contour: readonly ContourEdge[]): string {
  return contour
    .map(
      (edge) =>
        `${pointKey(edge.start)}>${pointKey(edge.end)}` +
        (edge.kind === 'arc'
          ? `/${pointKey(edge.centre)}/${edge.clockwise ? 'CW' : 'CCW'}`
          : ''),
    )
    .sort()
    .join(';');
}

function drillKey(drill: DrillRecord): string {
  return `${drill.plated}:${drill.widthNm}:${[
    pointKey(drill.start),
    pointKey(drill.end),
  ]
    .sort()
    .join('>')}`;
}

/** Reads exported bytes and compares geometry, file roles, drill tools and analytic edges. */
export function verifyCamFiles(
  kernel: PolygonKernel,
  snapshot: CamSnapshot,
  files: CamFiles,
): string[] {
  const issues: string[] = [];
  const check = (name: string, read: () => boolean) => {
    try {
      if (!read())
        issues.push(
          `${name}: geometry or file function differs from the board.`,
        );
    } catch (error) {
      issues.push(
        `${name}: ${
          error instanceof Error ? error.message : 'invalid manufacturing bytes'
        }`,
      );
    }
  };
  const expectedNames = new Set([
    'profile.gbr',
    'plated.xnc',
    'non-plated.xnc',
    ...snapshot.layers.map(({ id }) => `copper-${id}.gbr`),
  ]);
  for (const name of Object.keys(files))
    if (!expectedNames.has(name))
      issues.push(`${name}: unexpected manufacturing file.`);
  snapshot.layers.forEach(({ id, copper }, index) => {
    const name = `copper-${id}.gbr`;
    check(name, () => {
      const actual = readGerber(files[name]);
      if (
        actual.fileFunction !==
          `Copper,L${index + 1},${id === 'top' ? 'Top' : 'Bot'}` ||
        actual.contours.length
      )
        return false;
      let regions: PolygonRegion[] = [];
      let run: PolygonRegion[] = [];
      let dark = true;
      const flush = () => {
        regions = kernel.boolean(dark ? 'union' : 'difference', regions, run);
        run = [];
      };
      for (const paint of actual.paints) {
        if (dark !== paint.dark) {
          if (run.length) flush();
          dark = paint.dark;
        }
        run.push(paint.polygon);
      }
      if (run.length) flush();
      const expected = kernel.boolean('union', copper, []);
      return (
        kernel.boolean('difference', expected, regions).length === 0 &&
        kernel.boolean('difference', regions, expected).length === 0
      );
    });
  });
  check('profile.gbr', () => {
    const actual = readGerber(files['profile.gbr']);
    const expected = [snapshot.profile.outline, ...snapshot.profile.cutouts]
      .map(contourKey)
      .sort();
    return (
      actual.fileFunction === 'Profile,NP' &&
      actual.apertureWidth === 1_000 &&
      !actual.paints.length &&
      JSON.stringify(actual.contours.map(contourKey).sort()) ===
        JSON.stringify(expected)
    );
  });
  for (const plated of [true, false]) {
    const name = plated ? 'plated.xnc' : 'non-plated.xnc';
    check(name, () => {
      const actual = readXnc(files[name]);
      const expectedRole = `${plated ? 'Plated' : 'NonPlated'},1,${
        snapshot.layers.length
      },${plated ? 'PTH' : 'NPTH'}`;
      const expected = snapshot.drills
        .filter((drill) => drill.plated === plated)
        .map(drillKey)
        .sort();
      return (
        actual.fileFunction === expectedRole &&
        JSON.stringify(actual.drills.map(drillKey).sort()) ===
          JSON.stringify(expected)
      );
    });
  }
  return issues;
}
