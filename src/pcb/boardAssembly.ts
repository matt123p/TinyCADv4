import type { BoardDocument } from './board';
import { procurementFields } from './procurement';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const quote = (text: string | number) =>
  '"' + String(text).replaceAll('"', '""') + '"';
const csv = (
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
) =>
  columns.join(',') +
  '\r\n' +
  rows.map((row) => row.map(quote).join(',') + '\r\n').join('');

export function boardAssembly(board: BoardDocument, decimals?: number, csvText?: 'raw') {
  const text = (value: string) =>
    csvText !== 'raw' && /^(?:[\t\r\n]|\s*[=+\-@＝＋－＠])/.test(value) ? "'" + value : value;
  const measurement = (value: number) => {
    const units = value / 1e6;
    return decimals === undefined ? units : units.toFixed(decimals);
  };
  const devices = new Map(
    board.deviceDefinitions?.map((device) => [device.id, device]),
  );
  const parts = [...(board.components ?? [])].sort(
    (a, b) =>
      compare(a.reference ?? a.id, b.reference ?? b.id) || compare(a.id, b.id),
  );
  const placements = new Map(
    board.footprints?.map((placement) => [placement.componentId, placement]),
  );
  const groups = new Map<
    string,
    { references: string[]; value: string; packageName: string; state: string; purchasing: string[] }
  >();
  const assemblyRows = parts.map((part) => {
    const reference = part.reference ?? part.id;
    const value = part.value ?? '';
    const device = devices.get(part.deviceId);
    const packageName = device?.packageName ?? '';
    const placement = placements.get(part.id);
    const status =
      part.role === 'dnp' ? 'DNP' : placement ? 'Fitted' : 'Unplaced';
    const purchasing = procurementFields.map(({ id }) => part.procurement?.[id] ?? '');
    const key = JSON.stringify([value, device?.definitionDigest, status, purchasing]);
    const group = groups.get(key) ?? {
      references: [],
      value,
      packageName,
      state: status,
      purchasing,
    };
    group.references.push(reference);
    groups.set(key, group);
    return {
      status,
      columns: [
        text(reference),
        text(value),
        text(packageName),
        status,
        placement ? measurement(placement.positionNm.x) : '',
        placement ? measurement(placement.positionNm.y) : '',
        placement?.side ?? '',
        placement
          ? measurement(
              ((placement.rotationMicrodegree % 360e6) + 360e6) % 360e6,
            )
          : '',
      ],
    };
  });
  const jumpers = board.jumpers ?? [];
  const names = new Map(board.nets?.map(({ id, name }) => [id, name]));
  for (const jumper of jumpers) {
    const state = jumper.fitted ? 'Fitted' : 'DNP';
    const key = 'wire-jumper:' + state;
    const group = groups.get(key) ?? {
      references: [],
      value: 'Wire jumper',
      packageName: 'Hand fitted',
      state,
      purchasing: procurementFields.map(() => ''),
    };
    group.references.push(jumper.reference);
    groups.set(key, group);
  }
  const placementColumns = [
    'Reference',
    'Value',
    'Package',
    'Population',
    'X (mm)',
    'Y (mm)',
    'Side',
    'Rotation (deg)',
  ];
  const bomColumns = [
    'References', 'Quantity', 'Value', 'Package', 'Population',
    ...procurementFields.map(({ column }) => column),
  ];
  const bomRows = [...groups.values()].map(({ references, value, packageName, state, purchasing }) => ({
    state,
    columns: [text(references.join(', ')), references.length, text(value), text(packageName),
      state, ...purchasing.map(text)],
  }));
  return {
    'bom.csv': csv(bomColumns, bomRows.map(({ columns }) => columns)),
    'bom-fitted.csv': csv(bomColumns, bomRows
      .filter(({ state }) => state === 'Fitted').map(({ columns }) => columns)),
    'placement.csv': csv(
      placementColumns,
      assemblyRows
        .filter(({ status }) => status === 'Fitted')
        .map(({ columns }) => columns),
    ),
    'assembly.csv': csv(placementColumns, [
      ...assemblyRows.map(({ columns }) => columns),
      ...jumpers.map(({ reference, fitted }) => [
        text(reference),
        'Wire jumper',
        'Hand fitted',
        fitted ? 'Fitted' : 'DNP',
        '',
        '',
        'opposite copper',
        '',
      ]),
    ]),
    ...(jumpers.length
      ? {
          'jumpers.csv': csv(
            [
              'Reference',
              'Net',
              'Population',
              'A X (mm)',
              'A Y (mm)',
              'B X (mm)',
              'B Y (mm)',
              'Drill (mm)',
              'Land diameter (mm)',
            ],
            jumpers.map(
              ({
                reference,
                netId,
                fitted,
                start,
                end,
                drillNm,
                landWidthNm,
              }) => [
                text(reference),
                text(names.get(netId) ?? netId),
                fitted ? 'Fitted' : 'DNP',
                start.x / 1e6,
                start.y / 1e6,
                end.x / 1e6,
                end.y / 1e6,
                drillNm / 1e6,
                landWidthNm / 1e6,
              ],
            ),
          ),
        }
      : {}),
  };
}
