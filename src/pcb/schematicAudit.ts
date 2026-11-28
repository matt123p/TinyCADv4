import type { dsnDrawing } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { isEntityId } from '../model/schematicIdentity';

export interface PcbSchematicIssue {
  code:
    | 'hierarchy'
    | 'bus'
    | 'sheet-name'
    | 'multipart'
    | 'reference'
    | 'unit-id'
    | 'pin-id';
  sheetId?: string;
  itemId?: number;
  detail: string;
}

/** Reports schematic structures that need resolution before compiling the initial flat PCB subset. */
export function auditPcbSchematic(drawing: dsnDrawing): PcbSchematicIssue[] {
  const issues: PcbSchematicIssue[] = [];
  const sheetNames = new Set<string>();
  const referenceNames = new Set<string>();
  const unitIds = new Set<string>();
  const interfaceSheets = drawing.sheets.filter((sheet) => sheet.hierarchicalSymbol);
  const circuitSheets = drawing.sheets.filter((sheet) => !sheet.hierarchicalSymbol);
  for (const sheet of [...interfaceSheets, ...circuitSheets]) {
    if (sheet.kind === 'simulation') continue;
    if (sheetNames.has(sheet.name)) {
      issues.push({
        code: 'sheet-name',
        sheetId: sheet.id,
        detail: `Duplicate schematic sheet name ${sheet.name}.`,
      });
    }
    sheetNames.add(sheet.name);
    if (sheet.hierarchicalSymbol) {
      issues.push({
        code: 'hierarchy',
        sheetId: sheet.id,
        detail: 'Hierarchical symbol ports need explicit instance expansion.',
      });
      continue;
    }
    for (const item of sheet.items) {
      const location = { sheetId: sheet.id, itemId: item._id };
      switch (item.NodeName) {
        case DocItemTypes.BusLabel:
        case DocItemTypes.BusSlash:
        case DocItemTypes.BusWire:
          issues.push({
            ...location,
            code: 'bus',
            detail:
              'Bus members need explicit expansion into scalar terminals.',
          });
          break;
        case DocItemTypes.Symbol: {
          if (item.hierarchy) {
            issues.push({ ...location, code: 'hierarchy', detail: 'Child placement needs instance-aware connectivity.' });
            break;
          }
          const unitId = item.unitId?.toLowerCase();
          if (!isEntityId(unitId) || unitIds.has(unitId)) {
            issues.push({
              ...location,
              code: 'unit-id',
              detail: 'The placed unit needs a unique UUID.',
            });
          }
          if (unitId) unitIds.add(unitId);
          const reference = item.text
            .find((field) => field.description === 'Ref')
            ?.value?.trim();
          if (
            !reference ||
            reference.includes('?') ||
            referenceNames.has(reference.toLowerCase())
          ) {
            issues.push({
              ...location,
              code: 'reference',
              detail: `Unresolved or shared reference ${
                reference || '(blank)'
              }.`,
            });
          }
          if (reference) referenceNames.add(reference.toLowerCase());
          if (item._symbol.parts > 1) {
            issues.push({
              ...location,
              code: 'multipart',
              detail:
                'Multipart units need a reviewed physical component binding.',
            });
          }
          const outlines = item._symbol.outlines;
          const outline = outlines[item._symbol.heterogeneous ? item.part : 0];
          const pinIds = outline?.active_points.map((entry) =>
            entry.pin.pinId?.toLowerCase(),
          );
          if (
            !pinIds ||
            !pinIds.every(isEntityId) ||
            new Set(pinIds).size !== pinIds.length
          ) {
            issues.push({
              ...location,
              code: 'pin-id',
              detail: 'The selected outline needs distinct pin UUIDs.',
            });
          }
          break;
        }
      }
    }
  }
  return issues;
}
