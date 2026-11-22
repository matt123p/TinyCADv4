import React, { useMemo, useState } from 'react';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import { boardArtwork } from '../../pcb/boardArtwork';
import type { boardCopperGeometry } from '../../pcb/boardCopperGeometry';
import type { PolygonRegion } from '../../pcb/contours';
import { profileRegion } from '../../pcb/contours';
import { artworkGap, coveredMaskMargin, pasteFitsMinimum, pasteLandCoverage } from '../../pcb/fabricationArtwork';
import { fabricationProfileFor } from '../../pcb/fabricationProfiles';
import type { PolygonKernel } from '../../pcb/polygonKernel';
import { boundaryDistance } from '../../pcb/regionDistances';

const mm = (value: number) => `${value / 1_000_000} mm`;

interface InspectionArt {
  id: string;
  kind: 'mask' | 'paste' | 'legend' | 'courtyard';
  side: CopperLayer['id'];
  regions: readonly PolygonRegion[];
  landId?: string;
  strokeNm?: number;
  textHeightNm?: number;
  componentId?: string;
}

function compatible(first: InspectionArt, second: InspectionArt) {
  if (first.id === second.id || first.side !== second.side) return false;
  if (first.kind === 'courtyard') return second.kind === 'courtyard' && first.componentId !== second.componentId;
  if (first.kind === 'legend') return second.kind === 'mask';
  return first.kind === 'mask' && (second.kind === 'mask' || second.kind === 'legend');
}

export default function BoardArtworkRuleInspection({ board, geometry, kernel, kernelError }: {
  board: BoardDocument;
  geometry: ReturnType<typeof boardCopperGeometry>;
  kernel?: PolygonKernel;
  kernelError: string;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [compareId, setCompareId] = useState('');
  const artwork = useMemo(() => kernel && boardArtwork(board, kernel), [board, kernel]);
  const objects = useMemo<InspectionArt[]>(() => [
    ...geometry.apertures.map(({ id, kind, side, landId, polygon }): InspectionArt => ({
      id, kind, side, landId, regions: [{ outer: polygon, holes: [] }],
    })),
    ...(artwork?.silk.map((item): InspectionArt => ({ ...item, kind: 'legend' })) ?? []),
    ...(artwork?.courtyards.map((item): InspectionArt => ({ ...item, kind: 'courtyard' })) ?? []),
  ], [geometry, artwork]);
  const selected = objects.find(({ id }) => id === selectedId) ?? objects[0];
  const other = selected && objects.find((item) => item.id === compareId && compatible(selected, item));
  const profile = fabricationProfileFor(board);
  const limits = profile?.limits;
  const outline = board.profile ? profileRegion(board.profile) : { outer: board.outline, holes: [] };
  const land = selected?.landId && geometry.features.find(({ id }) => id === selected.landId);
  const edgeLimit = selected?.kind === 'legend' ? limits?.minSilkEdgeGapNm ?? 0 : 0;
  const crossesProfile = selected && kernel && kernel.boolean('difference', selected.regions, [outline]).length > 0;
  const violatesEdge = selected && kernel && (edgeLimit
    ? kernel.boolean('difference', selected.regions, kernel.offset([outline], -edgeLimit)).length > 0
    : crossesProfile);
  const edgeGap = selected && kernel && (crossesProfile ? 0 : Math.min(
    ...selected.regions.map((region) => boundaryDistance(region, outline))));
  const label = ({ kind, side }: InspectionArt, index: number) => {
    const name = { mask: 'Mask opening', paste: 'Paste aperture', legend: 'Legend', courtyard: 'Courtyard' }[kind];
    return `${name} ${index + 1} · ${side}`;
  };

  function comparison() {
    if (!other || !selected) return null;
    if (selected.kind === 'courtyard') {
      if (!kernel) return null;
      const overlap = selected.regions.some((first) => other.regions.some((second) =>
        kernel.boolean('intersection', [first], [second]).length));
      return <p>Courtyard overlap (<code>courtyard-overlap</code>). {overlap ? 'Courtyards overlap.' : 'No overlapping area.'}</p>;
    }
    let gap = Infinity;
    let touching = false;
    for (const first of selected.regions) {
      for (const second of other.regions) {
        const measurement = artworkGap(first, second);
        gap = Math.min(gap, measurement.measuredNm);
        touching ||= measurement.touching;
      }
    }
    const key = selected.kind === 'legend' || other.kind === 'legend' ? 'minSilkMaskGapNm' : 'minMaskWebNm';
    const min = limits?.[key] ?? (key === 'minSilkMaskGapNm' ? 0 : undefined);
    return <p>{key === 'minSilkMaskGapNm' ? 'Legend to mask clearance' : 'Mask web'} measured {mm(gap)}
      {min !== undefined && <>, required {mm(min)} (<code>{key}</code>)</>}.
      {key === 'minSilkMaskGapNm' && touching && ' Legend touches the mask opening.'}
    </p>;
  }

  return (
    <div className="pcb-profile-fields">
      {!kernel && !kernelError && <p role="status">Preparing placed artwork…</p>}
      {kernelError && <p role="alert">Placed artwork measurements are unavailable. {kernelError}</p>}
      {selected ? <>
        <label>
          Artwork object
          <select aria-label="Artwork object" value={selected.id} onChange={(event) => {
            setSelectedId(event.target.value);
            setCompareId('');
          }}>
            {objects.map((item, index) => <option key={item.id} value={item.id}>{label(item, index)}</option>)}
          </select>
        </label>
        {selected.kind !== 'paste' && (
          <label>
            Compare artwork
            <select aria-label="Compare artwork" value={other?.id ?? ''} onChange={(event) => setCompareId(event.target.value)}>
              <option value="">No comparison</option>
              {objects.map((item, index) => compatible(selected, item) &&
                <option key={item.id} value={item.id}>{label(item, index)}</option>)}
            </select>
          </label>
        )}
        {profile ? <p>Fabrication profile {profile.title} <code>{board.fabrication.profileId}</code>, revision {profile.revision}.</p>
          : <p>Select a fabrication profile to see its artwork limits.</p>}
        {kernel && <p>Board edge clearance measured {mm(edgeGap)}, required {mm(edgeLimit)}
          {' '}(<code>{selected.kind === 'legend' ? 'minSilkEdgeGapNm' : selected.kind === 'courtyard'
            ? 'courtyard-edge' : 'fabrication-aperture-edge'}</code>).
          {' '}{violatesEdge ? 'Artwork crosses the required edge boundary.' : 'Artwork is within the required edge boundary.'}</p>}
        {selected.kind === 'legend' && selected.strokeNm > 0 && (
          <p>Legend stroke measured {mm(selected.strokeNm)}
            {limits && <>, required {mm(limits.minSilkStrokeNm)} (<code>minSilkStrokeNm</code>)</>}.</p>
        )}
        {selected.kind === 'legend' && selected.textHeightNm !== undefined && (
          <p>Legend text height measured {mm(selected.textHeightNm)}
            {limits && <>, required {mm(limits.minSilkTextHeightNm)} (<code>minSilkTextHeightNm</code>)</>}.</p>
        )}
        {selected.kind === 'mask' && land && limits && kernel && (
          <p>Opening margin required {mm(limits.minMaskExpansionNm)} (<code>minMaskExpansionNm</code>).
            {' '}{coveredMaskMargin(selected.regions[0], land.region, limits.minMaskExpansionNm, kernel).length
              ? 'Solder mask covers part of the land or its required margin.'
              : 'The aperture contains the land and required margin.'}</p>
        )}
        {selected.kind === 'paste' && kernel && <>
          {land ? <p>Paste land coverage measured {pasteLandCoverage(selected.regions[0], land.region, kernel) / 10}%
            {limits && <>, required {limits.minPasteLandCoveragePermille / 10}% (<code>minPasteLandCoveragePermille</code>)</>}.</p>
            : <p>Paste aperture has no associated copper land on this side.</p>}
          {limits && <p>Minimum paste opening {mm(limits.minPasteApertureNm)} (<code>minPasteApertureNm</code>).
            {' '}{pasteFitsMinimum(selected.regions[0], limits.minPasteApertureNm, kernel)
              ? 'The minimum opening fits.' : 'The minimum opening does not fit.'}</p>}
        </>}
        {comparison()}
      </> : kernel && <p>Place a footprint or via with board artwork to inspect it.</p>}
      {!!artwork?.issues.length && <p>Some artwork could not be plotted. Run design checks to locate it.</p>}
    </div>
  );
}
