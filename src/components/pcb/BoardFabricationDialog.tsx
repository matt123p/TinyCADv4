import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import type { BoardDocument, BoardOperation } from '../../pcb/board';
import { resolveBoardRules, starterRoutingRules } from '../../pcb/boardRules';
import {
  fabricationFinishLimit, fabricationNotesLimit, fabricationProfiles, fabricationToleranceFields,
  stackupMaterialLimit, stackupThicknessFields,
} from '../../pcb/fabricationProfiles';
import type { BoardStackup, FabricationProfileId } from '../../pcb/fabricationProfiles';
import { boardInputLength } from './boardNumberInput';

const mm = (nm: number) => String(nm / 1e6);
const dimensions = [
  ['minWidthNm', 'Minimum track width'],
  ['clearanceNm', 'Copper clearance'],
  ['edgeClearanceNm', 'Copper to edge'],
  ['minViaAnnulusNm', 'Minimum via annular ring'],
] as const;
const optionalWidths = [
  ['preferredWidthNm', 'Preferred track width'],
  ['maxWidthNm', 'Maximum track width'],
] as const;
const dielectricProperties = [
  ['relativePermittivity', 'Relative permittivity'],
  ['lossTangent', 'Dielectric loss tangent'],
] as const;

function readStackup(form: FormData, previous?: BoardStackup): BoardStackup | undefined {
  const optional = (id: string) => String(form.get(id) ?? '').trim().replace(',', '.');
  const stackup = {
    ...previous,
    substrateMaterial: String(form.get('substrateMaterial') ?? '').trim() || undefined,
    ...Object.fromEntries(stackupThicknessFields.map(([id]) => {
      const value = optional(id);
      return [id, value ? boardInputLength(value, 'mm') : undefined];
    })),
    ...Object.fromEntries(dielectricProperties.map(([id, label]) => {
      const value = optional(id);
      if (value && !/^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
        throw new Error(label + ' must be a decimal number.');
      return [id, value ? Number(value) : undefined];
    })),
  };
  const entries = Object.entries(stackup).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
const advancedLimits = [
  ['minViaDrillNm', 'Via drill'],
  ['minPlatedDrillNm', 'Plated hole'],
  ['minNonPlatedDrillNm', 'Non-plated hole'],
  ['minPlatedSlotNm', 'Plated slot'],
  ['minNonPlatedSlotNm', 'Non-plated slot and routed opening'],
  ['minOutlineWebNm', 'Board material web'],
  ['minViaGapNm', 'Via-to-via gap'],
  ['minHoleGapNm', 'Other drill gap'],
  ['minPadAnnulusNm', 'Plated pad ring'],
  ['minMaskExpansionNm', 'Minimum solder-mask expansion'],
  ['minMaskWebNm', 'Solder-mask web'],
  ['minPasteApertureNm', 'Paste aperture'],
  ['minSilkStrokeNm', 'Silkscreen stroke'],
  ['minSilkTextHeightNm', 'Silkscreen text height'],
  ['minSilkMaskGapNm', 'Silkscreen to mask opening'],
  ['minSilkEdgeGapNm', 'Silkscreen to board edge'],
] as const;

export default function BoardFabricationDialog({
  board,
  advanced = true,
  onClose,
  onApply,
}: {
  board: BoardDocument;
  advanced?: boolean;
  onClose(): void;
  onApply(operations: readonly BoardOperation[]): void;
}) {
  const [profileId, setProfileId] = useState<FabricationProfileId | ''>(
    board.fabrication?.profileId ?? '',
  );
  const [error, setError] = useState('');
  const profile = profileId ? fabricationProfiles[profileId] : undefined;
  const savedStackup = board.fabrication?.stackup;
  const stored = board.rules ?? starterRoutingRules;
  const effective = resolveBoardRules({
    ...board,
    fabrication: {
      thicknessNm: board.fabrication?.thicknessNm ?? 1_600_000,
      ...(profileId ? { profileId } : {}),
    },
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const measure = (name: string) =>
      boardInputLength(String(form.get(name)), 'mm');
    try {
      const surfaceFinish = String(form.get('surfaceFinish') ?? '').trim();
      const notes = String(form.get('notes') ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').trim();
      const stackup = advanced ? readStackup(form, savedStackup) : savedStackup;
      onApply([
        {
          type: 'setFabrication',
          fabrication: {
            thicknessNm: measure('thickness'),
            ...(profileId ? { profileId } : {}),
            ...(stackup ? { stackup } : {}),
            ...(surfaceFinish ? { surfaceFinish } : {}),
            ...(notes ? { notes } : {}),
            ...Object.fromEntries(fabricationToleranceFields.flatMap(([id]) =>
              String(form.get(id)).trim() ? [[id, measure(id)]] : [],
            )),
          },
        },
        ...(advanced
          ? [
              {
                type: 'setRules' as const,
                rules: {
                  minWidthNm: measure('minWidthNm'),
                  clearanceNm: measure('clearanceNm'),
                  edgeClearanceNm: measure('edgeClearanceNm'),
                  minViaAnnulusNm: measure('minViaAnnulusNm'),
                  ...Object.fromEntries(optionalWidths.flatMap(([id]) =>
                    String(form.get(id)).trim() ? [[id, measure(id)]] : [],
                  )),
                },
              },
            ]
          : []),
      ]);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>Fabrication settings</DialogTitle>
            <DialogContent className="pcb-profile-fields">
              <label>
                Fabrication profile
                <select
                  value={profileId}
                  onChange={(event) =>
                    setProfileId(event.target.value as typeof profileId)
                  }
                >
                  <option value="">Board rules only</option>
                  {Object.entries(fabricationProfiles).map(([id, option]) => (
                    <option key={id} value={id}>
                      {option.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Board thickness (mm)
                <input
                  name="thickness"
                  required
                  defaultValue={mm(board.fabrication?.thicknessNm ?? 1_600_000)}
                />
              </label>
              {advanced && (
                <details>
                  <summary>Board stackup</summary>
                  <p>Leave unknown values blank.</p>
                  <label>
                    Substrate material
                    <input name="substrateMaterial" maxLength={stackupMaterialLimit}
                      defaultValue={savedStackup?.substrateMaterial} />
                  </label>
                  {stackupThicknessFields.map(([id, label]) =>
                    (id !== 'bottomCopperThicknessNm' || board.copperLayers.length === 2) && (
                      <label key={id}>
                        {label} (mm)
                        <input name={id} inputMode="decimal"
                          defaultValue={savedStackup?.[id] === undefined ? '' : mm(savedStackup[id])} />
                      </label>
                    ))}
                  {dielectricProperties.map(([id, label]) => (
                    <label key={id}>
                      {label}
                      <input name={id} inputMode="decimal" defaultValue={savedStackup?.[id]} />
                    </label>
                  ))}
                </details>
              )}
              <details>
                <summary>Fabrication drawing details</summary>
                <label>
                  Surface finish
                  <input name="surfaceFinish" maxLength={fabricationFinishLimit}
                    defaultValue={board.fabrication?.surfaceFinish} />
                </label>
                {fabricationToleranceFields.map(([id, name]) => (
                  <label key={id}>
                    {name} (± mm)
                    <input name={id} defaultValue={board.fabrication?.[id] === undefined ? '' : mm(board.fabrication[id])} />
                  </label>
                ))}
                <label>
                  Fabrication notes
                  <textarea name="notes" maxLength={fabricationNotesLimit} defaultValue={board.fabrication?.notes} />
                </label>
              </details>
              {advanced &&
                dimensions.map(([id, name]) => (
                  <label key={id}>
                    {name} (mm)
                    <input
                      name={id}
                      required
                      defaultValue={mm(stored[id])}
                      aria-describedby={
                        profile ? 'profile-minimum-' + id : undefined
                      }
                    />
                    {profile && (
                      <span id={'profile-minimum-' + id}>
                        Profile minimum {mm(profile.limits[id])} mm. Using{' '}
                        {mm(effective[id])} mm with saved board rules.
                      </span>
                    )}
                  </label>
                ))}
              {advanced && optionalWidths.map(([id, name]) => (
                <label key={id}>
                  {name} (mm)
                  <input name={id} defaultValue={stored[id] === undefined ? '' : mm(stored[id])} />
                </label>
              ))}
              {profile && (
                <>
                  <p>
                    {profile.process}. Confirm this design starting point with
                    the selected fabricator.{' '}
                    <a href={profile.source} target="_blank" rel="noreferrer">
                      Reference reviewed {profile.reviewed}
                    </a>
                  </p>
                  {advanced && (
                    <details>
                      <summary>Fabrication limits</summary>
                      <dl>
                        {advancedLimits.map(([id, name]) => (
                          <React.Fragment key={id}>
                            <dt>{name}</dt>
                            <dd>{mm(profile.limits[id])} mm</dd>
                          </React.Fragment>
                        ))}
                        <dt>Minimum paste coverage of copper land</dt>
                        <dd>{profile.limits.minPasteLandCoveragePermille / 10}%</dd>
                      </dl>
                    </details>
                  )}
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button appearance="primary" type="submit">
                Apply
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
