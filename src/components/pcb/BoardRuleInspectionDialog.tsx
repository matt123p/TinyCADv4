import React, { useEffect, useId, useMemo, useState } from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tab, TabList } from '@fluentui/react-components';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import { boardCopperGeometry } from '../../pcb/boardCopperGeometry';
import { boardRuleResolver } from '../../pcb/boardRules';
import type { BoardZoneGeometry } from '../../pcb/boardZoneGeometry';
import { profileRegion } from '../../pcb/contours';
import { regionsTouch } from '../../pcb/copper';
import { fabricationProfileFor } from '../../pcb/fabricationProfiles';
import { inspectFabricationOutline } from '../../pcb/fabricationOutline';
import type { PolygonKernel } from '../../pcb/polygonKernel';
import { boundaryDistance, bounds } from '../../pcb/regionDistances';
import { regionalClearance } from '../../pcb/regionalClearance';
import { routingRegionApplies, routingRegionPolygon } from '../../pcb/routingRegions';

import BoardArtworkRuleInspection from './BoardArtworkRuleInspection';
import BoardOpeningRuleInspection from './BoardOpeningRuleInspection';

const mm = (value: number) => `${value / 1_000_000} mm`;

export default function BoardRuleInspectionDialog({
  board, zones, selectedCopperId, selectedLayer, onClose,
}: {
  board: BoardDocument;
  zones?: BoardZoneGeometry;
  selectedCopperId?: string;
  selectedLayer?: CopperLayer['id'];
  onClose(): void;
}) {
  const [tab, setTab] = useState<'copper' | 'openings' | 'artwork' | 'outline'>('copper');
  const tabId = useId();
  const [kernel, setKernel] = useState<PolygonKernel>();
  const [error, setError] = useState('');
  useEffect(() => {
    let open = true;
    void import('../../io/projectPcbKernel')
      .then(({ projectPcbKernel }) => projectPcbKernel())
      .then((result) => { if (open) setKernel(result); })
      .catch((failure) => { if (open) setError(String(failure)); });
    return () => { open = false; };
  }, []);

  const geometry = useMemo(() => boardCopperGeometry(board), [board]);
  const copper = useMemo(() => [...geometry.features, ...(zones?.fills ?? [])], [geometry, zones]);
  const preferred = selectedCopperId === undefined ? -1 : copper.findIndex(({ id, layerId }) =>
    (!selectedLayer || selectedLayer === layerId) && (
      id === selectedCopperId || id.startsWith(selectedCopperId + ':') ||
      geometry.owners.get(id) === selectedCopperId
    ));
  const [firstIndex, setFirstIndex] = useState(Math.max(preferred, 0));
  const [secondIndex, setSecondIndex] = useState(-1);
  const first = copper[firstIndex];
  const second = copper[secondIndex];
  const labels = useMemo(() => {
    const nets = new Map(board.nets?.map(({ id, name }) => [id, name]));
    const references = new Map(board.components?.map(({ id, reference }) => [id, reference]));
    const footprints = new Map(board.footprints?.map(({ id, componentId }) => [id, references.get(componentId)]));
    const pads = new Map(board.footprintDefinitions?.flatMap(({ pads }) => pads.map(({ id, label }) => [id, label])));
    return copper.map(({ id, kind, layerId, netId }, index) => {
      const [owner, pad] = id.split(':');
      const detail = kind === 'pad' && footprints.has(owner)
        ? [footprints.get(owner), 'pad ' + (pads.get(pad) ?? pad)].filter(Boolean).join(' ')
        : kind + ' ' + (index + 1);
      return `${detail} · ${nets.get(netId) ?? 'Unassigned'} · ${layerId}`;
    });
  }, [board, copper]);

  const resolver = useMemo(() => boardRuleResolver(board), [board]);
  const profile = fabricationProfileFor(board);
  const net = board.nets?.find(({ id }) => id === first?.netId);
  const netClass = board.netClasses?.find(({ id }) => id === net?.classId);
  const rules = resolver.net(first?.netId);
  const track = board.tracks?.find(({ id }) => id === first?.id);
  const via = board.vias?.find(({ id }) => id === geometry.owners.get(first?.id));
  const regions = first ? (board.routingRegions ?? []).filter((region) =>
    routingRegionApplies(region, first.layerId, net?.classId) && regionsTouch(first.region, routingRegionPolygon(region))) : [];
  const widthMin = regions.reduce((value, region) => Math.max(value, region.minWidthNm ?? 0), rules.minWidthNm);
  const widthMax = regions.reduce((value, region) => Math.min(value, region.maxWidthNm ?? Infinity), rules.maxWidthNm ?? Infinity);
  const edge = useMemo(() => board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] }, [board]);
  const outlineChecks = useMemo(() => tab === 'outline' && kernel && profile
    ? inspectFabricationOutline(kernel, edge, profile.limits)
    : [], [tab, kernel, edge, profile]);
  const edgeGap = tab === 'copper' && first && kernel
    ? kernel.boolean('difference', [first.region], [edge]).length ? 0 : boundaryDistance(first.region, edge)
    : undefined;
  const compare = tab === 'copper' && first && second && first.layerId === second.layerId && (!first.netId || first.netId !== second.netId);
  const matched = compare ? resolver.matchingClearanceRules(first, second) : [];
  const minimum = compare ? Math.max(
    resolver.copperClearance(first, second),
    zones?.clearanceByFill?.get(first.id) ?? 0,
    zones?.clearanceByFill?.get(second.id) ?? 0,
  ) : undefined;
  const actual = compare ? regionsTouch(first.region, second.region) ? 0 : boundaryDistance(first.region, second.region) : undefined;
  const regional = compare && kernel
    ? regionalClearance(board, kernel).measurements(first, bounds(first.region), second, bounds(second.region))
    : [];

  function renderCopper() {
    if (!copper.length) return <p>Place a footprint, route copper or refill a zone to inspect it.</p>;
    return (
      <div className="pcb-profile-fields">
        <label>
          Copper object
          <select aria-label="Copper object" value={firstIndex} onChange={(event) => {
            const next = Number(event.target.value);
            setFirstIndex(next);
            if (next === secondIndex) setSecondIndex(-1);
          }}>
            {labels.map((label, index) => <option key={index} value={index}>{label}</option>)}
          </select>
        </label>
        <label>
          Compare with
          <select aria-label="Compare with" value={secondIndex} onChange={(event) => setSecondIndex(Number(event.target.value))}>
            <option value={-1}>No comparison</option>
            {labels.map((label, index) => index !== firstIndex &&
              <option key={index} value={index}>{label}</option>)}
          </select>
        </label>
        <p>
          Board defaults.
          {profile && <> Fabrication profile {profile.title} <code>{board.fabrication.profileId}</code>.</>}
          {netClass && <> Net class {netClass.name} <code>{netClass.id}</code>.</>}
          {net?.routingRules && <> Net override <code>{net.id}</code>.</>}
        </p>
        <p>Edge clearance required {mm(rules.edgeClearanceNm)}
          {edgeGap !== undefined && <>, measured {mm(edgeGap)}</>}.</p>
        {track && <p>Track width required {mm(widthMin)} minimum
          {widthMax < Infinity && <> and {mm(widthMax)} maximum</>}, measured {mm(track.widthNm)}.</p>}
        {via && <p>Via annulus required {mm(rules.minViaAnnulusNm)}, measured {mm((via.diameterNm - via.drillNm) / 2)}.</p>}
        {regions.length > 0 && <ul aria-label="Matched routing regions">
          {regions.map((region) => <li key={region.id}>{region.name} <code>{region.id}</code>
            {region.exclusions.some((kind) => kind === first.kind) && <> · Excludes {first.kind}</>}</li>)}
        </ul>}
        {second && (compare ? (
          <>
            <p>Copper clearance required {mm(minimum)}, measured {mm(actual)}.</p>
            {matched.length > 0 && <ul aria-label="Matched clearance rules">
              {matched.map(({ id, name, clearanceNm }) => <li key={id}>{name} <code>{id}</code> · {mm(clearanceNm)}</li>)}
            </ul>}
            {regional.length > 0 && <ul aria-label="Regional clearance measurements">
              {regional.map(({ rule, requiredNm, measuredNm }) => <li key={rule.id}>
                {rule.name} <code>{rule.id}</code> · Required {mm(requiredNm)}, measured {mm(measuredNm)}
              </li>)}
            </ul>}
          </>
        ) : <p>Copper clearance applies to different or unassigned nets on the same layer.</p>)}
        {!kernel && !error && <p role="status">Measuring edge and regional clearance…</p>}
        {error && <p role="alert">Edge and regional measurements are unavailable. {error}</p>}
        {!!board.zones?.length && !zones && <p>Refill zones to inspect their copper.</p>}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(_, detail) => { if (!detail.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Inspect PCB rules</DialogTitle>
          <DialogContent>
            <TabList size="small" selectedValue={tab} aria-label="Rule inspection"
              onTabSelect={(_, { value }) => setTab(value === 'openings' || value === 'artwork' || value === 'outline' ? value : 'copper')}>
              <Tab id={tabId + '-copper'} aria-controls={tabId + '-panel'} value="copper">Copper</Tab>
              <Tab id={tabId + '-openings'} aria-controls={tabId + '-panel'} value="openings">Openings</Tab>
              <Tab id={tabId + '-artwork'} aria-controls={tabId + '-panel'} value="artwork">Artwork</Tab>
              <Tab id={tabId + '-outline'} aria-controls={tabId + '-panel'} value="outline">Outline</Tab>
            </TabList>
            <div role="tabpanel" id={tabId + '-panel'} aria-labelledby={tabId + '-' + tab}>
            {tab === 'outline' ? (
              <>
                {!profile && <p>Select a fabrication profile to check routed outline features.</p>}
                {profile && !kernel && !error && <p role="status">Preparing outline checks…</p>}
                {profile && error && <p role="alert">Outline checks are unavailable. {error}</p>}
                {outlineChecks.length > 0 && (
                  <ul aria-label="Routed outline checks">
                    {outlineChecks.map(({ name, rule, result, measuredNm, requiredNm, detail }) => (
                      <li key={name}>
                        {name} · minimum {mm(requiredNm)} (<code>{rule}</code>).
                        {measuredNm !== undefined && <> Measured {mm(measuredNm)}.</>}
                        {result === 'passed' && ' Passed.'}
                        {result === 'failed' && ' Feature below minimum.'}
                        {result === 'unverified' && <> Unverified. {detail}</>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : tab === 'artwork' ? (
              <BoardArtworkRuleInspection board={board} geometry={geometry} kernel={kernel} kernelError={error} />
            ) : tab === 'openings' ? (
              <BoardOpeningRuleInspection board={board} geometry={geometry} copper={copper} copperLabels={labels}
                kernel={kernel} kernelError={error} />
            ) : (
              renderCopper()
            )}
            </div>
          </DialogContent>
          <DialogActions><Button appearance="primary" onClick={onClose}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
