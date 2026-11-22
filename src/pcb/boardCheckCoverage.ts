import type { BoardFinding, CheckResult } from './boardFindings';

const checkNames = {
  copper: 'Copper clearance, edges, track width and via ring',
  openings: 'Drills and slots',
  parity: 'Schematic parity',
  maskPaste: 'Mask and paste',
  artwork: 'Silkscreen and courtyard',
  placement: 'Placement keep-in and keep-out areas',
  devices: 'Component placement and device mapping',
  zones: 'Thermal and zone integrity',
  connectivity: 'Physical connectivity',
  profile: 'Fabrication profile applicability',
  outline: 'Routed outline and cutouts',
} as const;

type Check = keyof typeof checkNames;

export interface CheckCoverage {
  readonly check: (typeof checkNames)[Check];
  readonly status: 'checked' | 'limited' | 'unavailable' | 'not applicable';
  readonly detail?: string;
}

function groupFor(code: string): Check {
  if (/^(drill-|mounting-screw-copper$|fabrication-(drill-|slot-|hole-|pad-annulus))/.test(code)) return 'openings';
  if (/^(fabrication-(mask-|paste-|aperture-))/.test(code)) return 'maskPaste';
  if (/^(courtyard-|silk-)/.test(code)) return 'artwork';
  if (/^placement-/.test(code)) return 'placement';
  if (/^(thermal-|zone-)|^(missing-net|island|equal-priority)$/.test(code)) return 'zones';
  if (/^schematic-|(-divergence)$|^(missing-component|duplicate-component|unexpected-component|unexpected-signal)$/.test(code))
    return 'parity';
  if (/^(unplaced|duplicate-reference|unmapped-signals)$/.test(code)) return 'devices';
  if (/^(short|open|bare-open-bridged|copper-point-contact|missing-terminal|floating-copper|jumper-net)$/.test(code))
    return 'connectivity';
  if (code.startsWith('fabrication-outline-')) return 'outline';
  if (code === 'fabrication-applicability') return 'profile';
  return 'copper';
}

export function checkCoverageResults(
  coverage: readonly CheckCoverage[],
  findings: readonly BoardFinding[],
  hasProfile: boolean,
) {
  const outcomes = new Map<string, Set<CheckResult>>();
  for (const { code, result } of findings) {
    const check = checkNames[groupFor(code)];
    const results = outcomes.get(check) ?? new Set<CheckResult>();
    results.add(result);
    outcomes.set(check, results);
  }
  const entries: CheckCoverage[] = [
    ...coverage,
    { check: checkNames.devices, status: 'checked' },
    { check: checkNames.profile, status: hasProfile ? 'checked' : 'unavailable' },
  ];
  return entries.map((entry) => {
    const results = outcomes.get(entry.check);
    const result: CheckResult = results?.has('stale') ? 'stale'
      : results?.has('failed') ? 'failed'
      : entry.status === 'not applicable' ? 'not-applicable'
      : entry.status !== 'checked' || results?.has('not-run') ? 'not-run'
      : results?.has('waived') ? 'waived'
      : 'passed';
    return { ...entry, result };
  });
}
