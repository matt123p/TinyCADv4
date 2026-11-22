import React, { useMemo, useState } from 'react';
import { Button, MenuItem, MenuDivider, Tab, TabList, ToolbarDivider } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { AnchoredContextMenu } from '../controls/AnchoredContextMenu';
import { DocumentAddRegular, FolderOpenRegular, SaveRegular, SaveCopyRegular, PanelLeftExpandRegular, PanelRightExpandRegular, PanelBottomExpandRegular } from '@fluentui/react-icons';
import { ResizeHandle } from '../panel/ResizeHandle';
import { EditorToolbar } from '../toolbar/EditorToolbar';
import { EditorFileMenu, EditorHistoryControls, EditorSaveButton } from '../toolbar/FileToolbarControls';
import { ViewToolbarControls } from '../toolbar/ViewToolbarControls';
import { ContextualMenuItemType } from '../../manipulators/updateInterfaces';
import type { ContextMenuItem } from '../../manipulators/updateInterfaces';
import {
  boardNetSources,
  boardPadSources,
} from '../../pcb/hierarchicalSnapshot';
import type { BoardZone } from '../../pcb/boardZones';
import { createBoardWorker } from '../../pcb/boardWorker';
import type { ManualRoute } from '../../pcb/manualBoardRouting';
import { isCentrelineClear, manualRouteLeg } from '../../pcb/routing';
import type { RouteBend } from '../../pcb/routing';
import type { BoardDocument, CopperLayer } from '../../pcb/board';
import type { ViaTenting } from '../../pcb/boardRouting';
import {
  cornerTrack,
  planTrackEdit,
  trackBranchPoint,
  trackMidpoint,
} from '../../pcb/trackEdits';
import type { ManualTrackEdit } from '../../pcb/trackEdits';
import { applyRouteDeletion, planRouteDeletion } from '../../pcb/routeDeletion';
import type { RouteDeletionPlan } from '../../pcb/routeDeletion';
import type { RouteCleanupResult } from '../../pcb/routeCleanup';
import RouteDeletionPanel from './RouteDeletionPanel';
import type { RouteDeletionDraft } from './RouteDeletionPanel';
import type { BoardFootprint } from '../../pcb/boardAssets';
import BoardCanvas from './BoardCanvas';
import type { BoardCanvasHandle, BoardPick, BoardPickTarget } from './BoardCanvas';
import BoardPickDialog from './BoardPickDialog';
import BoardAnnotationDialog from './BoardAnnotationDialog';
import type { AnnotationDraft } from './BoardAnnotationDialog';
import { dimensionText } from '../../pcb/boardAnnotations';
import type { BoardDimension } from '../../pcb/boardAnnotations';
import type { PlacementPreview } from './BoardCanvas';
import BoardPlacementTray from './BoardPlacementTray';
import FirstBoardGuide from './FirstBoardGuide';
import { DeviceFootprintPreview } from '../projects/DeviceFootprintPreview';
import BoardFabricationDialog from './BoardFabricationDialog';
import BoardNetRulesDialog from './BoardNetRulesDialog';
import BoardConnectionsDialog from './BoardConnectionsDialog';
import BoardChecksDialog from './BoardChecksDialog';
import BoardHoleDialog from './BoardHoleDialog';
import BoardProfileDialog from './BoardProfileDialog';
import BoardZoneDialog from './BoardZoneDialog';
import WireJumperDialog from './WireJumperDialog';
import type { BoardWireJumper } from '../../pcb/boardJumpers';
import PlacementAreaDialog from './PlacementAreaDialog';
import type { PlacementArea } from '../../pcb/placementAreas';
import RoutingRegionDialog from './RoutingRegionDialog';
import type { RoutingRegion } from '../../pcb/routingRegions';
import { beginnerRouteDefaults, boardRuleResolver, preferredTrackWidth, routeViaPresets } from '../../pcb/boardRules';
import { editableProfile } from '../../pcb/boardProfiles';
import {
  boardPlacementView,
  placementPadTemplates,
} from '../../pcb/boardPlacement';
import type { PlacementGroupOperation } from '../../pcb/boardPlacement';
import { padShapePoints } from '../../pcb/padstack';
import { isBoardPoint, samePoint } from '../../pcb/geometry';
import { boardInputLength, canonicalBoardDecimal } from './boardNumberInput';
import type { FootprintPlacement } from '../../pcb/footprint';
import type { BoardPoint } from '../../pcb/geometry';
import type { BoardRecoveryStatus } from '../../io/boardRecovery';
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import {
  boardHistoryCommand,
  boardZoomCommand,
  saveActiveBoard,
} from '../../io/boardWorkspaceEvents';
import type { BoardWorkspaceProbe } from '../../io/projectPcbProbe';

const BoardRuleInspectionDialog = React.lazy(() => import('./BoardRuleInspectionDialog'));
const FootprintEditorDialog = React.lazy(() => import('../projects/FootprintEditorDialog'));
const BoardInspectionDialog = React.lazy(
  () => import('./BoardInspectionDialog'),
);
const BoardCamDialog = React.lazy(() => import('./BoardCamDialog'));
const BoardRevisionDialog = React.lazy(() => import('./BoardRevisionDialog'));
const KicadExportDialog = React.lazy(() => import('./KicadExportDialog'));
const KicadBoardReviewDialog = React.lazy(() => import('./KicadBoardReviewDialog'));

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => boardInputLength(value, 'mm');
type BoardView = 'engineering' | 'beginner';
type WidthPreset = 'minimum' | 'preferred' | 'custom';
type ViaStyle = keyof ReturnType<typeof routeViaPresets> | 'custom';
type TrackEditDraft = {
  source: BoardDocument;
  action: ManualTrackEdit;
  x: string;
  y: string;
};
const boardViewStorageKey = 'tinycad-pcb-view';

function savedBoardView(): BoardView {
  try {
    return window.localStorage.getItem(boardViewStorageKey) === 'beginner'
      ? 'beginner'
      : 'engineering';
  } catch {
    return 'engineering';
  }
}

export interface BoardWorkspaceDocument {
  session: BoardWorkspaceSession;
  projectRootId?: string;
  fileId?: string;
  ancestorIds?: readonly string[];
  reloadProjectBoard?(): Promise<BoardWorkspaceDocument>;
  syncStatus?: string;
  probe?: BoardWorkspaceProbe;
  onProbe?: (
    source: ReturnType<typeof boardPadSources>[number]['source'],
  ) => void;
  onUpdate?: () => void;
  onEditReferences?: () => void;
  onBackAnnotate?: () => void;
}

export default function BoardWorkspace({
  session,
  onClose,
  onOpen,
  onNew,
  onProjectFolder,
  footprintsVisible,
  onToggleFootprints,
  manageClose,
  activeCommands = true,
  syncStatus,
  probe,
  onProbe,
  onUpdate,
  onEditReferences,
  onBackAnnotate,
}: BoardWorkspaceDocument & {
  onClose(): void;
  onOpen(): void;
  onNew(): void;
  onProjectFolder?(): void;
  footprintsVisible: boolean;
  onToggleFootprints(visible: boolean): void;
  manageClose?: boolean;
  activeCommands?: boolean;
}) {
  const [board, setBoard] = useState(session.board);
  const [recoveryStatus, setRecoveryStatus] = useState<BoardRecoveryStatus>({
    kind: 'idle',
  });
  React.useEffect(
    () => session.subscribeRecovery(setRecoveryStatus),
    [session],
  );
  const [selected, setSelected] = useState(probe?.componentId ?? '');
  const [group, setGroup] = useState<string[]>([]);
  const [groupMode, setGroupMode] = useState('translate');
  const [groupX, setGroupX] = useState('0');
  const [groupY, setGroupY] = useState('0');
  const [groupAngle, setGroupAngle] = useState('90');
  const [placementQueue, setPlacementQueue] = useState<readonly string[]>([]);
  const [sequentialPlacement, setSequentialPlacement] = useState(false);
  const [queuePositionSet, setQueuePositionSet] = useState(false);
  const [placementTool, setPlacementTool] = useState<string>();
  const [showPlacementEstimates, setShowPlacementEstimates] = useState(false);
  const [selectedPad, setSelectedPad] = useState(probe?.padId);
  const [selectedNet, setSelectedNet] = useState(probe?.netId ?? '');
  const [x, setX] = useState('10');
  const [y, setY] = useState('10');
  const [rotation, setRotation] = useState('0');
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  const [filename, setFilename] = useState(session.path);
  const [profileDialog, setProfileDialog] = useState<'outline' | 'cutout' | number>();
  const [holeDialog, setHoleDialog] = useState(false);
  const [visibleCopper, setVisibleCopper] = useState<'all' | CopperLayer['id']>(
    'all',
  );
  const [measuring, setMeasuring] = useState(false);
  const [measurement, setMeasurement] = useState<BoardPoint[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>();
  const dimensions = board.annotations?.dimensions ?? [];
  const datum = board.annotations?.datum;
  const [routing, setRouting] = useState(false);
  const routeToggle = React.useRef<HTMLButtonElement>(null);
  const routeLayerControl = React.useRef<HTMLSelectElement>(null);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const boardCanvas = React.useRef<BoardCanvasHandle>(null);
  const [pickingObjects, setPickingObjects] = useState(false);
  const [objectPick, setObjectPick] = useState<BoardPick>();
  const [selectedSilk, setSelectedSilk] = useState<BoardPickTarget>();
  const [reroute, setReroute] = useState('');
  const [trackEditDraft, setTrackEditDraft] = useState<TrackEditDraft>();
  const trackEdit = trackEditDraft?.source === board ? trackEditDraft : undefined;
  const [cleanupDraft, setCleanupDraft] = useState<{ source: BoardDocument; result: RouteCleanupResult }>();
  const cleanup = cleanupDraft?.source === board ? cleanupDraft.result : undefined;
  const [deleteRoute, setDeleteRoute] = useState<{ source: BoardDocument; draft: RouteDeletionDraft }>();
  const deletionDraft = deleteRoute?.source === board ? deleteRoute.draft : undefined;
  const regionPicking = deletionDraft?.kind === 'region' && deletionDraft.picking;
  const pickedRoute = React.useRef<{ id: string; point: BoardPoint }>();
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [checkedRevision, setCheckedRevision] = useState<number>();
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [kicadOpen, setKicadOpen] = useState(false);
  const [kicadReviewOpen, setKicadReviewOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [fabricationOpen, setFabricationOpen] = useState(false);
  const [ruleInspectionOpen, setRuleInspectionOpen] = useState(false);
  const [netRulesOpen, setNetRulesOpen] = useState(false);
  const [checkMarker, setCheckMarker] = useState<{
    board: typeof board;
    location?: BoardPoint;
  }>();
  const [jumperDialog, setJumperDialog] = useState<BoardWireJumper | 'new'>();
  const [zoneDialog, setZoneDialog] = useState<BoardZone | 'new'>();
  const [placementAreaDialog, setPlacementAreaDialog] = useState<
    PlacementArea | 'new'
  >();
  const [routingRegionDialog, setRoutingRegionDialog] = useState<RoutingRegion | 'new'>();
  const [derive, setDerive] = useState(true);
  const [derived, setDerived] = useState<{
    board: typeof board;
    result?: Awaited<
      ReturnType<ReturnType<typeof createBoardWorker>['geometry']>
    >;
    error?: string;
  }>();
  const derivedResult =
    derive && derived?.board === board ? derived.result : undefined;
  const deriveError =
    derive && derived?.board === board ? derived.error : undefined;
  const refillWorker = React.useRef<{
    job: ReturnType<typeof createBoardWorker>;
    finished: Promise<void>;
  }>();
  const waitForRefill = React.useCallback(async () => {
    await refillWorker.current?.finished;
  }, []);
  const fillPaused = checksOpen || camOpen;
  const fillPending = derive && derived?.board !== board && Boolean(
    board.zones?.length ||
      board.jumpers?.length ||
      (board.footprints?.length &&
        (board.tracks?.length || board.vias?.length)),
  );
  const [route, setRoute] = useState<ManualRoute['path']>([]);
  const [routeBend, setRouteBend] = useState<RouteBend>('straight-first');
  const [layer, setLayer] = useState<CopperLayer['id']>('top');
  const [trackWidth, setTrackWidth] = useState('0.25');
  const [widthPreset, setWidthPreset] = useState<WidthPreset>('preferred');
  const [viaStyle, setViaStyle] = useState<ViaStyle>('compact');
  const [viaDiameter, setViaDiameter] = useState('0.65');
  const [viaDrill, setViaDrill] = useState('0.3');
  const { t } = useTranslation();
  const [boardMenu, setBoardMenu] = useState<{
    point: { x: number; y: number };
    componentId?: string;
    routeId?: string;
  }>();
  const footprintTabId = React.useId();
  const [footprintTab, setFootprintTab] = useState<'unplaced' | 'library'>('unplaced');
  const [footprintEditor, setFootprintEditor] = useState(false);
  const [libraryFootprintId, setLibraryFootprintId] = useState('');
  const libraryFootprint = board.footprintDefinitions?.find(({ id }) => id === libraryFootprintId);
  const [showRulers, setShowRulers] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [footprintsWidth, setFootprintsWidth] = useState(240);
  const [inspectorWidth, setInspectorWidth] = useState(248);
  const [propertiesHeight, setPropertiesHeight] = useState(164);
  const [snapGrid, setSnapGrid] = useState('0.25');
  const [boardView, setBoardView] = useState(savedBoardView);
  const beginner = boardView === 'beginner';
  const [guideOpen, setGuideOpen] = useState(beginner);
  const [guideStep, setGuideStep] = useState(0);
  const guideToggle = React.useRef<HTMLButtonElement>(null);
  const placementSearch = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  React.useEffect(() => {
    if (!probe) return;
    if (probe.placementQueue?.length) {
      startSequentialPlacement(probe.placementQueue);
      return;
    }
    setSequentialPlacement(false);
    setSelected(probe.componentId ?? '');
    setGroup([]);
    setSelectedPad(probe.padId);
    setSelectedNet(probe.netId ?? '');
    setSelectedRouteId('');
    const placement = session.board.footprints?.find(
      ({ componentId }) => componentId === probe.componentId,
    );
    if (placement) {
      setX(mm(placement.positionNm.x));
      setY(mm(placement.positionNm.y));
      setRotation(mm(placement.rotationMicrodegree));
      setSide(placement.side);
    }
  }, [probe, session]);
  const selectedTrack = board.tracks?.find(({ id }) => id === selectedRouteId);
  const selectedVia = board.vias?.find(({ id }) => id === selectedRouteId);
  const routeSelection = selectedTrack ?? selectedVia;
  const layout = useMemo<{
    geometry?: ReturnType<typeof boardPlacementView>;
    error?: string;
  }>(() => {
    try {
      return { geometry: boardPlacementView(board) };
    } catch (failure) {
      return { error: String(failure) };
    }
  }, [board]);
  const { geometry } = layout;
  const canPickObjects = !!geometry && !beginner && !busy && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup && !placementTool;
  React.useEffect(() => {
    if (!canPickObjects) setPickingObjects(false);
  }, [canPickObjects]);
  const groupMembers = group.filter((id) =>
    geometry?.features.some((feature) => feature.id === id),
  );
  const groupSelection = new Set(beginner ? [] : groupMembers);
  const selectedFeatures = geometry?.features.filter(({ id }) =>
    groupSelection.size ? groupSelection.has(id) : id === selected) ?? [];
  const groupAnchor = geometry?.features.find(
    ({ id }) => id === groupMembers[0],
  );
  const placed = new Set(
    board.footprints?.map(({ componentId }) => componentId),
  );
  const unplaced = (board.components ?? []).filter(({ id }) => !placed.has(id));
  const placeable = new Set(
    unplaced.filter(({ deviceId }) => deviceId).map(({ id }) => id),
  );
  const queue = placementQueue.filter((id) => placeable.has(id));
  const target = board.components?.find(({ id }) => id === selected);
  const selectedPlacement = board.footprints?.find(
    ({ componentId }) => componentId === selected,
  );
  const positionLocked =
    selectedPlacement?.locked || selectedPlacement?.positionLocked;
  const rotationLocked =
    selectedPlacement?.locked || selectedPlacement?.rotationLocked;
  const sourcePads =
    session.circuit && selectedPlacement
      ? boardPadSources(board, session.circuit).filter(
          ({ footprintId }) => footprintId === selectedPlacement.id,
        )
      : [];
  const netSources = useMemo(
    () =>
      session.circuit && selectedNet
        ? boardNetSources(session.circuit, selectedNet)
        : [],
    [session.circuit, selectedNet],
  );

  function measureAt(point: BoardPoint) {
    setMeasurement((points) =>
      points.length === 1 ? [...points, point] : [point],
    );
  }

  function addDimension(points?: readonly BoardPoint[]) {
    const [start, end] = points ?? [
      board.outline?.[0] ?? board.profile?.outline[0].start ?? { x: 0, y: 0 },
      board.outline?.[1] ?? board.profile?.outline[0].end ?? { x: 10_000_000, y: 0 },
    ];
    setAnnotationDraft({
      type: 'dimension',
      dimension: {
        id: crypto.randomUUID(),
        start,
        end,
        kind: 'aligned',
        offsetNm: 2_000_000,
        unit: 'mm',
      },
    });
  }

  function changeAnnotations(nextDatum: BoardPoint | undefined, nextDimensions: readonly BoardDimension[]) {
    const annotations = nextDatum || nextDimensions.length
      ? {
          ...(nextDatum && { datum: nextDatum }),
          ...(nextDimensions.length && { dimensions: nextDimensions }),
        }
      : undefined;
    return session.apply([{ type: 'setAnnotations', annotations }]);
  }

  const grid = Math.max(1, Math.round(Number(canonicalBoardDecimal(snapGrid)) * 1_000_000) || 1);
  function canvasPosition(x: number, y: number) {
    return { x: Math.round(x / grid) * grid, y: Math.round(-y / grid) * grid };
  }

  function placementFromInputs(position?: BoardPoint): FootprintPlacement {
    const turn = 360_000_000;
    const rotationMicrodegree = rotationLocked
      ? selectedPlacement.rotationMicrodegree
      : ((nm(rotation) % turn) + turn) % turn;
    const positionNm = positionLocked
      ? selectedPlacement.positionNm
      : position ?? { x: nm(x), y: nm(y) };
    return { positionNm, rotationMicrodegree, side };
  }

  function currentPlacementPreview(): PlacementPreview | undefined {
    if (
      !target?.deviceId ||
      placementTool !== target.id ||
      selectedPlacement?.locked ||
      busy ||
      routing ||
      measuring
    )
      return;
    const device = board.deviceDefinitions?.find(
      ({ id }) => id === target.deviceId,
    );
    const footprint = board.footprintDefinitions?.find(
      ({ id }) => id === device?.footprintId,
    );
    if (!footprint || !device) return;
    try {
      return {
        placement: placementFromInputs(),
        original: selectedPlacement,
        pads: placementPadTemplates(target, device, footprint),
        footprint,
        showDraft: !sequentialPlacement || queuePositionSet,
        estimates: !beginner && showPlacementEstimates,
        snap: positionLocked
          ? () => selectedPlacement.positionNm
          : canvasPosition,
      };
    } catch {
      // Numeric inputs can be incomplete while the user edits them.
      return undefined;
    }
  }

  const ruleResolver = useMemo(() => boardRuleResolver(board), [board]);
  const routeRules = ruleResolver.net(selectedNet);
  const teachingRoute = beginnerRouteDefaults(board, routeRules);
  const preferredWidth = preferredTrackWidth(routeRules, 250_000);
  const routeWidth = beginner ? mm(teachingRoute.widthNm)
    : widthPreset === 'custom' ? trackWidth
    : mm(widthPreset === 'minimum' ? routeRules.minWidthNm : preferredWidth);
  const viaPresets = routeViaPresets(board, routeRules);

  function changeBoardView(view: BoardView) {
    setBoardView(view);
    if (view === 'beginner') setGuideOpen(true);
    try {
      window.localStorage.setItem(boardViewStorageKey, view);
    } catch {
      // The current editor can still use the selected view.
    }
  }

  function setRoutingMode(active: boolean) {
    if (!active) cancelCopperJob();
    else cancelPlacement();
    setError('');
    setCleanupDraft(undefined);
    setTrackEditDraft(undefined);
    setDeleteRoute(undefined);
    setRoute([]);
    setReroute('');
    setMeasuring(false);
    setMeasurement([]);
    setRouting(active);
  }

  async function routePoint(
    position: BoardPoint,
    targetNet?: string,
  ) {
    if (busy || activeCopperJob.current) return;
    if (!route.length && targetNet) {
      setSelectedNet(targetNet);
    } else if (!selectedNet) {
      setError('Select a board net or click copper with an assigned net.');
      return;
    }
    setError('');
    const last = route.at(-1);
    if (!last) {
      setRoute([{ position, layer }]);
      return;
    }
    const points = manualRouteLeg(last.position, position, routeBend);
    if (!points.length) return;
    function addPoints(geometry: RouteClearance) {
      if (!clearRouteLeg(geometry, last.position, points, layer)) {
        setError('Track blocked by the board edge, a drill, copper clearance or a routing region.');
        return;
      }
      setRoute([...route, ...points.map((position) => ({ position, layer }))]);
    }
    if (routeClearance) addPoints(routeClearance);
    else await runCopperJob(() => loadRouteClearance(), (geometry) => {
      setClearanceDraft({ input: clearanceInput, geometry });
      addPoints(geometry);
    });
  }

  function enterRoutePoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const position = {
        x: nm(String(values.get('x'))),
        y: nm(String(values.get('y'))),
      };
      if (!isBoardPoint(position)) throw new Error('Waypoint coordinates are out of range.');
      void routePoint(position);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function changeRouteLayer(next: CopperLayer['id']) {
    if (next === layer) return;
    const last = route[route.length - 1];
    if (last) setRoute([...route, { ...last, layer: next }]);
    setLayer(next);
  }

  const worker = React.useRef<ReturnType<typeof createBoardWorker>>();
  const activeCopperJob = React.useRef<NonNullable<typeof worker.current>>();
  type RouteClearance = Awaited<ReturnType<ReturnType<typeof createBoardWorker>['routeClearance']>>;
  const clearanceInput = useMemo(() => ({ board, selectedNet, routeWidth, reroute }), [board, selectedNet, routeWidth, reroute]);
  const clearanceRequest = React.useRef<{
    input: typeof clearanceInput;
    result: Promise<RouteClearance>;
    pending: boolean;
  }>();
  const [clearanceDraft, setClearanceDraft] = useState<{
    input: typeof clearanceInput;
    geometry?: RouteClearance;
    error?: string;
  }>();
  const [clearanceAttempt, setClearanceAttempt] = useState(0);
  const currentClearance = clearanceDraft?.input === clearanceInput ? clearanceDraft : undefined;
  const routeClearance = currentClearance?.geometry;
  const routeClearanceError = currentClearance?.error;

  function copperWorker() {
    if (!worker.current || worker.current.closed) worker.current = createBoardWorker();
    return worker.current;
  }

  function loadRouteClearance() {
    if (clearanceRequest.current?.input === clearanceInput) return clearanceRequest.current.result;
    async function request() {
      const widthNm = nm(routeWidth);
      return copperWorker().routeClearance(board, {
        netId: selectedNet, widthNm, ...(reroute ? { replaceTrack: reroute } : {}),
      });
    }
    const result = request();
    const entry = { input: clearanceInput, result, pending: true };
    clearanceRequest.current = entry;
    void result.then(() => {
      entry.pending = false;
      releaseIdleCopperWorker();
    }, () => {
      if (clearanceRequest.current === entry) clearanceRequest.current = undefined;
      releaseIdleCopperWorker();
    });
    return result;
  }

  function cancelCopperJob() {
    const active = activeCopperJob.current;
    activeCopperJob.current = undefined;
    stopCopperWorker();
    if (active) setBusy(false);
  }

  function disposeCopperWorker() {
    worker.current?.dispose();
    worker.current = undefined;
  }

  function releaseIdleCopperWorker() {
    if (!activeCopperJob.current && !clearanceRequest.current?.pending)
      disposeCopperWorker();
  }

  function stopCopperWorker() {
    disposeCopperWorker();
    clearanceRequest.current = undefined;
  }

  async function runCopperJob<T>(
    compute: (job: NonNullable<typeof worker.current>) => Promise<T>,
    accept: (result: T) => void,
  ) {
    if (busy || activeCopperJob.current) return;
    let job: ReturnType<typeof createBoardWorker>;
    try {
      job = copperWorker();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    activeCopperJob.current = job;
    setBusy(true);
    setError('');
    try {
      const result = await compute(job);
      if (activeCopperJob.current === job) accept(result);
    } catch (failure) {
      if (activeCopperJob.current === job) {
        if (job.closed) worker.current = undefined;
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (activeCopperJob.current === job) {
        activeCopperJob.current = undefined;
        releaseIdleCopperWorker();
        setBusy(false);
      }
    }
  }

  React.useEffect(() => {
    if (!routing || !selectedNet) {
      clearanceRequest.current = undefined;
      setClearanceDraft(undefined);
      return;
    }
    let active = true;
    void loadRouteClearance().then((geometry) => {
      if (active) setClearanceDraft({ input: clearanceInput, geometry });
    }, (failure: Error) => {
      if (active) setClearanceDraft({ input: clearanceInput, error: failure.message });
    });
    return () => {
      active = false;
      if (!activeCopperJob.current && clearanceRequest.current?.pending &&
          clearanceRequest.current.input === clearanceInput)
        stopCopperWorker();
    };
  }, [routing, clearanceInput, clearanceAttempt]);

  function clearRouteLeg(
    geometry: RouteClearance,
    start: BoardPoint,
    points: readonly BoardPoint[],
    side: CopperLayer['id'],
  ) {
    return points.every((end, index) => isCentrelineClear(geometry, index ? points[index - 1] : start, end, side));
  }

  function previewRouteLeg(position: BoardPoint) {
    const last = route.at(-1);
    if (!last || !routeClearance) return;
    const points = manualRouteLeg(last.position, position, routeBend);
    if (points.length) return {
      points: [last.position, ...points],
      blocked: !clearRouteLeg(routeClearance, last.position, points, last.layer),
    };
  }
  React.useEffect(
    () => () => {
      activeCopperJob.current = undefined;
      stopCopperWorker();
    },
    [],
  );
  React.useEffect(() => () => {
    const inProgress = refillWorker.current;
    refillWorker.current = undefined;
    inProgress?.job.dispose();
  }, [board, derive]);
  React.useEffect(() => {
    if (fillPaused || !fillPending || refillWorker.current) return;
    const job = createBoardWorker();
    const finished = job.geometry(board).then(
      (result) => {
        if (refillWorker.current?.job === job) setDerived({ board, result });
      },
      (failure: Error) => {
        if (refillWorker.current?.job === job) setDerived({ board, error: failure.message });
      },
    ).finally(() => {
      job.dispose();
      if (refillWorker.current?.job === job) refillWorker.current = undefined;
    });
    refillWorker.current = { job, finished };
  }, [board, fillPending, fillPaused]);

  async function finishRoute() {
    await runCopperJob(async (job) => {
      const path = reroute && selectedTrack
        ? [
            ...route,
            ...(layer === selectedTrack.layerId
              ? manualRouteLeg(route.at(-1).position, selectedTrack.end, routeBend)
              : [selectedTrack.end]).map((position) => ({ position, layer: selectedTrack.layerId })),
          ]
        : route;
      const crossesLayers = path.some((point, index) => index > 0 && point.layer !== path[index - 1].layer);
      const via = beginner ? viaPresets.preferred
        : viaStyle !== 'custom' ? viaPresets[viaStyle]
        : crossesLayers ? { viaDiameterNm: nm(viaDiameter), viaDrillNm: nm(viaDrill) }
        : viaPresets.compact;
      return job.route(board, {
        netId: selectedNet,
        widthNm: nm(routeWidth),
        path,
        ...via,
        ...(reroute ? { replaceTrack: reroute } : {}),
      });
    }, (candidate) => {
      setBoard(session.commit(candidate));
      stopCopperWorker();
      setRoute([]);
      setRouting(false);
      setReroute('');
    });
  }

  function selectComponent(componentId: string, padId?: string) {
    setPlacementTool(undefined);
    setSequentialPlacement(false);
    setGroup([]);
    setSelected(componentId);
    setSelectedPad(padId);
    setSelectedRouteId('');
    setSelectedSilk(undefined);
    const placement = board.footprints?.find(
      ({ componentId: id }) => id === componentId,
    );
    if (placement && selected !== componentId) {
      setX(mm(placement.positionNm.x));
      setY(mm(placement.positionNm.y));
      setRotation(mm(placement.rotationMicrodegree));
      setSide(placement.side);
    }
    setSelectedNet('');
  }

  function selectPickedObject(target: BoardPickTarget) {
    const location = objectPick.point;
    setObjectPick(undefined);
    if (target.kind === 'pad') selectComponent(target.componentId, target.id);
    if (target.kind === 'silk') {
      selectComponent(target.componentId);
      setSelectedSilk(target);
    }
    if (target.kind === 'track' || target.kind === 'via') {
      const route = (target.kind === 'track' ? board.tracks : board.vias)?.find(({ id }) => id === target.id);
      if (route) {
        pickedRoute.current = { id: route.id, point: location };
        setSelectedRouteId(route.id);
        setSelectedNet(route.netId ?? '');
        setSelectedSilk(undefined);
      }
    }
    if (target.kind === 'zone') setZoneDialog(board.zones?.find(({ id }) => id === target.id));
  }

  function fitSelection() {
    const around = ({ x, y }: BoardPoint, radius: number) => [
      { x: x - radius, y: y - radius }, { x: x + radius, y: y + radius },
    ];
    if (selectedTrack) {
      const { start, end, widthNm } = selectedTrack;
      boardCanvas.current?.fit([...around(start, widthNm / 2), ...around(end, widthNm / 2)]);
    } else if (selectedVia) {
      boardCanvas.current?.fit(around(selectedVia.positionNm, selectedVia.diameterNm / 2));
    } else {
      const points = selectedFeatures.flatMap(({ placement, pads, copper }) => {
        const selectedLand = selectedPad && pads.find(({ id }) => id === selectedPad);
        const lands = selectedLand ? copper.filter(({ padId }) => padId === selectedLand.id) : copper;
        if (lands.length) return lands.flatMap(({ shape }) => padShapePoints(shape));
        return selectedLand ? [selectedLand.position] : [placement.positionNm, ...pads.map(({ position }) => position)];
      });
      if (points.length) boardCanvas.current?.fit(points);
    }
  }

  function toggleGroupComponent(componentId: string, extendSelection = false) {
    if (busy || routing || measuring) return;
    setSequentialPlacement(false);
    setGroup((previous) => {
      const selection =
        extendSelection && !previous.length && selectedPlacement
          ? [selected]
          : previous;
      return selection.includes(componentId)
        ? selection.filter((id) => id !== componentId)
        : [...selection, componentId];
    });
    setSelected('');
    setSelectedPad(undefined);
    setSelectedNet('');
    setSelectedRouteId('');
  }

  async function moveGroup() {
    setBusy(true);
    setError('');
    try {
      const axis = groupMode.endsWith('-x') ? 'x' : 'y';
      const operation: PlacementGroupOperation =
        groupMode === 'translate'
          ? { kind: 'translate', delta: { x: nm(groupX), y: nm(groupY) } }
          : groupMode === 'rotate'
          ? { kind: 'rotate', angle: nm(groupAngle) }
          : {
              kind: groupMode.startsWith('align-') ? 'align' : 'distribute',
              axis,
            };
      setBoard(await session.moveGroup(groupMembers, operation));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  function beginTrackEdit(endpoint?: 'start' | 'end') {
    if (!selectedTrack?.netId) return;
    setRoutingMode(false);
    setError('');
    const target = endpoint ? selectedTrack[endpoint] : trackMidpoint(selectedTrack);
    const action: ManualTrackEdit = endpoint
      ? { kind: 'corner', trackId: selectedTrack.id, endpoint, target }
      : { kind: 'drag', trackId: selectedTrack.id, target };
    setTrackEditDraft({ source: board, action, x: mm(target.x), y: mm(target.y) });
  }

  function moveTrackHandle(target: BoardPoint) {
    setTrackEditDraft((draft) => draft && { ...draft, x: mm(target.x), y: mm(target.y) });
  }

  const trackEditPreview = useMemo(() => {
    if (!trackEdit) return;
    let handle = trackEdit.action.target;
    try {
      handle = { x: nm(trackEdit.x), y: nm(trackEdit.y) };
      const action = { ...trackEdit.action, target: handle };
      return { handle, action, pieces: planTrackEdit(board, action).pieces };
    } catch {
      return { handle, action: undefined, pieces: [] };
    }
  }, [board, trackEdit]);

  async function applyTrackEdit() {
    const action = trackEditPreview?.action;
    if (!action) return;
    await runCopperJob(
      (job) => job.editTrack(board, action),
      (candidate) => {
        setBoard(session.commit(candidate));
        setTrackEditDraft(undefined);
      },
    );
  }

  function cancelTrackEdit() {
    cancelCopperJob();
    setTrackEditDraft(undefined);
    setError('');
  }

  function beginBranch() {
    if (!selectedTrack?.netId) return;
    setRoutingMode(true);
    setSelectedNet(selectedTrack.netId);
    setLayer(selectedTrack.layerId);
    setWidthPreset('custom');
    setTrackWidth(mm(selectedTrack.widthNm));
    setRoute([{ position: trackBranchPoint(selectedTrack), layer: selectedTrack.layerId }]);
  }

  function beginReroute() {
    if (!selectedTrack?.netId) return;
    setRoutingMode(true);
    setSelectedNet(selectedTrack.netId);
    setLayer(selectedTrack.layerId);
    setWidthPreset('custom');
    setTrackWidth(mm(selectedTrack.widthNm));
    setRoute([{ position: selectedTrack.start, layer: selectedTrack.layerId }]);
    setReroute(selectedTrack.id);
  }

  function splitTrack() {
    if (!selectedTrack || selectedTrack.locked) return;
    const middle = trackBranchPoint(selectedTrack);
    if (samePoint(middle, selectedTrack.start)) {
      setError('This track has no intermediate point at the board resolution.');
      return;
    }
    edit(() =>
      session.commit({
        ...board,
        tracks: board.tracks.flatMap((track) =>
          track.id === selectedTrack.id
            ? [
                { ...track, end: middle },
                { ...track, id: crypto.randomUUID(), start: middle },
              ]
            : [track],
        ),
      }),
    );
  }

  const deletion = useMemo((): {
    plan?: RouteDeletionPlan;
    corners?: readonly [BoardPoint, BoardPoint];
    error?: string;
  } | undefined => {
    if (!deletionDraft) return;
    let corners: readonly [BoardPoint, BoardPoint];
    try {
      if (deletionDraft.kind !== 'region')
        return { plan: planRouteDeletion(board, deletionDraft) };
      const { start, end, layer } = deletionDraft;
      if ([start.x, start.y, end.x, end.y].some((value) => !value.trim())) return {};
      corners = [{ x: nm(start.x), y: nm(start.y) }, { x: nm(end.x), y: nm(end.y) }];
      return { corners, plan: planRouteDeletion(board, { kind: 'region', start: corners[0], end: corners[1], layer }) };
    } catch (failure) {
      return { corners, error: failure instanceof Error ? failure.message : String(failure) };
    }
  }, [board, deletionDraft]);

  function previewDeletion(draft: RouteDeletionDraft) {
    setCleanupDraft(undefined);
    setError('');
    setMeasuring(false);
    setMeasurement([]);
    setDeleteRoute({ source: board, draft });
  }

  function chooseRegionPoint(point: BoardPoint) {
    if (deletionDraft?.kind !== 'region' || !deletionDraft.picking) return;
    const draft = deletionDraft;
    setDeleteRoute({
      source: board,
      draft: { ...draft, [draft.picking]: { x: mm(point.x), y: mm(point.y) },
        picking: draft.picking === 'start' ? 'end' : undefined },
    });
  }

  function deleteSelectedRoute() {
    if (!deletion?.plan || busy) return;
    edit(() => {
      const next = session.commit(applyRouteDeletion(session.board, deletion.plan));
      setDeleteRoute(undefined);
      setSelectedRouteId('');
      return next;
    });
  }

  function toggleRoutingLock() {
    if (!routeSelection) return;
    const update = <T extends { id: string; locked?: boolean }>(items: readonly T[]) =>
      items.map((item) => item.id === routeSelection.id
        ? { ...item, locked: !item.locked } : item);
    edit(() => session.commit({
      ...board,
      ...(selectedTrack ? { tracks: update(board.tracks) } : { vias: update(board.vias) }),
    }));
  }

  function setViaTenting(tenting: ViaTenting) {
    if (!selectedVia || selectedVia.locked) return;
    edit(() => session.commit({
      ...board,
      vias: board.vias.map((via) => via.id === selectedVia.id ? { ...via, tenting } : via),
    }));
  }

  async function previewCleanup() {
    if (!selectedNet || busy) return;
    setMeasuring(false);
    setMeasurement([]);
    await runCopperJob(
      (job) => job.cleanup(board, selectedNet),
      (result) => setCleanupDraft({ source: board, result }),
    );
  }

  function applyCleanup() {
    if (!cleanup) return;
    edit(() => {
      const result = session.commit(cleanup.board);
      setCleanupDraft(undefined);
      setSelectedRouteId('');
      return result;
    });
  }

  function selectQueueTarget(id: string) {
    selectComponent(id);
    setPlacementTool(id);
    setQueuePositionSet(false);
    setRotation('0');
    setSide('top');
  }

  function armPlacement(id: string, position?: BoardPoint) {
    if (busy || routing || measuring || trackEdit || deletionDraft || cleanup) return;
    const existing = board.footprints?.find(({ componentId }) => componentId === id);
    if (existing) {
      if (existing.locked || existing.positionLocked) return;
      selectComponent(id);
      setPlacementTool(id);
      return;
    }
    if (!placeable.has(id)) return;
    selectQueueTarget(id);
    if (position) {
      setX(mm(position.x));
      setY(mm(position.y));
      setQueuePositionSet(true);
    }
  }

  function cancelPlacement() {
    if (busy) return;
    setPlacementTool(undefined);
    setSequentialPlacement(false);
    setError('');
  }

  function startSequentialPlacement(ids: readonly string[]) {
    const available = ids.filter((id) => placeable.has(id));
    if (!available.length) {
      setSequentialPlacement(false);
      setError('The selected packages are no longer available for placement.');
      return;
    }
    setFootprintTab('unplaced');
    onToggleFootprints(true);
    setPlacementQueue(available);
    selectQueueTarget(available[0]);
    setSequentialPlacement(true);
  }

  function togglePlacementLock(
    field: 'locked' | 'positionLocked' | 'rotationLocked',
  ) {
    if (!selectedPlacement) return;
    const enabled = !selectedPlacement[field];
    edit(() =>
      session.commit({
        ...board,
        footprints: board.footprints.map(
          (placement): BoardFootprint =>
            placement.id === selectedPlacement.id
              ? { ...placement, [field]: enabled }
              : placement,
        ),
      }),
    );
    if (!enabled) return;
    if (field !== 'rotationLocked') {
      setX(mm(selectedPlacement.positionNm.x));
      setY(mm(selectedPlacement.positionNm.y));
    }
    if (field !== 'positionLocked')
      setRotation(mm(selectedPlacement.rotationMicrodegree));
    if (field === 'locked') setSide(selectedPlacement.side);
  }

  async function place(position?: BoardPoint) {
    if (
      !target ||
      busy ||
      routing ||
      measuring ||
      (sequentialPlacement && !queuePositionSet && !position)
    )
      return;
    setBusy(true);
    setError('');
    try {
      const placement = placementFromInputs(position);
      const next = await session.place(target.id, placement);
      setBoard(next);
      setPlacementTool(undefined);
      setX(mm(placement.positionNm.x));
      setY(mm(placement.positionNm.y));
      if (sequentialPlacement) {
        const remaining = queue.filter((id) => id !== target.id);
        setPlacementQueue(remaining);
        if (remaining.length) {
          selectQueueTarget(remaining[0]);
          setSequentialPlacement(true);
        } else {
          setSequentialPlacement(false);
        }
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  function edit(change: () => typeof board) {
    setError('');
    try {
      setBoard(change());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function save(saveAs = false) {
    if (busy || (saveAs && !session.canSaveAs)) return;
    setBusy(true);
    setError('');
    try {
      await session.save(saveAs);
      setFilename(session.path);
    } catch (failure) {
      if (failure && (failure as Error).name !== 'AbortError')
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    if (!activeCommands) return;
    const onSave = (event: CustomEvent<boolean>) => {
      event.preventDefault();
      void save(event.detail);
    };
    const onHistory = (event: CustomEvent<'undo' | 'redo'>) => {
      event.preventDefault();
      if (!busy) edit(event.detail === 'undo' ? session.undo : session.redo);
    };
    const onZoom = (event: CustomEvent<'in' | 'out'>) => {
      event.preventDefault();
      boardCanvas.current?.zoom(event.detail);
    };
    window.addEventListener(boardZoomCommand, onZoom);
    window.addEventListener(saveActiveBoard, onSave);
    window.addEventListener(boardHistoryCommand, onHistory);
    return () => {
      window.removeEventListener(boardZoomCommand, onZoom);
      window.removeEventListener(saveActiveBoard, onSave);
      window.removeEventListener(boardHistoryCommand, onHistory);
    };
  });

  function openBoardMenu(
    point: { x: number; y: number },
    hit?: { componentId?: string; routeId?: string },
  ) {
    if (busy) return;
    if (placementTool) {
      cancelPlacement();
      return;
    }
    if (routing) {
      setRoutingMode(false);
      return;
    }
    if (trackEdit) {
      cancelTrackEdit();
      return;
    }
    if (pickingObjects) {
      setPickingObjects(false);
      return;
    }
    if (measuring || deletionDraft || cleanup) return;
    const componentId = hit ? hit.componentId : selected;
    const routeId = hit ? hit.routeId : selectedRouteId;
    if (hit?.componentId) selectComponent(hit.componentId);
    if (hit?.routeId) {
      selectComponent('');
      setSelectedRouteId(hit.routeId);
    }
    setBoardMenu({ point, componentId, routeId });
  }

  const boardMenuFootprint = boardMenu?.componentId
    ? board.footprints?.find(({ componentId }) => componentId === boardMenu.componentId)
    : undefined;
  const boardMenuItems: ContextMenuItem[] = [
    { key: 'undo', text: t('toolbar.contextMenu.undo'), disabled: !session.canUndo },
    { key: 'redo', text: t('toolbar.contextMenu.redo'), disabled: !session.canRedo },
    { key: 'divider_view', itemType: ContextualMenuItemType.Divider },
    { key: 'zoom_in', text: t('toolbar.contextMenu.zoomIn') },
    { key: 'zoom_out', text: t('toolbar.contextMenu.zoomOut') },
    { key: 'zoom_fit', text: 'Fit board' },
  ];
  if (boardMenuFootprint || boardMenu?.routeId) boardMenuItems.push({ key: 'fit_selection', text: 'Fit selection' });
  if (boardMenuFootprint && !boardMenuFootprint.locked && !boardMenuFootprint.positionLocked)
    boardMenuItems.unshift({ key: 'move_footprint', text: 'Move on board' });

  return (
    <section
      className="circuit-container pcb-workspace"
      aria-label="PCB layout"
      onKeyDown={(event) => {
        if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          const key = event.key.toLowerCase();
          const editingText = (event.target as Element).closest('input, textarea, [contenteditable="true"]');
          if (key === 's') {
            event.preventDefault();
            if (!busy) void save(event.shiftKey);
            return;
          }
          if (!editingText && (key === 'y' || key === 'z')) {
            event.preventDefault();
            if (!busy) edit(key === 'y' || event.shiftKey ? session.redo : session.undo);
            return;
          }
        }
        if (event.key === '+' || event.key === '-' || event.key === '=') {
          if ((event.target as Element).closest('.pcb-svg')) {
            event.preventDefault();
            boardCanvas.current?.zoom(event.key === '-' ? 'out' : 'in');
            return;
          }
        }
        if (event.key !== 'Escape') return;
        if (placementTool && !busy && !routing && !measuring) {
          cancelPlacement();
        } else if (pickingObjects) {
          setPickingObjects(false);
          event.preventDefault();
        } else if (routing) {
          setRoutingMode(false);
          routeToggle.current?.focus();
        }
        else if (trackEdit) cancelTrackEdit();
        else if (cleanup) setCleanupDraft(undefined);
        else return;
        event.preventDefault();
      }}
    >
      {boardMenu && (
        <AnchoredContextMenu hidden={false} target={boardMenu.point} items={boardMenuItems}
          onDismiss={() => setBoardMenu(undefined)}
          onItemClick={(command) => {
            setBoardMenu(undefined);
            requestAnimationFrame(() => boardCanvas.current?.focus());
            switch (command) {
              case 'undo': edit(session.undo); break;
              case 'redo': edit(session.redo); break;
              case 'zoom_in': boardCanvas.current?.zoom('in', boardMenu.point); break;
              case 'zoom_out': boardCanvas.current?.zoom('out', boardMenu.point); break;
              case 'zoom_fit': boardCanvas.current?.fit(); break;
              case 'fit_selection': fitSelection(); break;
              case 'move_footprint': armPlacement(boardMenu.componentId); break;
            }
          }} />
      )}
      <EditorToolbar className="pcb-toolbar" label="PCB commands">
        {process.env.TARGET_SYSTEM !== 'electron' && (
          <EditorFileMenu>
            <MenuItem icon={<DocumentAddRegular />} onClick={onNew}>New PCB</MenuItem>
            {process.env.TARGET_SYSTEM === 'filesystem' && (
              <MenuItem icon={<FolderOpenRegular />} onClick={onOpen}>{t('toolbar.open')}</MenuItem>
            )}
            {onProjectFolder && <MenuItem icon={<FolderOpenRegular />} onClick={onProjectFolder}>
              {t('projects.openFolder')}
            </MenuItem>}
            <MenuDivider />
            <MenuItem icon={<SaveRegular />} disabled={busy} onClick={() => { void save(); }}>
              {t('toolbar.save')}
            </MenuItem>
            {session.canSaveAs && <MenuItem icon={<SaveCopyRegular />} disabled={busy}
              onClick={() => { void save(true); }}>Save As…</MenuItem>}
          </EditorFileMenu>
        )}
        {process.env.TARGET_SYSTEM === 'electron' && (
          <Button appearance="subtle" icon={<DocumentAddRegular />} aria-label="New PCB"
            title="New PCB" onClick={onNew} />
        )}
        <EditorSaveButton disabled={busy} onClick={() => { void save(); }} />
        {session.canSaveAs && <EditorSaveButton saveAs label="Save As…" disabled={busy}
          onClick={() => { void save(true); }} />}
        <ToolbarDivider />
        <EditorHistoryControls compactLabels canUndo={!busy && session.canUndo} canRedo={!busy && session.canRedo}
          onUndo={() => edit(session.undo)} onRedo={() => edit(session.redo)} />
        <ToolbarDivider />
        <label>
          PCB view{' '}
          <select
            aria-label="PCB view"
            value={boardView}
            disabled={busy || routing}
            onChange={(event) =>
              changeBoardView(event.target.value as BoardView)
            }
          >
            <option value="engineering">Engineering</option>
            <option value="beginner">Beginner</option>
          </select>
        </label>
        <Button
          ref={guideToggle}
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen(!guideOpen)}
        >
          First board guide
        </Button>
        <Button disabled={!geometry} onClick={() => boardCanvas.current?.fit()}>
          Fit board
        </Button>
        <Button disabled={!geometry || (!routeSelection && !selectedFeatures.length)} onClick={fitSelection}>
          Fit selection
        </Button>
        <ViewToolbarControls
          canZoomIn={!!geometry}
          canZoomOut={!!geometry}
          showRulers={showRulers}
          onZoom={(direction) => boardCanvas.current?.zoom(direction)}
          onToggleRulers={() => setShowRulers(!showRulers)}
        />
        <Button appearance="subtle" icon={<PanelLeftExpandRegular />} aria-label="Toggle footprint browser"
          title="Toggle footprint browser" aria-pressed={footprintsVisible} onClick={() => onToggleFootprints(!footprintsVisible)} />
        <Button appearance="subtle" icon={<PanelRightExpandRegular />} aria-label="Toggle board tools"
          title="Toggle board tools" aria-pressed={showInspector} onClick={() => setShowInspector(!showInspector)} />
        <Button appearance="subtle" icon={<PanelBottomExpandRegular />} aria-label="Toggle board properties"
          title="Toggle board properties" aria-pressed={showProperties} onClick={() => setShowProperties(!showProperties)} />
        <Button
          ref={routeToggle}
          disabled={!routing && (busy || !board.nets?.length)}
          onClick={() => setRoutingMode(!routing)}
        >
          {routing ? 'Cancel route' : 'Route track'}
        </Button>
        {(!beginner || measuring) && (
          <Button
            disabled={busy || routing}
            onClick={() => {
              setDeleteRoute(undefined);
              setCleanupDraft(undefined);
              setTrackEditDraft(undefined);
              setMeasuring(!measuring);
              setMeasurement([]);
            }}
          >
            {measuring ? 'End measurement' : 'Measure distance'}
          </Button>
        )}

        <label>
          Show copper{' '}
          <select
            value={
              visibleCopper === 'bottom' && board.copperLayers.length === 1
                ? 'all'
                : visibleCopper
            }
            onChange={(event) =>
              setVisibleCopper(event.target.value as typeof visibleCopper)
            }
          >
            <option value="all">All layers</option>
            {board.copperLayers.map(({ id }) => (
              <option key={id} value={id}>
                {id === 'top' ? 'Top' : 'Bottom'}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy}
          onClick={() => {
            if (manageClose || !session.dirty) {
              onClose();
            } else if (window.confirm('Discard unsaved PCB edits?')) {
              setBusy(true);
              void session.discardRecovery().then(onClose, (error: Error) => {
                setError(error.message);
                setBusy(false);
              });
            }
          }}
        >
          Close
        </Button>
      </EditorToolbar>
      {footprintEditor && (
        <React.Suspense fallback={null}>
          <FootprintEditorDialog onClose={() => setFootprintEditor(false)} />
        </React.Suspense>
      )}
      {fabricationOpen && (
        <BoardFabricationDialog
          board={board}
          advanced={!beginner}
          onClose={() => setFabricationOpen(false)}
          onApply={(operations) => setBoard(session.apply(operations))}
        />
      )}
      {ruleInspectionOpen && (
        <React.Suspense fallback={null}>
          <BoardRuleInspectionDialog board={board} zones={derivedResult?.zones}
            selectedCopperId={selectedRouteId || (selectedPad && selectedPlacement
              ? selectedPlacement.id + ':' + selectedPad : undefined)}
            selectedLayer={visibleCopper === 'all' ? undefined : visibleCopper}
            onClose={() => setRuleInspectionOpen(false)} />
        </React.Suspense>
      )}
      {netRulesOpen && (
        <BoardNetRulesDialog
          board={board}
          selectedNet={selectedNet}
          onClose={() => setNetRulesOpen(false)}
          onApply={(operation) => setBoard(session.apply([operation]))}
        />
      )}
      {connectionsOpen && !board.sourceCircuit && !session.circuit && (
        <BoardConnectionsDialog
          board={board}
          selected={selected}
          onCommit={(candidate) => setBoard(session.commit(candidate))}
          onClose={() => setConnectionsOpen(false)}
        />
      )}
      {inspectionOpen && (
        <React.Suspense fallback={<p role="status">Loading 3D viewer…</p>}>
          <BoardInspectionDialog
            board={board}
            selected={selected}
            onClose={() => setInspectionOpen(false)}
            onInspect={(id) => {
              selectComponent(id);
              setInspectionOpen(false);
            }}
          />
        </React.Suspense>
      )}
      {camOpen && (
        <React.Suspense fallback={<p role="status">Loading CAM preview…</p>}>
          <BoardCamDialog
            board={board}
            projectId={session.projectId}
            readProjectCircuit={session.readProjectCircuit}
            waitForRefill={waitForRefill}
            onChecked={setCheckedRevision}
            onClose={() => setCamOpen(false)}
          />
        </React.Suspense>
      )}
      {kicadOpen && (
        <React.Suspense fallback={<p role="status">Loading KiCad export…</p>}>
          <KicadExportDialog
            board={board}
            filename={filename}
            onClose={() => setKicadOpen(false)}
          />
        </React.Suspense>
      )}
      {kicadReviewOpen && (
        <React.Suspense fallback={<p role="status">Loading KiCad board review…</p>}>
          <KicadBoardReviewDialog onClose={() => setKicadReviewOpen(false)} />
        </React.Suspense>
      )}
      {revisionOpen && (
        <React.Suspense fallback={<p role="status">Loading manufacturing revisions…</p>}>
          <BoardRevisionDialog
            board={board}
            session={session}
            onCreated={(next) => {
              setBoard(next);
              setRevisionOpen(false);
            }}
            onClose={() => setRevisionOpen(false)}
          />
        </React.Suspense>
      )}
      {checksOpen && (
        <BoardChecksDialog
          board={board}
          readProjectCircuit={session.readProjectCircuit}
          waitForRefill={waitForRefill}
          filename={filename}
          onChecked={setCheckedRevision}
          onClose={() => setChecksOpen(false)}
          onWaive={(waiver) =>
            edit(() => session.apply([{ type: 'addWaiver', waiver }]))
          }
          onRemoveWaiver={(id) =>
            edit(() => session.apply([{ type: 'removeWaiver', id }]))
          }
          onProbe={onProbe && ((source) => {
            setChecksOpen(false);
            onProbe(source);
          })}
          onInspect={({ objects, location }) => {
            setChecksOpen(false);
            setVisibleCopper('all');
            const keys = new Set(objects.map((id) => id.split('/')[0]));
            const component = board.components?.find(
              ({ id }) =>
                keys.has(id) ||
                objects.some((source) => source.startsWith(id + ':')),
            );
            const placement = board.footprints?.find(({ id, componentId }) =>
              component?.id === componentId || keys.has(id) ||
              objects.some((source) => source.startsWith(id + ':')),
            );
            const track = board.tracks?.find(({ id }) => keys.has(id));
            const via = board.vias?.find(
              ({ id }) =>
                keys.has(id) ||
                objects.some((source) => source.startsWith(id + ':')),
            );
            if (component || placement) {
              const padId = placement && objects
                .find((id) => id.startsWith(placement.id + ':'))?.split(':')[1];
              selectComponent(component?.id ?? placement.componentId, padId);
            }
            if (track || via) {
              setSelectedRouteId(track?.id ?? via.id);
              setSelectedNet(track?.netId ?? via?.netId ?? '');
            }
            const hole = board.mechanicalHoles?.find(({ id }) => keys.has(id));
            const jumper = board.jumpers?.find(({ id }) =>
              keys.has(id) || objects.some((source) => source.startsWith(id + ':')));
            const zone = board.zones?.find(({ id }) => keys.has(id));
            const issueLocation = location ?? track?.start ?? via?.positionNm ??
              placement?.positionNm ?? hole?.start ?? jumper?.start;
            setCheckMarker({ board, location: issueLocation });
            if (issueLocation) boardCanvas.current?.fit([issueLocation]);
            else if (zone) boardCanvas.current?.fit(zone.outline);
            requestAnimationFrame(() => boardCanvas.current?.focus());
          }}
        />
      )}
      {jumperDialog && (
        <WireJumperDialog
          board={board}
          jumper={jumperDialog === 'new' ? undefined : jumperDialog}
          onApply={(jumper) =>
            setBoard(session.apply([{ type: 'setWireJumper', jumper }]))
          }
          onClose={() => setJumperDialog(undefined)}
        />
      )}
      {zoneDialog && geometry && (
        <BoardZoneDialog
          board={board}
          zone={zoneDialog === 'new' ? undefined : zoneDialog}
          defaultOutline={geometry.profile.outer}
          selectedNet={selectedNet}
          onClose={() => setZoneDialog(undefined)}
          onApply={(zone) =>
            setBoard(session.apply([{ type: 'setZone', zone }]))
          }
        />
      )}
      {objectPick && <BoardPickDialog pick={objectPick}
        onSelect={selectPickedObject} onClose={() => setObjectPick(undefined)} />}
      {placementAreaDialog && (
        <PlacementAreaDialog
          area={placementAreaDialog === 'new' ? undefined : placementAreaDialog}
          onApply={(area) =>
            setBoard(session.apply([{ type: 'setPlacementArea', area }]))
          }
          onClose={() => setPlacementAreaDialog(undefined)}
        />
      )}
      {routingRegionDialog && (
        <RoutingRegionDialog
          board={board}
          region={routingRegionDialog === 'new' ? undefined : routingRegionDialog}
          onApply={(region) => setBoard(session.apply([{ type: 'setRoutingRegion', region }]))}
          onClose={() => setRoutingRegionDialog(undefined)}
        />
      )}
      {annotationDraft && (
        <BoardAnnotationDialog
          draft={annotationDraft}
          datum={datum}
          onClose={() => setAnnotationDraft(undefined)}
          onApply={(annotation) => {
            if (annotation.type === 'datum') {
              setBoard(changeAnnotations(annotation.point, dimensions));
              return;
            }
            const dimension = annotation.dimension;
            const next = dimensions.some(({ id }) => id === dimension.id)
              ? dimensions.map((item) => item.id === dimension.id ? dimension : item)
              : [...dimensions, dimension];
            setBoard(changeAnnotations(datum, next));
            setMeasuring(false);
            setMeasurement([]);
          }}
        />
      )}
      {holeDialog && (
        <BoardHoleDialog
          x={x}
          y={y}
          onClose={() => setHoleDialog(false)}
          onApply={(hole) =>
            setBoard(session.apply([{ type: 'addMechanicalHole', hole }]))
          }
        />
      )}
      {profileDialog !== undefined && (
        <BoardProfileDialog
          board={board}
          cutout={profileDialog !== 'outline'}
          cutoutIndex={typeof profileDialog === 'number' ? profileDialog : undefined}
          onClose={() => setProfileDialog(undefined)}
          onApply={(profile) =>
            setBoard(session.apply([{ type: 'replaceProfile', profile }]))
          }
        />
      )}
      <div className="pcb-content">
        <p className="pcb-document-status">
          {filename}
          {session.dirty ? ' · Unsaved' : ''}
          {syncStatus ? ' · ' + syncStatus : ''}
        </p>
        {recoveryStatus.kind !== 'idle' && (
          <p role="status" className="pcb-document-status">
            {recoveryStatus.kind === 'pending'
              ? 'Saving PCB recovery…'
              : recoveryStatus.kind === 'saved'
              ? `Recovery saved for PCB revision ${recoveryStatus.revision}.`
              : 'PCB recovery unavailable. ' + recoveryStatus.message}
          </p>
        )}
        <div className="pcb-editor-grid" style={{
          gridTemplateColumns: [
            footprintsVisible ? `minmax(0, min(${footprintsWidth}px, 27%))` : '0',
            'minmax(0, 1fr)',
            showInspector ? `minmax(0, min(${inspectorWidth}px, 28%))` : '0',
          ].join(' '),
        }}>
          <aside className="pcb-editor-side pcb-footprints" aria-label="Footprints" hidden={!footprintsVisible}>
            <ResizeHandle direction="horizontal" label="Resize footprint browser"
              onResize={(delta) => setFootprintsWidth((width) => Math.max(128, Math.min(440, width + delta)))} />
            <TabList size="small" selectedValue={footprintTab} aria-label="Footprints"
              onTabSelect={(_, { value }) => setFootprintTab(value === 'library' ? 'library' : 'unplaced')}>
              <Tab id={footprintTabId + '-unplaced-tab'} aria-controls={footprintTabId + '-unplaced'} value="unplaced">Unplaced</Tab>
              <Tab id={footprintTabId + '-library-tab'} aria-controls={footprintTabId + '-library'} value="library">Library</Tab>
            </TabList>
            <div role="tabpanel" id={footprintTabId + '-unplaced'} aria-labelledby={footprintTabId + '-unplaced-tab'}
              className="pcb-panel-scroll" hidden={footprintTab !== 'unplaced'}>
              <BoardPlacementTray
                parts={unplaced}
                searchInput={placementSearch}
                devices={board.deviceDefinitions ?? []}
                definitions={board.footprintDefinitions ?? []}
                selected={selected}
                queued={queue}
                sequential={sequentialPlacement}
                disabled={busy || routing || measuring}
                onSelect={selectComponent}
                onPlace={armPlacement}
                onToggle={(id) =>
                  setPlacementQueue(
                    queue.includes(id)
                      ? queue.filter((item) => item !== id)
                      : [...queue, id],
                  )
                }
                onStart={() => startSequentialPlacement(queue)}
                onStop={cancelPlacement}
              />
            </div>
            <div role="tabpanel" id={footprintTabId + '-library'} aria-labelledby={footprintTabId + '-library-tab'}
              className="pcb-panel-scroll" hidden={footprintTab !== 'library'}>
              <Button size="small" onClick={() => setFootprintEditor(true)}>Footprint editor…</Button>
              {!!board.footprintDefinitions?.length && (
                <label className="pcb-library-choice">
                  Board footprints
                  <select value={libraryFootprintId} onChange={(event) => setLibraryFootprintId(event.target.value)}>
                    <option value="">Choose a footprint</option>
                    {board.footprintDefinitions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
              {libraryFootprint && <DeviceFootprintPreview footprint={libraryFootprint} selected="" />}
            </div>
          </aside>
          {geometry ? (
            <BoardCanvas
              board={board}
              geometry={geometry}
              canvasRef={boardCanvas}
              onPick={pickingObjects && canPickObjects
                ? (pick) => { setPickingObjects(false); setObjectPick(pick); } : undefined}
              selectedSilk={selectedSilk?.id}
              selected={selected}
              group={groupSelection}
              selectedPad={selectedPad}
              selectedNet={selectedNet}
              route={route}
              airwires={derivedResult?.airwires}
              zoneFills={derivedResult?.zones.fills}
              checkMarker={
                checkMarker?.board === board ? checkMarker.location : undefined
              }
              measurement={measurement}
              trackEdit={trackEditPreview && {
                handle: trackEditPreview.handle,
                pieces: trackEditPreview.pieces,
                move: (x, y) => { if (!busy) moveTrackHandle(canvasPosition(x, y)); },
              }}
              deletion={cleanup ? { tracks: cleanup.loops, pickingRegion: false } : deletion && {
                tracks: deletion.plan?.tracks, vias: deletion.plan?.vias, corners: deletion.corners,
                pickingRegion: !!regionPicking,
              }}
              onMeasure={measuring && !busy ? measureAt : undefined}
              showRulers={showRulers}
              placementActive={!busy && !routing && !measuring && !!placementTool && placementTool === target?.id}
              placementPreview={currentPlacementPreview()}
              onDropComponent={!busy && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup
                ? (id, x, y) => armPlacement(id, canvasPosition(x, y)) : undefined}
              onContextCommand={openBoardMenu}
              visibleCopper={
                routing
                  ? layer
                  : visibleCopper === 'bottom' &&
                    board.copperLayers.length === 1
                  ? 'all'
                  : visibleCopper
              }
              trackWidthNm={Number(canonicalBoardDecimal(routeWidth)) * 1_000_000 || 0}
              onLocation={(x, y) => {
                if (busy) return;
                const location = canvasPosition(x, y);
                if (regionPicking) chooseRegionPoint(location);
                else if (deletionDraft || cleanup) return;
                else if (trackEdit) moveTrackHandle(location);
                else if (routing) void routePoint(location);
                else if (measuring) measureAt(location);
                else if (placementTool && placementTool === target?.id) void place(location);
              }}
              routingSnap={routing ? {
                layer,
                activeNet: route.length ? selectedNet : undefined,
                connect: ({ position, netId }) => { void routePoint(position, netId); },
                preview: (x, y, target) => previewRouteLeg(target ?? canvasPosition(x, y)),
              } : undefined}
              onComponent={(id) => { if (!deletionDraft && !cleanup) selectComponent(id); }}
              onGroupComponent={
                beginner || routing || measuring || deletionDraft || cleanup
                  ? undefined
                  : (id) => toggleGroupComponent(id, true)
              }
              onPad={(componentId, id, position) => {
                if (deletionDraft || cleanup) return;
                if (measuring) measureAt(position);
                else if (trackEdit) moveTrackHandle(position);
                else selectComponent(componentId, id);
              }}
              onRouteObject={(id, netId, point) => {
                if (routing || trackEdit || deletionDraft || cleanup) return;
                pickedRoute.current = point ? { id, point } : undefined;
                setSelectedRouteId(id);
                setSelectedNet(netId ?? '');
                setSelectedSilk(undefined);
              }}
            />
          ) : (
            <p role="alert">{layout.error}</p>
          )}
          <aside className="pcb-editor-side pcb-inspector" aria-label="Board tools" hidden={!showInspector}>
            <ResizeHandle direction="horizontal" edge="start" label="Resize board tools"
              onResize={(delta) => setInspectorWidth((width) => Math.max(128, Math.min(440, width - delta)))} />
            <div className="pcb-panel-scroll">
            <h3 className="pcb-panel-heading">Board tools</h3>
            <div className="pcb-setup-controls">
              {!beginner && <Button disabled={!canPickObjects}
                aria-pressed={pickingObjects} onClick={() => setPickingObjects(!pickingObjects)}>
                Pick overlapping objects
              </Button>}
              <Button disabled={busy} onClick={() => setProfileDialog('outline')}>
                Board outline…
              </Button>
              {!beginner && (
                <Button disabled={busy} onClick={() => setProfileDialog('cutout')}>
                  Add cutout…
                </Button>
              )}
              <label>
                Copper layers{' '}
                <select
                  value={board.copperLayers.length}
                  disabled={busy}
                  onChange={(event) => {
                    const count = event.target.value === '1' ? 1 : 2;
                    edit(() => session.apply([{ type: 'setCopperLayers', count }]));
                  }}
                >
                  <option value="1">One</option>
                  <option value="2">Two</option>
                </select>
              </label>
              {!beginner && (
                <Button disabled={busy} onClick={() => setHoleDialog(true)}>
                  Hole or slot…
                </Button>
              )}
              {onUpdate && (
                <Button disabled={busy || session.dirty} onClick={onUpdate}>
                  Update PCB from Schematic…
                </Button>
              )}
              {!beginner && onEditReferences && (
                <Button
                  disabled={busy || session.dirty || !board.components?.length}
                  onClick={onEditReferences}
                >
                  Edit PCB references…
                </Button>
              )}
              {!beginner && onBackAnnotate && (
                <Button
                  disabled={busy || session.dirty || !session.circuit}
                  onClick={onBackAnnotate}
                >
                  Update Schematic from PCB…
                </Button>
              )}
            </div>
            {pickingObjects && <p role="status">Click the board to list objects under the pointer.</p>}
            {selectedSilk && <p>Selected silkscreen · {selectedSilk.label} · {selectedSilk.layer}</p>}
            {guideOpen && (
              <FirstBoardGuide
                step={guideStep}
                onStepChange={setGuideStep}
                onClose={() => {
                  setGuideOpen(false);
                  guideToggle.current?.focus();
                }}
                onUpdate={onUpdate}
                onOutline={() => setProfileDialog('outline')}
                onFabrication={() => setFabricationOpen(true)}
                onPlacement={() => {
                  setFootprintTab('unplaced');
                  onToggleFootprints(true);
                  requestAnimationFrame(() => placementSearch.current?.focus());
                }}
                onRouting={() => setRoutingMode(true)}
                onChecks={() => setChecksOpen(true)}
                onPreview={() => setCamOpen(true)}
                components={board.components?.length ?? 0}
                unplaced={unplaced.length}
                withoutDevices={unplaced.length - placeable.size}
                hasNets={!!board.nets?.length}
                routing={routing}
                measuring={measuring}
                busy={busy}
                dirty={session.dirty}
                geometryAvailable={!!geometry}
              />
            )}

            {!beginner && (
              <label>
                Grid (mm)
                <input
                  size={5}
                  value={snapGrid}
                  onChange={(event) => setSnapGrid(event.target.value)}
                />
              </label>
            )}
            {measuring && (
              <div>
                <p role="status">
                  {measurement.length === 2
                    ? 'Distance ' +
                      (
                        Math.hypot(
                          measurement[0].x - measurement[1].x,
                          measurement[0].y - measurement[1].y,
                        ) / 1_000_000
                      ).toFixed(3) +
                      ' mm'
                    : measurement.length === 1
                    ? 'Pick the end point.'
                    : 'Pick the start point.'}
                </p>
                {measurement.length === 2 && (
                  <Button size="small" disabled={busy} onClick={() => addDimension(measurement)}>
                    Save measurement as dimension…
                  </Button>
                )}
              </div>
            )}
            {!beginner && !routing && (
              <details>
                <summary>Dimensions and datum</summary>
                <Button size="small" disabled={busy} onClick={() => addDimension()}>Add dimension…</Button>
                <Button size="small" disabled={busy}
                  onClick={() => setAnnotationDraft({ type: 'datum', point: datum ?? { x: 0, y: 0 } })}>
                  Set measurement datum…
                </Button>
                {datum && (
                  <p>
                    Datum at X {mm(datum.x)} mm, Y {mm(datum.y)} mm{' '}
                    <Button size="small" disabled={busy} onClick={() => edit(() => changeAnnotations(undefined, dimensions))}>
                      Reset datum
                    </Button>
                  </p>
                )}
                {dimensions.length > 0 && (
                  <ul aria-label="Board dimensions">
                    {dimensions.map((dimension) => (
                      <li key={dimension.id}>
                        <Button size="small" disabled={busy}
                          onClick={() => setAnnotationDraft({ type: 'dimension', dimension })}>
                          Edit {dimensionText(dimension)}…
                        </Button>
                        <Button size="small" disabled={busy}
                          aria-label={'Remove ' + dimensionText(dimension)}
                          onClick={() => edit(() => changeAnnotations(datum, dimensions.filter(({ id }) => id !== dimension.id)))}>
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            {routing && (
              <fieldset disabled={busy}>
                <legend>Manual route</legend>
                <p>
                  Pick copper to connect or click empty space to set a corner. Red previews show blocked routes.
                  Choose another layer to switch at the last corner.
                </p>
                <div role="status" aria-label="Route clearance">
                  {!selectedNet || routeClearance ? '' : routeClearanceError
                    ? 'Route preview unavailable. ' + routeClearanceError
                    : 'Preparing route clearance…'}
                </div>
                {routeClearanceError && (
                  <Button onClick={() => {
                    routeLayerControl.current?.focus();
                    setClearanceDraft(undefined);
                    setClearanceAttempt((attempt) => attempt + 1);
                  }}>
                    Retry route preview
                  </Button>
                )}
                <details>
                  <summary>Enter route coordinates</summary>
                  <form className="pcb-waypoint-entry" onSubmit={enterRoutePoint}>
                    <label>
                      Waypoint X (mm)
                      <input name="x" size={7} inputMode="decimal" required />
                    </label>
                    <label>
                      Waypoint Y (mm)
                      <input name="y" size={7} inputMode="decimal" required />
                    </label>
                    <Button type="submit" disabled={!selectedNet}>
                      Add waypoint
                    </Button>
                  </form>
                  <p role="status" aria-label="Route waypoints">
                    {route.length
                      ? 'Last point at X ' + mm(route.at(-1).position.x) +
                        ' mm, Y ' + mm(route.at(-1).position.y) + ' mm.'
                      : 'Choose a starting point.'}
                  </p>
                </details>
                {!beginner && (
                  <label>
                    Route bend
                    <select value={routeBend} onChange={(event) => setRouteBend(event.target.value as RouteBend)}>
                      <option value="straight-first">Straight first</option>
                      <option value="diagonal-first">Diagonal first</option>
                    </select>
                  </label>
                )}
                <label>
                  Route layer
                  <select
                    ref={routeLayerControl}
                    value={layer}
                    onChange={(event) =>
                      changeRouteLayer(event.target.value as CopperLayer['id'])
                    }
                  >
                    {board.copperLayers.map(({ id }) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                {beginner ? (
                  <p>
                    Track width {routeWidth} mm
                    {board.copperLayers.length === 2 && (
                      <>
                        {' '}
                        · Via diameter {mm(teachingRoute.viaDiameterNm)} mm ·
                        Drill {mm(teachingRoute.viaDrillNm)} mm
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    <label>
                      Track width preset
                      <select value={widthPreset} onChange={(event) => {
                        setTrackWidth(routeWidth);
                        setWidthPreset(event.target.value as WidthPreset);
                      }}>
                        <option value="minimum">Minimum ({mm(routeRules.minWidthNm)} mm)</option>
                        <option value="preferred">Preferred ({mm(preferredWidth)} mm)</option>
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {widthPreset === 'custom' && <label>
                      Track width (mm)
                      <input size={6} value={trackWidth} onChange={(event) => setTrackWidth(event.target.value)} />
                    </label>}
                    {routeRules.maxWidthNm !== undefined && <p>Maximum track width {mm(routeRules.maxWidthNm)} mm</p>}
                    {board.copperLayers.length === 2 && (
                      <>
                        <label>
                          Through-via style
                          <select value={viaStyle} onChange={(event) => {
                            if (viaStyle !== 'custom') {
                              setViaDiameter(mm(viaPresets[viaStyle].viaDiameterNm));
                              setViaDrill(mm(viaPresets[viaStyle].viaDrillNm));
                            }
                            setViaStyle(event.target.value as ViaStyle);
                          }}>
                            <option value="compact">Compact ({mm(viaPresets.compact.viaDiameterNm)} mm diameter, {mm(viaPresets.compact.viaDrillNm)} mm drill)</option>
                            <option value="preferred">Preferred ({mm(viaPresets.preferred.viaDiameterNm)} mm diameter, {mm(viaPresets.preferred.viaDrillNm)} mm drill)</option>
                            <option value="custom">Custom</option>
                          </select>
                        </label>
                        {viaStyle === 'custom' && (
                          <>
                            <label>
                              Via diameter (mm)
                              <input size={6} value={viaDiameter} onChange={(event) => setViaDiameter(event.target.value)} />
                            </label>
                            <label>
                              Via drill (mm)
                              <input size={6} value={viaDrill} onChange={(event) => setViaDrill(event.target.value)} />
                            </label>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
                <Button
                  disabled={route.length < 2}
                  onClick={(): void => {
                    void finishRoute();
                  }}
                >
                  Finish route
                </Button>
                <div role="status" data-copper-edit-pending={busy || undefined}>
                  {busy ? t('pcbChecks.checkingCopper') : ''}
                </div>
              </fieldset>
            )}
            {trackEdit && (
              <fieldset>
                <legend>{trackEdit.action.kind === 'drag' ? 'Drag segment' : 'Move corner'}</legend>
                <p>Drag the handle on the board or enter coordinates.</p>
                <label>
                  Handle X (mm)
                  <input size={6} value={trackEdit.x} disabled={busy}
                    onChange={(event) => setTrackEditDraft({ ...trackEdit, x: event.target.value })} />
                </label>
                <label>
                  Handle Y (mm)
                  <input size={6} value={trackEdit.y} disabled={busy}
                    onChange={(event) => setTrackEditDraft({ ...trackEdit, y: event.target.value })} />
                </label>
                <Button onClick={cancelTrackEdit}>Cancel track edit</Button>
                <Button disabled={busy || !trackEditPreview?.action} onClick={() => { void applyTrackEdit(); }}>
                  Apply track edit
                </Button>
                <div role="status" data-copper-edit-pending={busy || undefined}>
                  {busy ? t('pcbChecks.checkingCopper') : ''}
                </div>
              </fieldset>
            )}
            {!routing && !trackEdit && !deletionDraft && !cleanup && routeSelection && (
              <fieldset disabled={busy}>
                <legend>
                  {selectedTrack ? 'Selected track' : 'Selected via'}
                </legend>
                {selectedVia && !beginner && (
                  <label>
                    Via solder mask
                    <select
                      value={selectedVia.tenting ?? 'both'}
                      disabled={selectedVia.locked}
                      onChange={(event) => setViaTenting(event.target.value as ViaTenting)}
                    >
                      <option value="both">Tent both sides</option>
                      <option value="top">Tent top only</option>
                      <option value="bottom">Tent bottom only</option>
                      <option value="none">Expose both sides</option>
                    </select>
                  </label>
                )}
                {!beginner && selectedTrack && (
                  <>
                    <Button disabled={selectedTrack.locked} onClick={splitTrack}>Split track</Button>
                    <Button disabled={!selectedTrack.netId} onClick={beginBranch}>Branch from track</Button>
                    <Button disabled={!selectedTrack.netId || selectedTrack.locked} onClick={() => beginTrackEdit()}>Drag segment</Button>
                    {(['start', 'end'] as const).map((endpoint) => (
                      <Button key={endpoint} disabled={!selectedTrack.netId || !cornerTrack(board, selectedTrack, endpoint)}
                        onClick={() => beginTrackEdit(endpoint)}>
                        Move {endpoint} corner
                      </Button>
                    ))}
                    <Button
                      disabled={!selectedTrack.netId || selectedTrack.locked}
                      onClick={beginReroute}
                    >
                      Reroute track
                    </Button>
                  </>
                )}
                {!beginner && (
                  <Button onClick={toggleRoutingLock}>
                    {routeSelection.locked ? 'Unlock' : 'Lock'} {selectedTrack ? 'track' : 'via'}
                  </Button>
                )}
                <Button disabled={routeSelection.locked} onClick={() => previewDeletion({ kind: 'item', id: selectedRouteId })}>
                  Delete selected copper…
                </Button>
                {!beginner && selectedTrack?.netId && !selectedTrack.locked && (
                  <Button onClick={() => previewDeletion({
                    kind: 'connection', trackId: selectedTrack.id,
                    picked: pickedRoute.current?.id === selectedTrack.id ? pickedRoute.current.point : undefined,
                  })}>Delete connection…</Button>
                )}
              </fieldset>
            )}
            {!beginner &&
              !routing &&
              !trackEdit &&
              !deletionDraft &&
              !cleanup &&
              selectedNet &&
              [...(board.tracks ?? []), ...(board.vias ?? [])].some(
                ({ netId }) => netId === selectedNet,
              ) && (
                <Button disabled={busy} onClick={() => previewDeletion({ kind: 'net', netId: selectedNet })}>
                  Delete routed net…
                </Button>
              )}
            {!beginner && !routing && !trackEdit && !deletionDraft && !cleanup &&
              (!!board.tracks?.length || !!board.vias?.length) && (
                <Button disabled={busy} onClick={() => previewDeletion({
                  kind: 'region', start: { x: '', y: '' }, end: { x: '', y: '' },
                  layer: board.copperLayers.length === 1 ? 'top' : visibleCopper,
                  picking: 'start',
                })}>Delete region…</Button>
              )}
            {!beginner && !routing && !trackEdit && !deletionDraft && !cleanup &&
              selectedNet && board.tracks?.some(({ netId, locked, reviewRequired }) =>
                netId === selectedNet && !locked && !reviewRequired) && (
                <Button disabled={busy} onClick={() => { void previewCleanup(); }}>Clean up routed net…</Button>
              )}
            {cleanup && (
              <fieldset aria-label="Routing cleanup preview" disabled={busy}>
                <legend>Routing cleanup preview</legend>
                <p role="status">
                  {cleanup.merged || cleanup.duplicates || cleanup.loops.length
                    ? `Merge ${cleanup.merged} collinear ${cleanup.merged === 1 ? 'join' : 'joins'}, remove ${cleanup.duplicates} ${cleanup.duplicates === 1 ? 'duplicate' : 'duplicates'} and ${cleanup.loops.length} redundant loop ${cleanup.loops.length === 1 ? 'segment' : 'segments'}.`
                    : 'No redundant tracks found for this net.'}
                </p>
                <Button onClick={() => setCleanupDraft(undefined)}>Cancel cleanup</Button>
                <Button appearance="primary" disabled={!cleanup.merged && !cleanup.duplicates && !cleanup.loops.length}
                  onClick={applyCleanup}>Apply cleanup</Button>
              </fieldset>
            )}
            {deletionDraft && (
              <RouteDeletionPanel
                draft={deletionDraft} layers={board.copperLayers} plan={deletion?.plan}
                error={deletion?.error} busy={busy}
                netName={deletionDraft.kind === 'net' ? board.nets?.find(({ id }) => id === deletionDraft.netId)?.name : undefined}
                onRegion={(draft) => setDeleteRoute({ source: board, draft })}
                onCancel={() => setDeleteRoute(undefined)}
                onConfirm={deleteSelectedRoute}
              />
            )}
            {!beginner && !!board.mechanicalHoles?.length && (
              <>
                <h3>Holes and slots</h3>
                <ol>
                  {board.mechanicalHoles.map(({ id }, index) => (
                    <li key={id}>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                          edit(() =>
                            session.apply([
                              { type: 'removeMechanicalHole', id },
                            ]),
                          )
                        }
                      >
                        Remove hole or slot {index + 1}
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {!beginner && !!board.profile?.cutouts.length && (
              <>
                <h3>Board cutouts</h3>
                <ol>
                  {board.profile.cutouts.map((_, index) => (
                    <li key={index}>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => setProfileDialog(index)}
                      >
                        Edit cutout {index + 1}…
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() =>
                          edit(() => {
                            const profile = editableProfile(board);
                            return session.apply([
                              {
                                type: 'replaceProfile',
                                profile: {
                                  ...profile,
                                  cutouts: profile.cutouts.filter(
                                    (_, i) => i !== index,
                                  ),
                                },
                              },
                            ]);
                          })
                        }
                      >
                        Remove cutout {index + 1}
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {!board.sourceCircuit && !session.circuit && (
              <Button
                disabled={busy || routing || !!deletionDraft || !!cleanup}
                onClick={() => setConnectionsOpen(true)}
              >
                Board connections…
              </Button>
            )}
            {!!board.nets?.length && (
              <label>
                Board net{' '}
                <select
                  aria-label="Board net"
                  style={{ maxWidth: '100%' }}
                  value={selectedNet}
                  disabled={route.length > 0 || !!deletionDraft || !!cleanup}
                  onChange={(event) => setSelectedNet(event.target.value)}
                >
                  <option value="">Choose a net</option>
                  {board.nets.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedNet &&
              (netSources.length ? (
                <>
                  <h3>Schematic net terminals</h3>
                  <ul aria-label="Schematic net terminals">
                    {netSources.map(
                      ({ id, reference, signal, number, source }) => (
                        <li key={id}>
                          <Button
                            size="small"
                            onClick={() => onProbe?.(source)}
                          >
                            {reference} · {signal}
                            {number ? ' · ' + number : ''}
                          </Button>
                        </li>
                      ),
                    )}
                  </ul>
                </>
              ) : (
                <p role="status">
                  No schematic terminals are linked to this board net.
                </p>
              ))}
            {!beginner && (
              <Button disabled={busy || routing || !geometry} onClick={() => setRuleInspectionOpen(true)}>
                Inspect board rules…
              </Button>
            )}
            <Button
              disabled={busy || routing || !geometry}
              onClick={() => setChecksOpen(true)}
            >
              {t('pcbChecks.run')}
            </Button>
            {checkedRevision !== undefined && checkedRevision !== board.revision && (
              <p role="status">Design checks are stale.</p>
            )}
            <Button
              disabled={busy || routing}
              onClick={() => setFabricationOpen(true)}
            >
              Fabrication settings…
            </Button>
            {!beginner && (
              <Button disabled={busy || routing} onClick={() => setNetRulesOpen(true)}>
                Net rules…
              </Button>
            )}
            <Button
              disabled={busy || routing || !geometry}
              onClick={() => setCamOpen(true)}
            >
              CAM read-back preview…
            </Button>
            {!beginner && (
              <Button disabled={busy || routing} onClick={() => setRevisionOpen(true)}>
                Manufacturing revisions…
              </Button>
            )}
            <Button
              disabled={busy || routing || !geometry}
              onClick={() => setInspectionOpen(true)}
            >
              Inspect in 3D…
            </Button>
            {!beginner && (
              <Button
                disabled={busy || routing}
                onClick={() => setKicadReviewOpen(true)}
              >
                Review KiCad board…
              </Button>
            )}
            {!beginner && (
              <Button
                disabled={busy || routing}
                onClick={() => setKicadOpen(true)}
              >
                Export KiCad board…
              </Button>
            )}
            {board.copperLayers.length === 1 && (
              <section aria-label="Wire jumpers">
                <h3>Wire jumpers</h3>
                <Button
                  disabled={busy || routing || !board.nets?.length}
                  onClick={() => setJumperDialog('new')}
                >
                  Add wire jumper…
                </Button>
                {!!board.jumpers?.length && (
                  <ul aria-label="Board wire jumpers">
                    {board.jumpers.map((jumper) => (
                      <li key={jumper.id}>
                        {jumper.reference} · {jumper.fitted ? 'Fitted' : 'DNP'}
                        <Button
                          size="small"
                          disabled={busy || routing}
                          onClick={() => setJumperDialog(jumper)}
                        >
                          Edit {jumper.reference}…
                        </Button>
                        <Button
                          size="small"
                          disabled={busy || routing}
                          onClick={() =>
                            edit(() =>
                              session.apply([
                                { type: 'removeWireJumper', id: jumper.id },
                              ]),
                            )
                          }
                        >
                          Remove {jumper.reference}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {!beginner && (
              <>
                <h3>Placement areas</h3>
                <Button
                  disabled={busy}
                  onClick={() => setPlacementAreaDialog('new')}
                >
                  Add placement area…
                </Button>
                {!!board.placementAreas?.length && (
                  <ul aria-label="Placement areas">
                    {board.placementAreas.map((area) => (
                      <li key={area.id}>
                        {area.name} ·{' '}
                        {area.kind === 'keep-in' ? 'Keep in' : 'Keep out'} ·{' '}
                        {area.side === 'both' ? 'Both sides' : area.side}
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => setPlacementAreaDialog(area)}
                        >
                          Edit {area.name}…
                        </Button>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            edit(() =>
                              session.apply([
                                { type: 'removePlacementArea', id: area.id },
                              ]),
                            )
                          }
                        >
                          Remove {area.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!beginner && (
              <>
                <h3>Routing regions</h3>
                <Button disabled={busy || routing} onClick={() => setRoutingRegionDialog('new')}>
                  Add routing region…
                </Button>
                {!!board.routingRegions?.length && (
                  <ul aria-label="Routing regions">
                    {board.routingRegions.map((region) => (
                      <li key={region.id}>
                        {region.name} · {region.side === 'both' ? 'Both layers' : region.side}
                        <Button size="small" disabled={busy || routing} onClick={() => setRoutingRegionDialog(region)}>
                          Edit {region.name}…
                        </Button>
                        <Button size="small" disabled={busy || routing}
                          onClick={() => edit(() => session.apply([{ type: 'removeRoutingRegion', id: region.id }]))}>
                          Remove {region.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <h3>Copper zones</h3>
            <Button
              disabled={busy || routing || !geometry || !board.nets?.length}
              onClick={() => setZoneDialog('new')}
            >
              Add copper zone…
            </Button>
            {!!board.zones?.length && (
              <>
                <ul>
                  {board.zones.map((zone) => (
                    <li key={zone.id}>
                      {board.nets?.find(({ id }) => id === zone.netId)?.name ??
                        'Missing net'}
                      {' · '}
                      {zone.layerId}
                      <Button
                        disabled={busy || routing || !geometry}
                        onClick={() => setZoneDialog(zone)}
                      >
                        Edit zone…
                      </Button>
                      <Button
                        disabled={busy || routing}
                        onClick={() =>
                          edit(() =>
                            session.apply([
                              { type: 'removeZone', id: zone.id },
                            ]),
                          )
                        }
                      >
                        Remove zone
                      </Button>
                    </li>
                  ))}
                </ul>
                <div role="status">
                  {!derive
                    ? 'Zone fill is stale.'
                    : derivedResult
                    ? 'Zones filled.'
                    : deriveError
                    ? 'Zone fill failed.'
                    : fillPaused && !refillWorker.current
                    ? 'Zone fill paused for board analysis.'
                    : 'Filling zones…'}
                </div>
                <Button
                  onClick={() => {
                    setDerived(undefined);
                    if (!deriveError) setDerive(!derive);
                  }}
                >
                  {deriveError ? 'Retry zone fill' : derive ? 'Cancel zone fill' : 'Refill zones'}
                </Button>
                {!!derivedResult?.zones.issues.length && (
                  <ul aria-label="Zone issues">
                    {derivedResult.zones.issues.map(
                      ({ code, zoneId, objectId }) => (
                        <li key={zoneId + code + objectId}>
                          {code === 'missing-net'
                            ? 'Assign a current net to the zone.'
                            : code === 'island'
                            ? 'Disconnected zone copper.'
                            : code === 'thermal-anchor'
                            ? 'Thermal has no usable anchor.'
                            : code === 'equal-priority'
                            ? 'Different nets overlap at the same zone priority.'
                            : 'Thermal relief is disconnected.'}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </>
            )}
            </div>
          </aside>
          <div className="bottom-panel-wrapper pcb-properties" role="region" aria-label="Board properties"
            style={{ height: propertiesHeight }} hidden={!showProperties}>
            <ResizeHandle direction="vertical" label="Resize board properties"
              onResize={(delta) => setPropertiesHeight((height) => Math.max(100, Math.min(440, height - delta)))} />
            <div className="pcb-properties-body">
              {!!geometry?.features.length && <div className="pcb-panel-scroll">
                    <h3 className="pcb-panel-heading">Placed components</h3>
                    <ul className="pcb-component-list" aria-label="Placed components">
                      {geometry.features.map(({ id, label }) => (
                        <li key={id}>
                          {!beginner && (
                            <input
                              type="checkbox"
                              aria-label={
                                'Include ' + label + ' in placement group'
                              }
                              checked={groupSelection.has(id)}
                              disabled={busy || routing || measuring}
                              onChange={() => toggleGroupComponent(id)}
                            />
                          )}
                          <Button
                            size="small"
                            appearance={id === selected ? 'primary' : 'subtle'}
                            onClick={() => selectComponent(id)}
                          >
                            {label}
                          </Button>
                        </li>
                      ))}
                    </ul>
                </div>}
              {(target || groupMembers.length > 0 || sourcePads.length > 0) && (
                <div className="pcb-panel-scroll pcb-selection-properties">
                  {!beginner && groupMembers.length > 0 && (
                    <fieldset disabled={busy || routing || measuring}>
                      <legend>Placement group</legend>
                      <p>
                        {groupMembers.length} selected · Anchor {groupAnchor?.label}
                      </p>
                      <label>
                        Group operation{' '}
                        <select
                          value={groupMode}
                          onChange={(event) => setGroupMode(event.target.value)}
                        >
                          <option value="translate">Move by offset</option>
                          <option value="rotate">Rotate about anchor</option>
                          <option value="align-x">Align X to anchor</option>
                          <option value="align-y">Align Y to anchor</option>
                          <option value="distribute-x">Distribute along X</option>
                          <option value="distribute-y">Distribute along Y</option>
                        </select>
                      </label>{' '}
                      {groupMode === 'translate' && (
                        <>
                          <label>
                            Group X offset (mm){' '}
                            <input
                              size={6}
                              value={groupX}
                              onChange={(event) => setGroupX(event.target.value)}
                            />
                          </label>{' '}
                          <label>
                            Group Y offset (mm){' '}
                            <input
                              size={6}
                              value={groupY}
                              onChange={(event) => setGroupY(event.target.value)}
                            />
                          </label>{' '}
                        </>
                      )}
                      {groupMode === 'rotate' && (
                        <label>
                          Group rotation (°){' '}
                          <input
                            size={6}
                            value={groupAngle}
                            onChange={(event) => setGroupAngle(event.target.value)}
                          />
                        </label>
                      )}{' '}
                      <Button
                        appearance="primary"
                        disabled={
                          groupMembers.length <
                          (groupMode.startsWith('distribute-') ? 3 : 2)
                        }
                        onClick={(): void => {
                          void moveGroup();
                        }}
                      >
                        Apply group placement
                      </Button>
                      <Button onClick={() => setGroup([])}>Clear group</Button>
                    </fieldset>
                  )}
                  {target && (
                    <fieldset disabled={busy || routing || measuring}>
                      <legend>
                        {selectedPlacement ? 'Position' : 'Place'}{' '}
                        {target.reference ?? 'component'}
                      </legend>
                      {!beginner && selectedPlacement && (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              checked={!!selectedPlacement.positionLocked}
                              disabled={selectedPlacement.locked}
                              onChange={() => togglePlacementLock('positionLocked')}
                            />
                            Lock position
                          </label>{' '}
                          <label>
                            <input
                              type="checkbox"
                              checked={!!selectedPlacement.rotationLocked}
                              disabled={selectedPlacement.locked}
                              onChange={() => togglePlacementLock('rotationLocked')}
                            />
                            Lock rotation
                          </label>{' '}
                          <Button onClick={() => togglePlacementLock('locked')}>
                            {selectedPlacement.locked
                              ? 'Unlock component'
                              : 'Lock component'}
                          </Button>
                        </>
                      )}
                      {beginner && (positionLocked || rotationLocked) && (
                        <p>Use Engineering view to change the footprint locks.</p>
                      )}
                      {placementTool === target.id && (
                        <p>Click the board to place the footprint, or enter its coordinates.</p>
                      )}
                      <label>
                        X (mm){' '}
                        <input
                          size={6}
                          value={positionLocked ? mm(selectedPlacement.positionNm.x) : x}
                          disabled={positionLocked}
                          onChange={(e) => {
                            setX(e.target.value);
                            setQueuePositionSet(true);
                          }}
                        />
                      </label>{' '}
                      <label>
                        Y (mm){' '}
                        <input
                          size={6}
                          value={positionLocked ? mm(selectedPlacement.positionNm.y) : y}
                          disabled={positionLocked}
                          onChange={(e) => {
                            setY(e.target.value);
                            setQueuePositionSet(true);
                          }}
                        />
                      </label>{' '}
                      <label>
                        Rotation (°){' '}
                        <input
                          size={6}
                          value={
                            rotationLocked
                              ? mm(selectedPlacement.rotationMicrodegree)
                              : rotation
                          }
                          disabled={rotationLocked}
                          onChange={(e) => setRotation(e.target.value)}
                        />
                      </label>{' '}
                      <label>
                        Board side{' '}
                        <select
                          aria-label="Board side"
                          value={
                            selectedPlacement?.locked ? selectedPlacement.side : side
                          }
                          disabled={selectedPlacement?.locked}
                          onChange={(e) => setSide(e.target.value as typeof side)}
                        >
                          {board.copperLayers.map(({ id }) => (
                            <option key={id} value={id}>
                              {id === 'top' ? 'Top' : 'Bottom'}
                            </option>
                          ))}
                        </select>
                      </label>{' '}
                      {!beginner && (
                        <label>
                          <input
                            type="checkbox"
                            checked={showPlacementEstimates}
                            onChange={(event) =>
                              setShowPlacementEstimates(event.target.checked)
                            }
                          />
                          Show straight-line estimates
                        </label>
                      )}
                      <Button
                        appearance="primary"
                        disabled={
                          selectedPlacement?.locked ||
                          (sequentialPlacement && !queuePositionSet)
                        }
                        onClick={(): void => {
                          void place();
                        }}
                      >
                        {selectedPlacement ? 'Apply position' : 'Place at coordinates'}
                      </Button>
                      {selectedPlacement && !positionLocked && <Button disabled={busy}
                        onClick={() => armPlacement(target.id)}>
                        Move on board
                      </Button>}
                    </fieldset>
                  )}
                  {!!sourcePads.length && (
                    <>
                      <h3 className="pcb-panel-heading">Schematic connections</h3>
                      <ul aria-label="Schematic connections">
                        {sourcePads.map(({ padId, padLabel, signal, source }) => (
                          <li key={padId + ':' + source.unitId + ':' + source.pinId}>
                            <Button
                              size="small"
                              appearance={
                                padId === selectedPad ? 'primary' : 'subtle'
                              }
                              onClick={() => onProbe?.(source)}
                            >
                              {padLabel} · {signal}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {error && <p role="alert" className="pcb-editor-message">{error}</p>}
        {deriveError && (
          <p role="status">Connectivity preview unavailable. {deriveError}</p>
        )}
      </div>
    </section>
  );
}
