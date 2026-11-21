import type { BoardDocument } from './board';
import { isEntityId } from '../model/schematicIdentity';

export type WaivableCheck = 'floating-copper' | 'island';

export interface BoardWaiver {
  readonly id: string;
  readonly code: WaivableCheck;
  readonly fingerprint: string;
  readonly reason: string;
}

export function validateBoardWaivers(board: BoardDocument) {
  const { waivers } = board;
  if (
    (waivers !== undefined) !==
    board.requiredFeatures.includes('check-waivers')
  )
    throw new Error('PCB waivers must declare the check-waivers feature.');
  if (waivers === undefined) return;
  if (!Array.isArray(waivers) || waivers.length > 2048)
    throw new Error('Invalid PCB waiver collection.');
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const waiver of waivers) {
    if (
      !isEntityId(waiver?.id) ||
      ids.has(waiver.id.toLowerCase()) ||
      !['floating-copper', 'island'].includes(waiver.code) ||
      typeof waiver.fingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(waiver.fingerprint) ||
      fingerprints.has(waiver.fingerprint) ||
      typeof waiver.reason !== 'string' ||
      !waiver.reason.trim() ||
      waiver.reason.length > 2048
    )
      throw new Error('Invalid or duplicate check waiver.');
    ids.add(waiver.id.toLowerCase());
    fingerprints.add(waiver.fingerprint);
  }
}
