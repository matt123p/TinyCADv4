import React, { useState } from 'react';
import type { BoardDocument } from '../../pcb/board';
import type { boardCopperGeometry } from '../../pcb/boardCopperGeometry';
import { boardRuleResolver } from '../../pcb/boardRules';
import { profileRegion } from '../../pcb/contours';
import { openingRegion, regionsTouch } from '../../pcb/copper';
import type { BoardDrill, CopperFeature } from '../../pcb/copper';
import { drillWidthLimit, fabricationProfileFor } from '../../pcb/fabricationProfiles';
import { openingCopperClearance, openingSpacingLimit, padAnnulusProbe, platedSlotLength } from '../../pcb/fabricationOpenings';
import { samePoint } from '../../pcb/geometry';
import type { PolygonKernel } from '../../pcb/polygonKernel';
import { boundaryDistance, drillGapNm } from '../../pcb/regionDistances';

const mm = (value: number) => `${value / 1_000_000} mm`;

function openingLabel(opening: BoardDrill, via: boolean, index: number) {
  const kind = via ? 'Via drill' : `${opening.plated ? 'Plated' : 'Non-plated'} ${samePoint(opening.start, opening.end) ? 'hole' : 'slot'}`;
  return `${kind} ${index + 1} · X ${mm(opening.start.x)}, Y ${mm(opening.start.y)}`;
}

export default function BoardOpeningRuleInspection({ board, geometry, copper, copperLabels, kernel, kernelError }: {
  board: BoardDocument;
  geometry: ReturnType<typeof boardCopperGeometry>;
  copper: readonly CopperFeature[];
  copperLabels: readonly string[];
  kernel?: PolygonKernel;
  kernelError: string;
}) {
  const [index, setIndex] = useState(0);
  const [comparison, setComparison] = useState('');
  const opening = geometry.drills[index];
  const other = comparison.startsWith('opening:') ? geometry.drills[Number(comparison.slice(8))] : undefined;
  const otherCopper = comparison.startsWith('copper:') ? copper[Number(comparison.slice(7))] : undefined;
  if (!opening) return <p>Add a drilled opening to inspect it.</p>;

  const profile = fabricationProfileFor(board);
  const limits = profile?.limits;
  const vias = new Map(board.vias?.map((via) => [via.id, via]));
  const via = vias.get(opening.id);
  const widthRule = drillWidthLimit(opening, !!via);
  const slot = limits && platedSlotLength(opening, limits);
  const region = openingRegion(opening);
  const outline = board.profile ? profileRegion(board.profile) : { outer: board.outline, holes: [] };
  const crossesOutline = kernel && kernel.boolean('difference', [region], [outline]).length > 0;
  const edgeDistance = kernel && (crossesOutline ? 0 : boundaryDistance(region, outline));
  const spacingRule = openingSpacingLimit(!!via && !!other && vias.has(other.id));
  const spacing = other && drillGapNm(opening, other);
  const resolver = boardRuleResolver(board);
  const mounting = board.mechanicalHoles?.find(({ id }) => id === opening.id)?.clearanceNm ?? 0;
  const minCopper = otherCopper && openingCopperClearance(board, opening, geometry.features, mounting, resolver.clearance)(otherCopper);
  const measuredCopper = otherCopper && (regionsTouch(region, otherCopper.region) ? 0 : boundaryDistance(region, otherCopper.region));
  const overlap = other && regionsTouch(region, openingRegion(other));
  const padAnnulus = opening.plated && !via && limits && kernel
    ? padAnnulusProbe(opening, limits.minPadAnnulusNm, kernel)
    : undefined;
  const viaRules = via && resolver.net(via.netId);

  return (
    <div className="pcb-profile-fields">
      <label>
        Opening
        <select aria-label="Opening" value={index} onChange={(event) => {
          const next = Number(event.target.value);
          setIndex(next);
          if (comparison === 'opening:' + next) setComparison('');
        }}>
          {geometry.drills.map((item, i) => <option key={item.id} value={i}>
            {openingLabel(item, vias.has(item.id), i)}
          </option>)}
        </select>
      </label>
      <label>
        Compare with
        <select aria-label="Compare openings" value={comparison}
          onChange={(event) => setComparison(event.target.value)}>
          <option value="">No comparison</option>
          <optgroup label="Openings">
            {geometry.drills.map((item, i) => i !== index && (
              <option key={item.id} value={'opening:' + i}>{openingLabel(item, vias.has(item.id), i)}</option>
            ))}
          </optgroup>
          {copper.length > 0 && <optgroup label="Copper">
            {copperLabels.map((label, i) => <option key={copper[i].id} value={'copper:' + i}>{label}</option>)}
          </optgroup>}
        </select>
      </label>
      {profile ? (
        <p>Fabrication profile {profile.title} <code>{board.fabrication.profileId}</code>, revision {profile.revision}.</p>
      ) : <p>Select a fabrication profile to see its opening width, spacing and annulus limits.</p>}
      <p>Opening width measured {mm(opening.widthNm)}
        {limits && <>, required {mm(limits[widthRule])} (<code>{widthRule}</code>)</>}.</p>
      {slot && <p>Finished slot length measured {mm(Math.round(slot.measuredNm))}, required {mm(slot.requiredNm)}
        {' '}(<code>minPlatedSlotRatio</code>).</p>}
      {kernel && (
        <p>Board edge clearance measured {mm(edgeDistance)}, required containment
          {' '}(<code>drill-outside</code>). {crossesOutline ? 'Opening crosses the board profile.' : 'Opening is contained.'}</p>
      )}
      {viaRules && <p>Via annulus measured {mm((via.diameterNm - via.drillNm) / 2)}, required {mm(viaRules.minViaAnnulusNm)}
        {' '}(<code>minViaAnnulusNm</code>).</p>}
      {padAnnulus && (
        <ul aria-label="Plated pad annulus">
          {board.copperLayers.map(({ id: layer }) => {
            const land = geometry.features.find(({ id }) => id === opening.id + ':' + layer);
            return <li key={layer}>{layer} annulus measured {mm(padAnnulus.measuredNm(land?.region))},
              {' '}required {mm(limits.minPadAnnulusNm)} (<code>minPadAnnulusNm</code>).
              {' '}{land ? padAnnulus.passes(land.region) ? 'Passes.' : 'Below minimum.' : 'Copper land missing.'}
            </li>;
          })}
        </ul>
      )}
      {spacing !== undefined && (
        <p>Opening spacing measured {mm(Math.round(spacing))}
          {limits && <>, required {mm(limits[spacingRule])} (<code>{spacingRule}</code>)</>}.
          {overlap && <> Openings touch or overlap (<code>drill-overlap</code>).</>}
        </p>
      )}
      {otherCopper && (
        <p>Opening to copper clearance measured {mm(measuredCopper)}.
          {' '}{minCopper > 0 ? <>Required {mm(minCopper)} (<code>drill-clearance</code>).</>
            : 'No separate opening-to-copper minimum applies to this pair.'}</p>
      )}
      {!kernel && !kernelError && <p role="status">Measuring edge and annular clearance…</p>}
      {kernelError && <p role="alert">Edge and annular measurements are unavailable. {kernelError}</p>}
    </div>
  );
}
