import type { BoardDocument } from './board';
import { BOARD_COORDINATE_LIMIT_NM, samePoint } from './geometry';
import type { BoardDrill } from './copper';
import type { RouteRules } from './routing';

export interface FabricationLimits extends RouteRules {
  readonly minViaDrillNm: number;
  readonly minPlatedDrillNm: number;
  readonly minNonPlatedDrillNm: number;
  readonly minPlatedSlotNm: number;
  readonly minNonPlatedSlotNm: number;
  readonly minOutlineWebNm: number;
  readonly minPlatedSlotRatio: number;
  readonly minViaGapNm: number;
  readonly minHoleGapNm: number;
  readonly minPadAnnulusNm: number;
  readonly minMaskExpansionNm: number;
  readonly minMaskWebNm: number;
  readonly minPasteApertureNm: number;
  readonly minPasteLandCoveragePermille: number;
  readonly minSilkStrokeNm: number;
  readonly minSilkTextHeightNm: number;
  readonly minSilkMaskGapNm: number;
  readonly minSilkEdgeGapNm: number;
}

interface FabricationProfile {
  readonly title: string;
  readonly revision: string;
  readonly process: string;
  readonly source: string;
  readonly reviewed: string;
  readonly layerCounts: readonly number[];
  readonly thicknessesNm: readonly number[];
  readonly limits: FabricationLimits;
}

const classroom: FabricationLimits = {
  minWidthNm: 250_000,
  clearanceNm: 250_000,
  edgeClearanceNm: 300_000,
  minViaAnnulusNm: 150_000,
  minViaDrillNm: 300_000,
  minPlatedDrillNm: 600_000,
  minNonPlatedDrillNm: 600_000,
  minPlatedSlotNm: 600_000,
  minNonPlatedSlotNm: 1_000_000,
  minOutlineWebNm: 1_000_000,
  minPlatedSlotRatio: 2,
  minViaGapNm: 250_000,
  minHoleGapNm: 450_000,
  minPadAnnulusNm: 250_000,
  minMaskExpansionNm: 0,
  minMaskWebNm: 130_000,
  minPasteApertureNm: 250_000,
  minPasteLandCoveragePermille: 500,
  minSilkStrokeNm: 150_000,
  minSilkTextHeightNm: 1_000_000,
  minSilkMaskGapNm: 150_000,
  minSilkEdgeGapNm: 200_000,
};

// Once shipped, assign a new profile ID when its limits change. Boards save this key.
export const fabricationProfiles = {
  'classroom-v1': {
    title: 'Generic classroom prototype',
    revision: '4',
    process: 'One or two layers · FR-4 · 1 oz outer copper · green mask',
    source: 'https://jlcpcb.com/capabilities/Capabilities',
    reviewed: '2026-11-21',
    layerCounts: [1, 2],
    thicknessesNm: [1_600_000],
    limits: classroom,
  },
  'two-layer-smt-v1': {
    title: 'Generic two-layer SMT',
    revision: '4',
    process: 'Two layers · FR-4 · 1 oz outer copper · green mask',
    source: 'https://jlcpcb.com/capabilities/Capabilities',
    reviewed: '2026-11-21',
    layerCounts: [2],
    thicknessesNm: [1_000_000, 1_200_000, 1_600_000, 2_000_000],
    limits: {
      ...classroom,
      minWidthNm: 180_000,
      clearanceNm: 200_000,
      edgeClearanceNm: 250_000,
      minViaAnnulusNm: 130_000,
      minViaDrillNm: 250_000,
      minPlatedDrillNm: 500_000,
      minNonPlatedDrillNm: 500_000,
      minPlatedSlotNm: 500_000,
      minViaGapNm: 200_000,
      minPadAnnulusNm: 180_000,
      minMaskWebNm: 100_000,
    },
  },
} as const satisfies Readonly<Record<string, FabricationProfile>>;

export type FabricationProfileId = keyof typeof fabricationProfiles;

export interface BoardStackup {
  readonly substrateMaterial?: string;
  readonly dielectricThicknessNm?: number;
  readonly relativePermittivity?: number;
  readonly lossTangent?: number;
  readonly topCopperThicknessNm?: number;
  readonly bottomCopperThicknessNm?: number;
}

export interface BoardFabrication {
  readonly profileId?: FabricationProfileId;
  readonly thicknessNm: number;
  readonly stackup?: BoardStackup;
  readonly surfaceFinish?: string;
  readonly thicknessToleranceNm?: number;
  readonly outlineToleranceNm?: number;
  readonly platedOpeningToleranceNm?: number;
  readonly nonPlatedOpeningToleranceNm?: number;
  readonly notes?: string;
}

export const fabricationToleranceFields = [
  ['thicknessToleranceNm', 'Board thickness tolerance'],
  ['outlineToleranceNm', 'Outline and cutout tolerance'],
  ['platedOpeningToleranceNm', 'Finished plated hole and slot tolerance'],
  ['nonPlatedOpeningToleranceNm', 'Finished non-plated hole and slot tolerance'],
] as const;

export const fabricationFinishLimit = 80;
export const fabricationNotesLimit = 1024;

export const stackupThicknessFields = [
  ['dielectricThicknessNm', 'Dielectric thickness'],
  ['topCopperThicknessNm', 'Top copper thickness'],
  ['bottomCopperThicknessNm', 'Bottom copper thickness'],
] as const;

export const stackupMaterialLimit = 80;

function validateStackup(board: BoardDocument, fabrication: BoardFabrication) {
  const { stackup, thicknessNm } = fabrication;
  if (stackup === undefined) return;
  if (!stackup || typeof stackup !== 'object' || Array.isArray(stackup))
    throw new Error('Invalid PCB stackup.');
  const { substrateMaterial, relativePermittivity, lossTangent, bottomCopperThicknessNm } = stackup;
  if (substrateMaterial !== undefined &&
      (typeof substrateMaterial !== 'string' || !substrateMaterial.trim() ||
        substrateMaterial.length > stackupMaterialLimit || /[\u0000-\u001f\u007f]/.test(substrateMaterial)))
    throw new Error('Enter a valid substrate material.');
  if ((relativePermittivity !== undefined &&
      (!Number.isFinite(relativePermittivity) || relativePermittivity < 1)) ||
      (lossTangent !== undefined && (!Number.isFinite(lossTangent) || lossTangent < 0)))
    throw new Error('Relative permittivity must be at least 1 and loss tangent must be non-negative.');
  if (bottomCopperThicknessNm !== undefined && board.copperLayers.length < 2)
    throw new Error('Clear the bottom copper thickness before removing the bottom copper layer.');
  const thicknesses = stackupThicknessFields.flatMap(([key]) =>
    stackup[key] === undefined ? [] : [stackup[key]]);
  if (thicknesses.some((value) => !Number.isSafeInteger(value) || value < 1))
    throw new Error('Stackup layer thicknesses must be positive whole nanometres.');
  if (thicknesses.reduce((total, value) => total + value, 0) > thicknessNm)
    throw new Error('Known stackup layer thicknesses exceed the board thickness.');
}

export function validateBoardFabrication(board: BoardDocument) {
  const config = board.fabrication;
  if (
    (config !== undefined) !==
    board.requiredFeatures.includes('fabrication-settings')
  )
    throw new Error('Fabrication settings need a declared board feature.');
  if (config === undefined) return;
  if (
    !config ||
    !Number.isSafeInteger(config.thicknessNm) ||
    config.thicknessNm < 100_000 ||
    config.thicknessNm > BOARD_COORDINATE_LIMIT_NM ||
    (config.profileId !== undefined &&
      !Object.hasOwn(fabricationProfiles, config.profileId))
  )
    throw new Error('Invalid board thickness or fabrication profile.');
  validateStackup(board, config);
  if (fabricationToleranceFields.some(([key]) => {
    const value = config[key];
    return value !== undefined && (!Number.isSafeInteger(value) || value < 1 ||
      value > BOARD_COORDINATE_LIMIT_NM);
  }) || (config.thicknessToleranceNm !== undefined &&
    config.thicknessToleranceNm >= config.thicknessNm))
    throw new Error('Enter positive fabrication tolerances, with thickness tolerance smaller than board thickness.');
  if ((config.surfaceFinish !== undefined &&
    (typeof config.surfaceFinish !== 'string' || !config.surfaceFinish.trim() ||
      config.surfaceFinish.length > fabricationFinishLimit ||
      /[\u0000-\u001f\u007f]/.test(config.surfaceFinish))) ||
    (config.notes !== undefined &&
      (typeof config.notes !== 'string' || !config.notes.trim() ||
        config.notes.length > fabricationNotesLimit ||
        /[\u0000-\u0009\u000b-\u001f\u007f]/.test(config.notes))))
    throw new Error('Invalid fabrication finish or notes.');
}

export function fabricationProfileFor(
  board: BoardDocument,
): FabricationProfile | undefined {
  return board.fabrication?.profileId
    ? fabricationProfiles[board.fabrication.profileId]
    : undefined;
}

export function drillWidthLimit(drill: BoardDrill, via: boolean) {
  if (!samePoint(drill.start, drill.end))
    return drill.plated ? 'minPlatedSlotNm' : 'minNonPlatedSlotNm';
  if (via) return 'minViaDrillNm';
  return drill.plated ? 'minPlatedDrillNm' : 'minNonPlatedDrillNm';
}

export function drillWidthMinimum(limits: FabricationLimits, drill: BoardDrill, via: boolean) {
  return limits[drillWidthLimit(drill, via)];
}
