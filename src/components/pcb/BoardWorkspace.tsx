import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Input, Menu, MenuItem, MenuDivider, MenuList, MenuPopover, Select,
  MenuTrigger, ToolbarButton, ToolbarDivider } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { AnchoredContextMenu } from '../controls/AnchoredContextMenu';
import { CheckmarkCircleRegular, ChevronDownRegular, FolderOpenRegular, MoreHorizontalRegular, SaveRegular, SaveCopyRegular } from '@fluentui/react-icons';
import { BoardNetlistPanel } from './BoardNetlistPanel';
import { PersistentDataGrid } from '../controls/PersistentDataGrid';
import { ListModeMenuButton } from '../panel/ListModeMenuButton';
import { StylePanelLayout, StylePanelSection } from '../panel/StylePanelLayout';
import { LibraryBrowserHeader, LibrarySourceTabs } from '../libraryPanel/LibrarySourceTabs';
import { EditorDrawingStack } from '../panel/EditorLayout';
import { EditorToolbar } from '../toolbar/EditorToolbar';
import { EditorFileMenu, EditorHistoryControls, EditorNewMenu, EditorSaveAllButton, EditorSaveButton } from '../toolbar/FileToolbarControls';
import { ViewToolbarControls } from '../toolbar/ViewToolbarControls';
import { ContextualMenuItemType } from '../../manipulators/updateInterfaces';
import type { ContextMenuItem } from '../../manipulators/updateInterfaces';
import {
  boardNetSources,
  boardPadSources,
} from '../../pcb/hierarchicalSnapshot';
import { createBoardWorker } from '../../pcb/boardWorker';
import type { ManualRoute } from '../../pcb/manualBoardRouting';
import { centrelineBlock, manualRouteLeg } from '../../pcb/routing';
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
import { applyRouteDeletion, connectedRouteIds, planRouteDeletion } from '../../pcb/routeDeletion';
import { boardLayerById, boardLayers } from '../../pcb/boardLayers';
import { BoardLayersPanel, LayerLockIcon, LayerVisibilityIcon } from './BoardLayersPanel';
import { boardPickLayers, canPickOnLayers } from './boardLayerPicking';
import { boardCopperObjects, copperObjectLabels, drawCopperObject, isCopperObject, changeCutout, copperAreaGeometry, reshapeCopperArea } from './boardCopperObjects';
import type { CopperObject, CopperObjectKind } from './boardCopperObjects';
import { areaTools, areaToolShapes, BoardShapeMenu, openingToolShapes } from './BoardShapeTools';
import wireImage from 'url:../../../images/wire.png';
import type { BoardDrawShape } from './BoardShapeTools';
import { areaOutline } from '../../pcb/boardAreaShape';
import type { BoardMechanicalHole } from '../../pcb/boardMechanical';
import { addBoardPolygonPoint, applyBoardPolygonCommand, boardPolygonMenu, drawBoardBounds, editBoardLine, finishBoardPolygon, moveBoardArtwork } from './boardShapeAdapter';
import { openingFromDrag } from './boardOpeningAdapter';
import { BoardAreaFields } from './BoardAreaFields';
import { areaFields } from './boardOutlineInput';
import type { BoardLayerId, VisibleCopper } from '../../pcb/boardLayers';
import type { FootprintGraphic } from '../../pcb/footprintDetails';
import { footprintReference, offsetFootprintReference } from '../../pcb/boardReference';
import { footprintTextStrokes } from '../../pcb/footprintText';
import { boardTextLayers, BoardTextEditor, BoardTextFields } from './BoardTextFields';
import type { BoardText } from './BoardTextFields';
import FootprintArtworkEditor from '../projects/FootprintArtworkEditor';
import BoardCircuitSourceDialog from './BoardCircuitSourceDialog';
import type { RouteDeletionPlan } from '../../pcb/routeDeletion';
import type { RouteCleanupResult } from '../../pcb/routeCleanup';
import RouteDeletionPanel from './RouteDeletionPanel';
import type { RouteDeletionDraft } from './RouteDeletionPanel';
import type { BoardFootprint } from '../../pcb/boardAssets';
import BoardCanvas from './BoardCanvas';
import type { BoardCanvasHandle, BoardContextTarget, BoardPick, BoardPickTarget } from './BoardCanvas';
import BoardPickPanel from './BoardPickPanel';
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
import BoardChecksPanel from './BoardChecksPanel';
import BoardHoleDialog from './BoardHoleDialog';
import BoardProfileDialog from './BoardProfileDialog';
import BoardZoneProperties from './BoardZoneProperties';
import WireJumperProperties from './WireJumperProperties';
import PlacementAreaProperties from './PlacementAreaProperties';
import RoutingRegionProperties from './RoutingRegionProperties';
import { boardRuleResolver, preferredTrackWidth, routeViaPresets } from '../../pcb/boardRules';
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
import type { BoardWorkspaceSession } from '../../io/boardWorkspace';
import {
  boardHistoryCommand,
  boardMenuCommand,
  boardZoomCommand,
  editFootprintLibrary,
  saveActiveBoard,
} from '../../io/boardWorkspaceEvents';
import type { BoardMenuItemState } from '../../io/boardWorkspaceEvents';
import type { BoardWorkspaceProbe } from '../../io/projectPcbProbe';

const defaultHiddenLayers = () => new Set<BoardLayerId>([
  'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd',
]);

type RouteObstruction = NonNullable<ReturnType<typeof centrelineBlock>>;
const routeBlockMessages: Record<RouteObstruction['kind'], string> = {
  layer: 'This copper layer is unavailable.',
  edge: 'Too close to the board edge.',
  drill: 'Too close to a drill opening.',
  copper: 'Too close to copper on another net.',
  region: 'A routing restriction blocks this segment.',
  track: 'Too close to an existing track.',
};

function routeBlockMessage(obstruction: RouteObstruction) {
  const message = routeBlockMessages[obstruction.kind];
  return obstruction.kind === 'track' && obstruction.gapNm < obstruction.requiredNm
    ? `${message} Gap ${mm(obstruction.gapNm)} mm. Required ${mm(obstruction.requiredNm)} mm.`
    : message;
}

const BoardRuleInspectionDialog = React.lazy(() => import('./BoardRuleInspectionDialog'));
const BoardInspectionDialog = React.lazy(
  () => import('./BoardInspectionDialog'),
);
const BoardCamDialog = React.lazy(() => import('./BoardCamDialog'));
const BoardRevisionDialog = React.lazy(() => import('./BoardRevisionDialog'));
const KicadExportDialog = React.lazy(() => import('./KicadExportDialog'));
const KicadBoardReviewDialog = React.lazy(() => import('./KicadBoardReviewDialog'));

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => boardInputLength(value, 'mm');
type WidthPreset = 'minimum' | 'preferred' | 'custom';
type ViaStyle = keyof ReturnType<typeof routeViaPresets> | 'custom';
type TrackEditDraft = {
  source: BoardDocument;
  action: ManualTrackEdit;
  x: string;
  y: string;
};
export interface BoardWorkspaceDocument {
  session: BoardWorkspaceSession;
  projectRootId?: string;
  fileId?: string;
  folderId?: string;
  ancestorIds?: readonly string[];
  reloadProjectBoard?(): Promise<BoardWorkspaceDocument>;
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
  onProjectFolder,
  footprintsHost,
  footprintsVisible,
  rightPanelHost,
  onShowFootprints,
  bottomPanelHeight,
  onBottomPanelResize,
  manageClose,
  saveAllDisabled,
  activeCommands = true,
  probe,
  onProbe,
  onUpdate,
  onEditReferences,
  onBackAnnotate,
}: BoardWorkspaceDocument & {
  onClose(): void;
  onOpen(): void;
  onProjectFolder?(): void;
  footprintsHost: HTMLDivElement | null;
  footprintsVisible: boolean;
  rightPanelHost?: HTMLElement | null;
  onShowFootprints(): void;
  bottomPanelHeight: number;
  onBottomPanelResize(delta: number): void;
  manageClose?: boolean;
  saveAllDisabled?: boolean;
  activeCommands?: boolean;
}) {
  const [board, setBoard] = useState(session.board);
  const [selected, setSelected] = useState(probe?.componentId ?? '');
  const [group, setGroup] = useState<string[]>([]);
  const [routeGroup, setRouteGroup] = useState<string[]>([]);
  const [bottomView, setBottomView] = useState<'components' | 'netlist' | 'selection' | 'checks'>(
    probe?.componentId ? 'selection' : probe?.netId ? 'netlist' : 'components',
  );
  const [idleBottomView, setIdleBottomView] = useState<'components' | 'netlist'>(probe?.netId ? 'netlist' : 'components');
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
  const [hoveredNet, setHoveredNet] = useState('');
  const [x, setX] = useState('10');
  const [y, setY] = useState('10');
  const [rotation, setRotation] = useState('0');
  const [side, setSide] = useState<'top' | 'bottom'>('top');
  const [filename, setFilename] = useState(session.path);
  const [profileDialog, setProfileDialog] = useState<'outline' | 'cutout' | number>();
  const [holeDialog, setHoleDialog] = useState(false);
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState(defaultHiddenLayers);
  const [lockedLayers, setLockedLayers] = useState<ReadonlySet<BoardLayerId>>(() => new Set());
  const hasBottomCopper = board.copperLayers.length > 1;
  const availableLayers = useMemo(() => boardLayers.filter(({ id }) => id !== 'B.Cu' || hasBottomCopper), [hasBottomCopper]);
  const pickableLayers = useMemo(() => new Set(availableLayers.map(({ id }) => id)
    .filter((id) => !hiddenLayers.has(id) && !lockedLayers.has(id))), [availableLayers, hiddenLayers, lockedLayers]);
  const pickerLayers = (item: BoardPickTarget) => boardPickLayers(item)
    .filter((id) => id !== 'B.Cu' || hasBottomCopper);
  const layerColumnLabels = hasBottomCopper ? ['Layer 1', 'Layer 2'] : ['Layer'];
  const componentColumnSizing = useMemo(() => ({
    reference: { minWidth: 68, idealWidth: 200 },
    layer: { minWidth: hasBottomCopper ? 78 : 156, idealWidth: 170 },
    layer2: { minWidth: 156, idealWidth: 180 },
  }), [hasBottomCopper]);
  const topVisible = !hiddenLayers.has('F.Cu');
  const bottomVisible = board.copperLayers.length > 1 && !hiddenLayers.has('B.Cu');
  const visibleCopper: VisibleCopper = topVisible ? (bottomVisible ? 'all' : 'top') :
    bottomVisible ? 'bottom' : 'none';
  function setLayerVisible(id: BoardLayerId, visible: boolean) {
    setHiddenLayers((hidden) => {
      const next = new Set(hidden);
      if (visible) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [measuring, setMeasuring] = useState(false);
  const [measurement, setMeasurement] = useState<BoardPoint[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>();
  const dimensions = board.annotations?.dimensions ?? [];
  const datum = board.annotations?.datum;
  const [routing, setRouting] = useState(false);
  const [routeSource, setRouteSource] = useState<string>();
  const routeToggle = React.useRef<HTMLButtonElement>(null);
  const routeLayerControl = React.useRef<HTMLSelectElement>(null);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const boardCanvas = React.useRef<BoardCanvasHandle>(null);
  const [pickingObjects, setPickingObjects] = useState(false);
  const [objectPick, setObjectPick] = useState<BoardPick>();
  const [hoveredObject, setHoveredObject] = useState<BoardPickTarget>();
  const [copperSelection, setCopperSelection] = useState<Pick<CopperObject, 'kind' | 'id'>>();
  const [copperDrawing, setCopperDrawing] = useState<{
    kind: CopperObjectKind; shape: BoardDrawShape; points: readonly BoardPoint[]; netId: string; layerId: CopperLayer['id'];
  }>();
  const copperObjects = useMemo(() => boardCopperObjects(board), [board]);
  const selectedCopper = copperObjects.find(({ kind, id }) => kind === copperSelection?.kind && id === copperSelection.id);
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
  const [circuitSourceOpen, setCircuitSourceOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ revision: number; findings: number }>();
  const recordCheck = React.useCallback((revision: number, findings: number) => {
    setLastCheck({ revision, findings });
  }, []);
  const checkSummary = !lastCheck ? 'Design checks have not been run.'
    : lastCheck.revision !== board.revision ? 'Design checks are stale.'
      : lastCheck.findings === 1 ? 'Design checks found 1 issue.'
        : `Design checks found ${lastCheck.findings} issues.`;
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [kicadOpen, setKicadOpen] = useState(false);
  const [kicadReviewOpen, setKicadReviewOpen] = useState(false);
  const [boardToolsOpen, setBoardToolsOpen] = useState(false);
  const [checksRun, setChecksRun] = useState(0);
  const [fabricationOpen, setFabricationOpen] = useState(false);
  const [ruleInspectionOpen, setRuleInspectionOpen] = useState(false);
  const [netRulesOpen, setNetRulesOpen] = useState(false);
  const [checkMarker, setCheckMarker] = useState<{
    board: typeof board;
    location?: BoardPoint;
  }>();
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
  const fillPaused = bottomView === 'checks' || camOpen;
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
    copper?: CopperObject;
    artwork?: BoardPickTarget;
    routeStart?: BoardContextTarget['routeStart'];
    polygon?: { target: CopperObject; at: BoardPoint; handle: number };
  }>();
  const footprintTabId = React.useId();
  const [footprintTab, setFootprintTab] = useState<'unplaced' | 'library'>('unplaced');
  const [libraryFootprintId, setLibraryFootprintId] = useState('');
  const libraryFootprint = board.footprintDefinitions?.find(({ id }) => id === libraryFootprintId);
  const [showRulers, setShowRulers] = useState(true);
  const [snapGrid, setSnapGrid] = useState('0.25');
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const guideToggle = React.useRef<HTMLButtonElement>(null);
  const guideReturnFocus = React.useRef<HTMLButtonElement>(null);
  const placementSearch = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  React.useEffect(() => {
    if (!probe) return;
    if (probe.placementQueue?.length) {
      startSequentialPlacement(probe.placementQueue);
      return;
    }
    setSequentialPlacement(false);
    setSelected(probe.componentId ?? '');
    setGroup([]);
    setRouteGroup([]);
    setBottomView(probe.componentId ? 'selection' : probe.netId ? 'netlist' : 'components');
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
  const [textDrawing, setTextDrawing] = useState<BoardText>();
  const textLayers = boardTextLayers.filter((id) => id !== 'B.Cu' || hasBottomCopper);
  const canPickObjects = !!geometry && !busy && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup && !placementTool && !copperDrawing && !textDrawing;
  React.useEffect(() => {
    if (!canPickObjects) setPickingObjects(false);
  }, [canPickObjects]);
  const groupMembers = group.filter((id) =>
    geometry?.features.some((feature) => feature.id === id),
  );
  const groupSelection = new Set(groupMembers);
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
  const appliedCircuit = board.appliedCircuit ?? session.circuit;
  const sourcePads =
    appliedCircuit && selectedPlacement
      ? boardPadSources(board, appliedCircuit).filter(
          ({ footprintId }) => footprintId === selectedPlacement.id,
        )
      : [];
  const netSources = useMemo(
    () =>
      appliedCircuit && selectedNet
        ? boardNetSources(appliedCircuit, selectedNet)
        : [],
    [appliedCircuit, selectedNet],
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

  function changeAnnotations(nextDatum: BoardPoint | undefined, nextDimensions: readonly BoardDimension[],
    graphics: readonly FootprintGraphic[] = board.annotations?.graphics ?? []) {
    const annotations = nextDatum || nextDimensions.length || graphics.length
      ? {
          ...(nextDatum && { datum: nextDatum }),
          ...(nextDimensions.length && { dimensions: nextDimensions }),
          ...(graphics.length && { graphics }),
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
        estimates: showPlacementEstimates,
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
  const preferredWidth = preferredTrackWidth(routeRules, 250_000);
  const routeWidth = widthPreset === 'custom' ? trackWidth
    : mm(widthPreset === 'minimum' ? routeRules.minWidthNm : preferredWidth);
  const viaPresets = routeViaPresets(board, routeRules);

  function setRoutingMode(active: boolean, start?: BoardContextTarget['routeStart']) {
    if (!active) cancelCopperJob();
    else {
      cancelPlacement();
      const startLayer = start?.layerId ?? layer;
      setLayer(startLayer);
      setLayerVisible(startLayer === 'top' ? 'F.Cu' : 'B.Cu', true);
      if (start) setSelectedNet(start.netId);
      requestAnimationFrame(() => boardCanvas.current?.focus());
    }
    setError('');
    setCleanupDraft(undefined);
    setTrackEditDraft(undefined);
    setDeleteRoute(undefined);
    setRoute(start ? [{ position: start.position, layer: start.layerId }] : []);
    setRouteSource(start?.label);
    setReroute('');
    setMeasuring(false);
    setMeasurement([]);
    setRouting(active);
  }

  async function routePoint(
    position: BoardPoint,
    targetNet?: string,
    sourceLabel?: string,
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
      setRouteSource(sourceLabel);
      return;
    }
    const points = manualRouteLeg(last.position, position, routeBend);
    if (!points.length) return;
    let completed: typeof route | undefined;
    function addPoints(geometry: RouteClearance) {
      const obstruction = routeLegObstruction(geometry, last.position, points, layer);
      if (obstruction) {
        setError('Track blocked. ' + routeBlockMessage(obstruction.reason));
        return;
      }
      const next = [...route, ...points.map((position) => ({ position, layer }))];
      setRoute(next);
      if (!reroute && targetNet && targetNet === selectedNet) completed = next;
    }
    if (routeClearance) addPoints(routeClearance);
    else await runCopperJob(() => loadRouteClearance(), (geometry) => {
      setClearanceDraft({ input: clearanceInput, geometry });
      addPoints(geometry);
    });
    if (completed) await finishRoute(completed);
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
    setLayerVisible(next === 'top' ? 'F.Cu' : 'B.Cu', true);
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

  function routeLegObstruction(
    geometry: RouteClearance,
    start: BoardPoint,
    points: readonly BoardPoint[],
    side: CopperLayer['id'],
  ) {
    for (const end of points) {
      const reason = centrelineBlock(geometry, start, end, side);
      if (reason) return { reason, start, end } as const;
      start = end;
    }
  }

  function previewRouteLeg(position: BoardPoint) {
    const last = route.at(-1);
    if (!last || !routeClearance) return;
    const points = manualRouteLeg(last.position, position, routeBend);
    if (!points.length) return;
    const obstruction = routeLegObstruction(routeClearance, last.position, points, last.layer);
    return {
      points: [last.position, ...points],
      obstruction: obstruction && {
        point: { x: (obstruction.start.x + obstruction.end.x) / 2, y: (obstruction.start.y + obstruction.end.y) / 2 },
        message: routeBlockMessage(obstruction.reason),
      },
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

  async function finishRoute(waypoints = route) {
    await runCopperJob(async (job) => {
      const path = reroute && selectedTrack
        ? [
            ...waypoints,
            ...(layer === selectedTrack.layerId
              ? manualRouteLeg(waypoints.at(-1).position, selectedTrack.end, routeBend)
              : [selectedTrack.end]).map((position) => ({ position, layer: selectedTrack.layerId })),
          ]
        : waypoints;
      const crossesLayers = path.some((point, index) => index > 0 && point.layer !== path[index - 1].layer);
      const via = viaStyle !== 'custom' ? viaPresets[viaStyle]
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
    setObjectPick(undefined);
    setCopperSelection(undefined);
    setHoveredObject(undefined);
    setBottomView('selection');
    setPlacementTool(undefined);
    setSequentialPlacement(false);
    setGroup([]);
    setRouteGroup([]);
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

  function selectArea(componentIds: string[], routeIds: string[], append: boolean) {
    setObjectPick(undefined);
    setCopperSelection(undefined);
    setHoveredObject(undefined);
    setHoveredNet('');
    const components = append ? [...new Set([...groupMembers, ...selectedFeatures.map(({ id }) => id), ...componentIds])] : componentIds;
    const routes = append ? [...new Set([...routeGroup, ...(selectedRouteId ? [selectedRouteId] : []), ...routeIds])] : routeIds;
    if (components.length === 1 && !routes.length) {
      selectComponent(components[0]);
      return;
    }
    if (components.length || routes.length) setBottomView('selection');
    else if (bottomView === 'selection') setBottomView(idleBottomView);
    setGroup(components);
    setRouteGroup(routes);
    setSelected('');
    setSelectedPad(undefined);
    setSelectedNet('');
    setSelectedRouteId('');
    setSelectedSilk(undefined);
  }

  function moveComponentOnCanvas(componentId: string, delta: BoardPoint, commit: boolean) {
    const placement = board.footprints?.find((item) => item.componentId === componentId);
    if (!placement || placement.locked || placement.positionLocked || busy) return;
    const origin = placement.positionNm;
    const positionNm = canvasPosition(origin.x + delta.x, -origin.y - delta.y);
    if (commit) {
      selectComponent(componentId);
      setBusy(true);
      setError('');
      void session.place(componentId, { ...placement, positionNm }).then((next) => {
        setBoard(next);
        setX(mm(positionNm.x));
        setY(mm(positionNm.y));
      }).catch((failure) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      }).finally(() => setBusy(false));
    }
    return { x: positionNm.x - origin.x, y: positionNm.y - origin.y };
  }

  function selectPickedObject(target: BoardPickTarget) {
    if (!canPickOnLayers(pickableLayers, target)) return;
    const location = objectPick?.point;
    closeObjectPicker();
    if (target.kind === 'component') selectComponent(target.id);
    if (target.kind === 'pad') selectComponent(target.componentId, target.id);
    if (target.kind === 'silk' || target.kind === 'artwork') {
      selectComponent(target.componentId ?? '');
      setSelectedSilk(target);
    }
    if (target.kind === 'track' || target.kind === 'via') {
      const route = (target.kind === 'track' ? board.tracks : board.vias)?.find(({ id }) => id === target.id);
      if (route) {
        selectComponent('');
        pickedRoute.current = location && { id: route.id, point: location };
        setSelectedRouteId(route.id);
        setSelectedNet(route.netId ?? '');
        setSelectedSilk(undefined);
      }
    }
    if (isCopperObject(target.kind)) selectCopperObject({ kind: target.kind, id: target.id });
    if (isCopperObject(target.kind) || boardTextIndex(target) >= 0)
      requestAnimationFrame(() => boardCanvas.current?.focus());
  }

  function closeObjectPicker() {
    setObjectPick(undefined);
    setHoveredObject(undefined);
  }

  function clearUnavailableSelection(hidden: ReadonlySet<BoardLayerId>, locked: ReadonlySet<BoardLayerId>) {
    closeObjectPicker();
    if (routing) return;
    const remainingLayers = new Set(availableLayers.map(({ id }) => id).filter((id) => !hidden.has(id) && !locked.has(id)));
    const pickable = (target: Parameters<typeof canPickOnLayers>[1]) => canPickOnLayers(remainingLayers, target);
    const components = group.filter((id) => {
      const feature = selectedFeatures.find((feature) => feature.id === id);
      return feature && (pickable({ kind: 'component', layer: feature.placement.side }) ||
        feature.copper.some(({ layerId }) => pickable({ kind: 'pad', layer: layerId })));
    });
    const routes = routeGroup.filter((id) => {
      const track = board.tracks?.find((track) => track.id === id);
      return pickable({ kind: 'track', layer: track?.layerId ?? 'both' });
    });
    if (components.length !== group.length || routes.length !== routeGroup.length) {
      selectArea(components, routes, false);
      return;
    }
    const feature = selectedFeatures.find(({ id }) => id === selected);
    const padLayers = selectedPad && feature?.copper.filter(({ padId }) => padId === selectedPad);
    const componentUnavailable = feature && (padLayers && padLayers.length
      ? !padLayers.some(({ layerId }) => pickable({ kind: 'pad', layer: layerId }))
      : !pickable({ kind: 'component', layer: feature.placement.side }));
    if ((selectedCopper && !pickable(selectedCopper)) ||
      (selectedSilk ? !pickable(selectedSilk) : componentUnavailable) ||
      (selectedTrack && !pickable({ kind: 'track', layer: selectedTrack.layerId })) ||
      (selectedVia && !pickable({ kind: 'via', layer: 'both' }))) selectArea([], [], false);
  }

  function selectCopperObject(item: Pick<CopperObject, 'kind' | 'id'>) {
    selectComponent('');
    setCopperSelection(item);
  }

  function startCopperDrawing(kind: CopperObjectKind, shape: BoardDrawShape = kind === 'jumper' ? 'line' : 'polygon') {
    if (!canPickObjects && copperDrawing?.kind !== kind) return;
    closeObjectPicker();
    setPickingObjects(false);
    selectArea([], [], false);
    setBottomView('selection');
    setError('');
    const layerId = layer === 'bottom' && hasBottomCopper ? 'bottom' : 'top';
    if (kind === 'zone' || kind === 'jumper') {
      setLayerVisible(kind === 'jumper' || layerId === 'top' ? 'F.Cu' : 'B.Cu', true);
    } else if (kind === 'cutout' || kind === 'hole') {
      setLayerVisible('Edge.Cuts', true);
    }
    const netId = board.nets?.some(({ id }) => id === selectedNet) ? selectedNet : board.nets?.[0]?.id ?? '';
    setCopperDrawing({ kind, shape, points: [], layerId, netId });
    requestAnimationFrame(() => boardCanvas.current?.focus());
  }

  function finishCopperDrawing(points = copperDrawing?.points) {
    if (!copperDrawing || !points || points.length < (copperDrawing.shape === 'polygon' ? 3 : 2)) return;
    try {
      const { kind, shape, netId, layerId } = copperDrawing;
      const id = kind === 'cutout' ? String(board.profile?.cutouts.length ?? 0) : crypto.randomUUID();
      const [first, last] = points;
      const bounded = shape === 'rectangle' || shape === 'ellipse';
      if (!bounded && shape !== 'polygon' && samePoint(first, last)) return;
      const geometry = bounded ? drawBoardBounds(shape, first, last, true) :
        shape === 'polygon' ? { kind: shape, vertices: points } as const : undefined;
      if (bounded && !geometry) return;
      const opening = shape === 'round-hole' || shape === 'slot' ? openingFromDrag(shape, first, last) : undefined;
      const operation = drawCopperObject(board, kind, id, opening ? [opening.start, opening.end] : points, netId, layerId, geometry, opening?.widthNm);
      setBoard(session.apply([operation]));
      if (kind === 'zone') openBoardTools();
      setCopperDrawing(undefined);
      if (canPickOnLayers(pickableLayers, { kind, layer: kind === 'zone' ? layerId : kind === 'jumper' ? 'top' : 'both' })) {
        selectCopperObject({ kind, id });
      } else setBottomView(idleBottomView);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function addCopperPoint(point: BoardPoint, finish: boolean) {
    const { shape, points } = copperDrawing;
    if (shape === 'polygon') {
      const update = addBoardPolygonPoint(points, point);
      if (update.end || finish) finishCopperDrawing(update.points);
      else setCopperDrawing({ ...copperDrawing, points: update.points });
      return;
    }
    const last = points.at(-1);
    const next = last && samePoint(last, point) ? points : [...points, point];
    if (next.length > 1) {
      finishCopperDrawing(next);
      return;
    }
    setCopperDrawing({ ...copperDrawing, points: next });
    if (finish) finishCopperDrawing(next);
  }

  function cancelCopperDrawing() {
    setCopperDrawing(undefined);
    setBottomView(idleBottomView);
    setError('');
  }

  function renderCopperProperties(item: CopperObject) {
    switch (item.kind) {
      case 'area':
        return <PlacementAreaProperties area={board.placementAreas.find(({ id }) => id === item.id)}
          onApply={(area) => setBoard(session.apply([{ type: 'setPlacementArea', area }]))} />;
      case 'region':
        return <RoutingRegionProperties board={board} region={board.routingRegions.find(({ id }) => id === item.id)}
          onApply={(region) => setBoard(session.apply([{ type: 'setRoutingRegion', region }]))} />;
      case 'zone':
        return <BoardZoneProperties board={board} zone={board.zones.find(({ id }) => id === item.id)}
          onApply={(zone) => setBoard(session.apply([{ type: 'setZone', zone }]))} />;
      case 'cutout': {
        const shape = copperAreaGeometry(board, item);
        if (!shape || shape.kind === 'polygon') return null;
        return <form className="pcb-profile-fields" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          edit(() => session.apply([reshapeCopperArea(board, item, areaFields(form, shape).shape)]));
        }}>
          <BoardAreaFields shape={shape} outline={areaOutline(shape)} />
          {shape.kind === 'rectangle' && <Button type="submit" appearance="primary">Apply</Button>}
        </form>;
      }
      case 'hole': {
        const hole = board.mechanicalHoles.find(({ id }) => id === item.id);
        return <form className="pcb-profile-fields" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          edit(() => session.apply([{ type: 'setMechanicalHole', hole: {
            ...hole, widthNm: boardInputLength(String(data.get('width')), 'mm'),
          } }]));
        }}>
          <label>Diameter or slot width (mm)
            <Input name="width" required defaultValue={String(hole.widthNm / 1_000_000)} />
          </label>
          <Button type="submit" appearance="primary">Apply</Button>
        </form>;
      }
      case 'jumper':
        return <WireJumperProperties board={board} jumper={board.jumpers.find(({ id }) => id === item.id)}
          onApply={(jumper) => setBoard(session.apply([{ type: 'setWireJumper', jumper }]))} />;
    }
  }

  function removeCopperObject(item: CopperObject) {
    const types = { area: 'removePlacementArea', region: 'removeRoutingRegion',
      zone: 'removeZone', jumper: 'removeWireJumper', hole: 'removeMechanicalHole' } as const;
    edit(() => {
      const operation = item.kind === 'cutout' ? changeCutout(board, Number(item.id)) : { type: types[item.kind], id: item.id };
      const next = session.apply([operation]);
      setCopperSelection(undefined);
      openBoardList(idleBottomView);
      return next;
    });
  }

  function moveGraphic(target: CopperObject | BoardPickTarget, offset: BoardPoint) {
    if (target.kind === 'jumper') {
      const jumper = board.jumpers?.find(({ id }) => id === target.id);
      if (!jumper) return;
      const [start, end] = editBoardLine([jumper.start, jumper.end], -1, offset);
      edit(() => session.apply([{ type: 'setWireJumper', jumper: { ...jumper, start, end } }]));
    } else if ('reference' in target && target.reference && canPickOnLayers(pickableLayers, target)) {
      const placement = board.footprints?.find(({ componentId }) => componentId === target.componentId);
      if (!placement || placement.locked) return;
      const device = board.deviceDefinitions?.find(({ id }) => id === placement.deviceId);
      const definition = board.footprintDefinitions?.find(({ id }) => id === device?.footprintId);
      const part = board.components?.find(({ id }) => id === placement.componentId);
      const reference = footprintReference(definition, placement, part?.reference);
      if (!reference) return;
      const referencePositionNm = offsetFootprintReference(reference.graphic.at, offset, placement);
      edit(() => session.commit({
        ...board,
        requiredFeatures: board.requiredFeatures.includes('footprint-reference-position') ? board.requiredFeatures :
          [...board.requiredFeatures, 'footprint-reference-position'],
        footprints: board.footprints.map((item) => item.id === placement.id ? { ...item, referencePositionNm } : item),
      }));
    } else if (target.kind === 'artwork' && target.id.startsWith('artwork:') && canPickOnLayers(pickableLayers, target)) {
      const index = Number(target.id.slice(8));
      const graphics = board.annotations.graphics.map((item, itemIndex) =>
        itemIndex === index ? moveBoardArtwork(item, offset) : item);
      edit(() => session.apply([{ type: 'setAnnotations', annotations: { ...board.annotations, graphics } }]));
    }
  }

  function startText() {
    if (textDrawing) {
      cancelText();
      return;
    }
    const layer = textLayers.find((id) => pickableLayers.has(id));
    if (!canPickObjects || !layer) return;
    selectArea([], [], false);
    setPickingObjects(false);
    setBottomView('selection');
    setTextDrawing({
      kind: 'text', layer, text: '', at: { x: 0, y: 0 }, sizeNm: { x: 650_000, y: 1_000_000 },
      strokeNm: 150_000, rotationMicrodegree: 0, visible: true, filled: false,
      align: layer.startsWith('B.') ? ['mirror'] : [],
    });
  }

  function cancelText() {
    setTextDrawing(undefined);
    selectArea([], [], false);
    boardCanvas.current?.focus();
  }

  function saveBoardText(item: BoardText, index?: number) {
    if (!pickableLayers.has(item.layer) || !item.text.trim()) return;
    edit(() => {
      footprintTextStrokes(item);
      const graphics = [...(board.annotations?.graphics ?? [])];
      const added = index === undefined;
      const textIndex = index ?? graphics.length;
      graphics[textIndex] = item;
      const next = changeAnnotations(datum, dimensions, graphics);
      if (added) setTextDrawing(undefined);
      setSelectedSilk({ kind: 'artwork', id: 'artwork:' + textIndex, layer: 'both', boardLayer: item.layer, label: item.text });
      return next;
    });
  }

  function boardTextIndex(target: BoardPickTarget | undefined) {
    const index = target?.id.startsWith('artwork:') ? Number(target.id.slice(8)) : -1;
    return board.annotations?.graphics?.[index]?.kind === 'text' ? index : -1;
  }

  function deleteBoardText(target: BoardPickTarget) {
    const index = boardTextIndex(target);
    if (index < 0 || !canPickOnLayers(pickableLayers, target)) return;
    edit(() => {
      const next = changeAnnotations(datum, dimensions, board.annotations.graphics.filter((_, i) => i !== index));
      selectArea([], [], false);
      return next;
    });
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
    } else if (routeGroup.length || selectedFeatures.length) {
      const points = selectedFeatures.flatMap(({ placement, pads, copper }) => {
        const selectedLand = selectedPad && pads.find(({ id }) => id === selectedPad);
        const lands = selectedLand ? copper.filter(({ padId }) => padId === selectedLand.id) : copper;
        if (lands.length) return lands.flatMap(({ shape }) => padShapePoints(shape));
        return selectedLand ? [selectedLand.position] : [placement.positionNm, ...pads.map(({ position }) => position)];
      });
      for (const track of board.tracks ?? []) {
        if (routeGroup.includes(track.id)) points.push(...around(track.start, track.widthNm / 2), ...around(track.end, track.widthNm / 2));
      }
      for (const via of board.vias ?? []) {
        if (routeGroup.includes(via.id)) points.push(...around(via.positionNm, via.diameterNm / 2));
      }
      if (points.length) boardCanvas.current?.fit(points);
    }
  }

  function toggleGroupComponent(componentId: string, extendSelection = false) {
    if (busy || routing || measuring) return;
    setBottomView('selection');
    setRouteGroup([]);
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

  function openBoardTools() {
    setBoardToolsOpen(true);
  }

  function showBoardChecks() {
    setBottomView('checks');
    setChecksRun((value) => value + 1);
  }

  function openBoardList(view: 'components' | 'netlist') {
    setHoveredObject(undefined);
    setHoveredNet('');
    setIdleBottomView(view);
    setBottomView(view);
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
    if (draft.kind === 'region') setDeleteRoute({ source: board, draft });
    else commitDeletion(planRouteDeletion(board, draft));
  }

  function chooseRegionPoint(point: BoardPoint) {
    if (deletionDraft?.kind !== 'region' || !deletionDraft.picking) return;
    const draft = deletionDraft;
    if (draft.picking === 'end') {
      let plan: RouteDeletionPlan;
      try {
        plan = planRouteDeletion(board, {
          kind: 'region', start: { x: nm(draft.start.x), y: nm(draft.start.y) }, end: point, layer: draft.layer,
        });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      if (!plan.tracks.length && !plan.vias.length) {
        setError('The region contains no unlocked routed copper.');
        return;
      }
      commitDeletion(plan);
      return;
    }
    setError('');
    setDeleteRoute({
      source: board,
      draft: { ...draft, [draft.picking]: { x: mm(point.x), y: mm(point.y) },
        picking: 'end' },
    });
  }

  function deleteSelectedRoute() {
    if (!deletion?.plan || busy) return;
    commitDeletion(deletion.plan);
  }

  function commitDeletion(plan: RouteDeletionPlan) {
    if (busy || (!plan.tracks.length && !plan.vias.length)) return;
    edit(() => {
      const next = session.commit(applyRouteDeletion(session.board, plan));
      setDeleteRoute(undefined);
      setSelectedRouteId('');
      setRouteGroup([]);
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
    onShowFootprints();
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

  type MenuAction = BoardMenuItemState & { run(): void };
  function closeStandaloneBoard() {
    if (session.dirty) setConfirmDiscard(true);
    else onClose();
  }
  const routeDisabled = !routing && (busy || !!copperDrawing || !board.nets?.length);
  const checksDisabled = busy || routing || !geometry;
  const textDisabled = !textDrawing && (!canPickObjects || !textLayers.some((id) => pickableLayers.has(id)));
  const boardCommands: { title: string; items: (MenuAction | null | false)[] }[] = [
    {
      title: 'Board',
      items: [
        { id: 'outline', label: 'PCB Size & Shape…', disabled: busy, run: () => setProfileDialog('outline') },
        { id: 'cutout', label: 'Add cutout…', disabled: busy, run: () => setProfileDialog('cutout') },
        { id: 'hole', label: 'Hole or slot…', disabled: busy, run: () => setHoleDialog(true) },
        ...areaToolShapes.map(({ key, text }) => ({
          id: 'draw-cutout-' + key, label: 'Draw cutout: ' + text, disabled: !canPickObjects,
          run: () => startCopperDrawing('cutout', key),
        })),
        { id: 'draw-hole', label: 'Draw round hole', disabled: !canPickObjects,
          run: () => startCopperDrawing('hole', 'round-hole') },
        { id: 'draw-slot', label: 'Draw slot', disabled: !canPickObjects,
          run: () => startCopperDrawing('hole', 'slot') },
        { id: 'text', label: t('toolbar.text'), disabled: !canPickObjects || !textLayers.some((id) => pickableLayers.has(id)), run: startText },
        { id: 'dimension', label: 'Add dimension…', disabled: busy || routing, run: () => {
          openBoardTools();
          addDimension();
        } },
        { id: 'datum', label: 'Set measurement datum…', disabled: busy || routing,
          run: () => {
            openBoardTools();
            setAnnotationDraft({ type: 'datum', point: datum ?? { x: 0, y: 0 } });
          } },
        { id: 'pick', label: 'Pick overlapping objects', disabled: !canPickObjects, run: () => {
          setPickingObjects(true);
          openBoardTools();
          requestAnimationFrame(() => boardCanvas.current?.focus());
        } },
        null,
        !!onUpdate && { id: 'update', label: 'Update PCB from Schematic…', disabled: busy || session.dirty, run: onUpdate },
        !!onEditReferences && { id: 'references', label: 'Edit PCB references…',
          disabled: busy || session.dirty || !board.components?.length, run: onEditReferences },
        !!onBackAnnotate && { id: 'back-annotate', label: 'Update Schematic from PCB…',
          disabled: busy || session.dirty || !session.circuit, run: onBackAnnotate },
        !board.sourceCircuit && !session.circuit && { id: 'connections', label: 'Board connections…',
          disabled: busy || routing || !!deletionDraft || !!cleanup, run: () => setConnectionsOpen(true) },
        !onUpdate && { id: 'circuit-source', label: session.readProjectCircuit ? 'Update PCB from Schematic…' : 'Import schematic or netlist…',
          disabled: busy || routing, run: () => setCircuitSourceOpen(true) },
        { id: 'tools', label: 'View board tools', run: openBoardTools },
        process.env.TARGET_SYSTEM === 'electron' && !manageClose &&
          { id: 'close-board', label: 'Close board', disabled: busy, run: closeStandaloneBoard },
      ],
    },
    {
      title: 'Copper',
      items: [
        { id: 'route', label: routing ? 'Cancel route' : 'Route track', disabled: routeDisabled,
          run: () => setRoutingMode(!routing) },
        { id: 'net-rules', label: 'Net rules…', disabled: busy || routing, run: () => setNetRulesOpen(true) },
        { id: 'inspect-rules', label: 'Inspect board rules…',
          disabled: busy || routing || !geometry, run: () => setRuleInspectionOpen(true) },
        { id: 'checks', label: t('pcbChecks.run'), disabled: checksDisabled, run: showBoardChecks },
        null,
        { id: 'area', label: 'Add placement area', disabled: !canPickObjects, run: () => startCopperDrawing('area') },
        { id: 'region', label: 'Add routing region', disabled: !canPickObjects, run: () => startCopperDrawing('region') },
        { id: 'zone', label: 'Add copper zone', disabled: !canPickObjects || !board.nets?.length,
          run: () => startCopperDrawing('zone') },
        board.copperLayers.length === 1 && { id: 'jumper', label: 'Add wire jumper',
          disabled: !canPickObjects || !board.nets?.length,
          run: () => startCopperDrawing('jumper') },
      ],
    },
    {
      title: 'Fabrication',
      items: [
        { id: 'fabrication-settings', label: 'Fabrication settings…', disabled: busy || routing, run: () => setFabricationOpen(true) },
        { id: 'cam', label: 'Manufacturing preview…', disabled: busy || routing || !geometry, run: () => setCamOpen(true) },
        { id: '3d', label: 'Inspect in 3D…', disabled: busy || routing || !geometry, run: () => setInspectionOpen(true) },
        { id: 'revisions', label: 'Manufacturing revisions…', disabled: busy || routing, run: () => setRevisionOpen(true) },
        { id: 'review-kicad', label: 'Review KiCad board…', disabled: busy || routing, run: () => setKicadReviewOpen(true) },
        { id: 'export-kicad', label: 'Export KiCad board…', disabled: busy || routing, run: () => setKicadOpen(true) },
      ],
    },
  ];
  const nativeMenuSignature = React.useRef('');
  const nativeBoardMenus = process.env.TARGET_SYSTEM === 'electron' && !!window.electronAPI?.setBoardMenus;
  React.useEffect(() => {
    if (!nativeBoardMenus || !activeCommands) return;
    const menus = boardCommands.map(({ title, items }) => ({
      title,
      items: items.filter((item) => item !== false).map((item) =>
        item ? { id: item.id, label: item.label, disabled: item.disabled } : null),
    }));
    const signature = JSON.stringify(menus);
    if (signature !== nativeMenuSignature.current) {
      nativeMenuSignature.current = signature;
      window.electronAPI?.setBoardMenus?.(menus);
    }
  });
  React.useEffect(() => {
    if (!nativeBoardMenus || !activeCommands) return;
    return () => {
      nativeMenuSignature.current = '';
      window.electronAPI?.setBoardMenus?.([]);
    };
  }, [activeCommands, nativeBoardMenus]);

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
    const onBoardMenu = (event: CustomEvent<string>) => {
      const item = boardCommands.flatMap(({ items }) => items).find((item) => item && item.id === event.detail);
      if (item && !item.disabled) item.run();
    };
    window.addEventListener(boardMenuCommand, onBoardMenu);
    window.addEventListener(boardZoomCommand, onZoom);
    window.addEventListener(saveActiveBoard, onSave);
    window.addEventListener(boardHistoryCommand, onHistory);
    return () => {
      window.removeEventListener(boardMenuCommand, onBoardMenu);
      window.removeEventListener(boardZoomCommand, onZoom);
      window.removeEventListener(saveActiveBoard, onSave);
      window.removeEventListener(boardHistoryCommand, onHistory);
    };
  });

  function openBoardMenu(
    point: { x: number; y: number },
    hit?: BoardContextTarget,
  ) {
    if (textDrawing) return cancelText();
    if (copperDrawing) {
      const points = copperDrawing.shape === 'polygon' ? finishBoardPolygon(copperDrawing.points, hit?.at && canvasPosition(hit.at.x, -hit.at.y)) : [];
      if (points.length >= 3) finishCopperDrawing(points);
      else cancelCopperDrawing();
      return;
    }
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
    if (hit?.copper) selectCopperObject(hit.copper);
    if (hit?.artwork) selectPickedObject(hit.artwork);
    const componentId = hit ? hit.componentId : selected;
    const routeId = hit ? hit.routeId : selectedRouteId;
    if (hit?.componentId) selectComponent(hit.componentId);
    if (hit?.routeId) {
      selectComponent('');
      setSelectedRouteId(hit.routeId);
    }
    const polygon = hit?.at && hit.copper && copperAreaGeometry(board, hit.copper)?.kind === 'polygon'
      ? { target: hit.copper, at: hit.at, handle: hit.handle ?? -1 } : undefined;
    setBoardMenu({ point, componentId, routeId, routeStart: hit?.routeStart, copper: hit ? hit.copper : selectedCopper,
      artwork: hit ? hit.artwork : selectedSilk, polygon });
  }

  const boardMenuFootprint = boardMenu?.componentId
    ? board.footprints?.find(({ componentId }) => componentId === boardMenu.componentId)
    : undefined;
  const listModeMenu = <ListModeMenuButton
    listMode={bottomView === 'netlist' ? 'netlist' : 'symbols'}
    symbolsLabel="Components"
    onListModeChange={(mode) => openBoardList(mode === 'netlist' ? mode : 'components')}
    className="pcb-list-mode"
    stopPropagation
  />;
  const boardMenuItems: ContextMenuItem[] = [
    { key: 'undo', text: t('toolbar.contextMenu.undo'), disabled: !session.canUndo },
    { key: 'redo', text: t('toolbar.contextMenu.redo'), disabled: !session.canRedo },
    { key: 'divider_view', itemType: ContextualMenuItemType.Divider },
    { key: 'zoom_in', text: t('toolbar.contextMenu.zoomIn') },
    { key: 'zoom_out', text: t('toolbar.contextMenu.zoomOut') },
    { key: 'zoom_fit', text: 'Fit board' },
  ];
  if (boardMenuFootprint || boardMenu?.routeId) boardMenuItems.push({ key: 'fit_selection', text: 'Fit selection' });
  if (boardMenu?.routeStart && !routeDisabled)
    boardMenuItems.unshift({ key: 'route_pad', text: 'Route from pad' });
  const polygonTarget = boardMenu?.polygon;
  const menuShape = polygonTarget && copperAreaGeometry(board, polygonTarget.target);
  if (menuShape?.kind === 'polygon') boardMenuItems.unshift(...boardPolygonMenu(menuShape, polygonTarget.at, polygonTarget.handle));
  if (boardMenu?.copper || boardTextIndex(boardMenu?.artwork) >= 0)
    boardMenuItems.push({ key: 'delete', text: t('toolbar.contextMenu.delete') });

  const footprintPanel = <>
    <LibraryBrowserHeader>
      <div className="editor-side-panel-header">
        <LibrarySourceTabs label="Footprints" selected={footprintTab} onSelect={setFootprintTab}
          sources={[
            { value: 'unplaced', id: footprintTabId + '-unplaced-tab', panelId: footprintTabId + '-unplaced', label: 'Unplaced' },
            { value: 'library', id: footprintTabId + '-library-tab', panelId: footprintTabId + '-library', label: 'Library' },
          ]} />
      </div>
    </LibraryBrowserHeader>
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
        hasComponents={!!board.components?.length}
        sourceAction={onUpdate || session.readProjectCircuit ? 'Update PCB from Schematic…' : 'Import schematic or netlist…'}
        sourceDisabled={busy || routing || (!!onUpdate && session.dirty)}
        onSource={onUpdate ?? (() => setCircuitSourceOpen(true))}
        onGuide={(button) => {
          guideReturnFocus.current = button;
          setGuideOpen(true);
          openBoardTools();
        }}
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
      <Button size="small" onClick={() => window.dispatchEvent(new Event(editFootprintLibrary))}>Footprint editor…</Button>
      {!!board.footprintDefinitions?.length && (
        <label className="pcb-library-choice">
          Board footprints
          <Select value={libraryFootprintId} onChange={(event) => setLibraryFootprintId(event.target.value)}>
            <option value="">Choose a footprint</option>
            {board.footprintDefinitions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
      )}
      {libraryFootprint && <DeviceFootprintPreview footprint={libraryFootprint} selected="" />}
    </div>
  </>;

  const routeNetName = board.nets?.find(({ id }) => id === selectedNet)?.name;
  const canStartOnCopper = (board.tracks?.length || board.vias?.length ||
    geometry?.features.some(({ pads }) => pads.some(({ netId }) => !!netId)));
  const routeControls = routing && (
    <fieldset className="pcb-route-controls" aria-label="Route controls" disabled={busy}>
      <div className="pcb-route-bar">
        <div className="pcb-route-instruction" role="status">
          <strong>{route.length && routeNetName ? [routeSource, routeNetName].filter(Boolean).join(' · ') : 'Route track'}</strong>
          <span>{route.length
            ? 'Click same-net copper to finish, or click the board to add a corner.'
            : canStartOnCopper ? 'Click a pad, via, or track to start.'
              : 'Place a component with connected pads to start on copper.'}</span>
        </div>
        <div className="pcb-route-fields">
          <label>
            Route layer
            <Select
              ref={routeLayerControl}
              value={layer}
              onChange={(event) =>
                changeRouteLayer(event.target.value as CopperLayer['id'])
              }
            >
              {board.copperLayers.map(({ id }) => (
                <option key={id} value={id}>
                  {id === 'top' ? 'Top' : 'Bottom'}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Track width preset
            <Select value={widthPreset} onChange={(event) => {
              setTrackWidth(routeWidth);
              setWidthPreset(event.target.value as WidthPreset);
            }}>
              <option value="minimum">Minimum ({mm(routeRules.minWidthNm)} mm)</option>
              <option value="preferred">Preferred ({mm(preferredWidth)} mm)</option>
              <option value="custom">Custom</option>
            </Select>
          </label>
          {widthPreset === 'custom' && <label>
            Track width (mm)
            <Input size="small" value={trackWidth} onChange={(event) => setTrackWidth(event.target.value)} />
          </label>}
          {routeRules.maxWidthNm !== undefined && <p>Maximum track width {mm(routeRules.maxWidthNm)} mm</p>}
          <Button size="small" disabled={route.length < 2 && !reroute}
            title="Finish route (End)" onClick={() => { void finishRoute(); }}>Finish route</Button>
        </div>
      </div>
      <div role="status" className="pcb-route-clearance" aria-label="Route clearance">
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
      <details className="pcb-route-options">
        <summary>Routing options</summary>
        <div className="pcb-route-fields">
          <label>
            Route bend
            <Select value={routeBend} onChange={(event) => setRouteBend(event.target.value as RouteBend)}>
              <option value="straight-first">Straight first</option>
              <option value="diagonal-first">Diagonal first</option>
            </Select>
          </label>
          {board.copperLayers.length === 2 && (
            <>
              <label>
                Through-via style
                <Select value={viaStyle} onChange={(event) => {
                  if (viaStyle !== 'custom') {
                    setViaDiameter(mm(viaPresets[viaStyle].viaDiameterNm));
                    setViaDrill(mm(viaPresets[viaStyle].viaDrillNm));
                  }
                  setViaStyle(event.target.value as ViaStyle);
                }}>
                  <option value="compact">Compact ({mm(viaPresets.compact.viaDiameterNm)} mm diameter, {mm(viaPresets.compact.viaDrillNm)} mm drill)</option>
                  <option value="preferred">Preferred ({mm(viaPresets.preferred.viaDiameterNm)} mm diameter, {mm(viaPresets.preferred.viaDrillNm)} mm drill)</option>
                  <option value="custom">Custom</option>
                </Select>
              </label>
              {viaStyle === 'custom' && (
                <>
                  <label>
                    Via diameter (mm)
                    <Input size="small" value={viaDiameter} onChange={(event) => setViaDiameter(event.target.value)} />
                  </label>
                  <label>
                    Via drill (mm)
                    <Input size="small" value={viaDrill} onChange={(event) => setViaDrill(event.target.value)} />
                  </label>
                </>
              )}
            </>
          )}
        </div>
        <details>
          <summary>Enter route coordinates</summary>
          <form className="pcb-waypoint-entry" onSubmit={enterRoutePoint}>
            <label>
              Waypoint X (mm)
              <Input name="x" size="small" inputMode="decimal" required />
            </label>
            <label>
              Waypoint Y (mm)
              <Input name="y" size="small" inputMode="decimal" required />
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
      </details>
      <div role="status" data-copper-edit-pending={busy || undefined}>
        {busy ? t('pcbChecks.checkingCopper') : ''}
      </div>
    </fieldset>
  );

  const selectedRoutingProperties = (
    <div className="pcb-panel-scroll pcb-selection-properties">
      {routeSelection && (
        <fieldset disabled={busy}>
          <legend>
            {selectedTrack ? 'Selected track' : 'Selected via'}
          </legend>
          {selectedVia && (
            <label>
              Via solder mask
              <Select
                value={selectedVia.tenting ?? 'both'}
                disabled={selectedVia.locked}
                onChange={(event) => setViaTenting(event.target.value as ViaTenting)}
              >
                <option value="both">Tent both sides</option>
                <option value="top">Tent top only</option>
                <option value="bottom">Tent bottom only</option>
                <option value="none">Expose both sides</option>
              </Select>
            </label>
          )}
          {selectedTrack && (
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
          {(
            <Checkbox label={selectedTrack ? 'Lock track' : 'Lock via'}
              checked={!!routeSelection.locked} onChange={toggleRoutingLock} />
          )}
          <Button disabled={routeSelection.locked} onClick={() => previewDeletion({ kind: 'item', id: selectedRouteId })}>
            Delete selected copper
          </Button>
          {selectedTrack?.netId && !selectedTrack.locked && (
            <Button onClick={() => previewDeletion({
              kind: 'connection', trackId: selectedTrack.id,
              picked: pickedRoute.current?.id === selectedTrack.id ? pickedRoute.current.point : undefined,
            })}>Delete connection</Button>
          )}
        </fieldset>
      )}
      {routeGroup.length > 0 && (
        <Button disabled={busy} onClick={() => commitDeletion(planRouteDeletion(board, { kind: 'items', ids: routeGroup }))}>
          Delete selected copper
        </Button>
      )}
    </div>
  );

  const boardTools = (boardToolsOpen || (bottomView === 'selection' && (routeSelection || routeGroup.length > 0))) && (
    <section className="pcb-board-tools" aria-label="Board tools">
      <div className="pcb-right-heading"><strong>Board tools</strong><Button size="small" appearance="subtle" aria-label="Close board tools" onClick={() => {
        setBoardToolsOpen(false);
        if (routing) setRoutingMode(false);
        if (trackEdit) cancelTrackEdit();
        setMeasuring(false);
        setMeasurement([]);
        setDeleteRoute(undefined);
        setCleanupDraft(undefined);
        setSelectedRouteId('');
        setRouteGroup([]);
      }}>Close</Button></div>
              {boardToolsOpen && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup && <div className="pcb-panel-actions">
              <label>
                Copper layers{' '}
                <Select
                  value={board.copperLayers.length}
                  disabled={busy}
                  onChange={(event) => {
                    const count = event.target.value === '1' ? 1 : 2;
                    edit(() => session.apply([{ type: 'setCopperLayers', count }]));
                  }}
                >
                  <option value="1">One</option>
                  <option value="2">Two</option>
                </Select>
              </label>
              {(
                <label>
                  Grid (mm)
                  <Input size="small" value={snapGrid}
                    onChange={(event) => setSnapGrid(event.target.value)} />
                </label>
              )}
              </div>}
            {pickingObjects && <p role="status">Click the board to list objects under the pointer.</p>}
            {guideOpen && boardToolsOpen && (
              <FirstBoardGuide
                step={guideStep}
                onStepChange={setGuideStep}
                onClose={() => {
                  setGuideOpen(false);
                  (guideReturnFocus.current?.isConnected ? guideReturnFocus.current : guideToggle.current)?.focus();
                }}
                onUpdate={onUpdate}
                onOutline={() => setProfileDialog('outline')}
                onFabrication={() => setFabricationOpen(true)}
                onPlacement={() => {
                  setFootprintTab('unplaced');
                  onShowFootprints();
                  requestAnimationFrame(() => placementSearch.current?.focus());
                }}
                onRouting={() => setRoutingMode(true)}
                onChecks={showBoardChecks}
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
            {boardToolsOpen && !routing && (datum || dimensions.length > 0) && (
              <details>
                <summary>Dimensions and datum</summary>
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
            {trackEdit && (
              <fieldset>
                <legend>{trackEdit.action.kind === 'drag' ? 'Drag segment' : 'Move corner'}</legend>
                <p>Drag the handle on the board or enter coordinates.</p>
                <label>
                  Handle X (mm)
                  <Input size="small" value={trackEdit.x} disabled={busy}
                    onChange={(event) => setTrackEditDraft({ ...trackEdit, x: event.target.value })} />
                </label>
                <label>
                  Handle Y (mm)
                  <Input size="small" value={trackEdit.y} disabled={busy}
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
            {!routing &&
              !trackEdit &&
              !deletionDraft &&
              !cleanup &&
              selectedNet &&
              [...(board.tracks ?? []), ...(board.vias ?? [])].some(
                ({ netId }) => netId === selectedNet,
              ) && (
                <Button disabled={busy} onClick={() => previewDeletion({ kind: 'net', netId: selectedNet })}>
                  Delete routed net
                </Button>
              )}
            {!routing && !trackEdit && !deletionDraft && !cleanup &&
              (!!board.tracks?.length || !!board.vias?.length) && (
                <Button disabled={busy} onClick={() => previewDeletion({
                  kind: 'region', start: { x: '', y: '' }, end: { x: '', y: '' },
                  layer: visibleCopper === 'none' ? 'all' : visibleCopper,
                  picking: 'start',
                })}>Delete region…</Button>
              )}
            {!routing && !trackEdit && !deletionDraft && !cleanup &&
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
            {boardToolsOpen && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup && <>
            {!!board.mechanicalHoles?.length && (
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
            {!!board.profile?.cutouts.length && (
              <>
                <h3>Board cutouts</h3>
                <ol>
                  {board.profile.cutouts.map((_, index) => (
                    <li key={index}>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          if (board.profile.cutoutShapes?.[index]) selectCopperObject({ kind: 'cutout', id: String(index) });
                          else setProfileDialog(index);
                        }}
                      >
                        Edit cutout {index + 1}…
                      </Button>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => removeCopperObject({ kind: 'cutout', id: String(index), layer: 'both', label: '' })}
                      >
                        Remove cutout {index + 1}
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <h3>Copper zones</h3>
            {!!board.zones?.length && (
              <>
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
            </>}
    </section>
  );

  return (
    <section
      className="circuit-container pcb-workspace"
      aria-label="PCB layout"
      onKeyDown={(event) => {
        const target = event.target as Element;
        if (event.defaultPrevented ||
            (!event.currentTarget.contains(target) && !footprintsHost?.contains(target))) return;
        if (event.key === 'Delete' && target.closest('.pcb-svg') && canPickObjects && boardTextIndex(selectedSilk) >= 0) {
          event.preventDefault();
          deleteBoardText(selectedSilk);
          return;
        }
        if (copperDrawing && target.closest('.pcb-svg') && ['Enter', 'End'].includes(event.key)) {
          event.preventDefault();
          finishCopperDrawing();
          return;
        }
        if (event.key === 'End' && routing && (route.length > 1 || reroute) &&
            target.closest('.pcb-svg')) {
          event.preventDefault();
          void finishRoute();
          return;
        }
        if (event.key === 'Delete' && !routing && !trackEdit &&
            target.closest('.pcb-svg') && !busy && selectedCopper && !copperDrawing) {
          event.preventDefault();
          removeCopperObject(selectedCopper);
          return;
        }
        if (event.key === 'Delete' && !routing && !trackEdit &&
            target.closest('.pcb-svg') && (routeGroup.length || selectedRouteId)) {
          event.preventDefault();
          commitDeletion(planRouteDeletion(board, { kind: 'items', ids: routeGroup.length ? routeGroup : [selectedRouteId] }));
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          const key = event.key.toLowerCase();
          const editingText = target.closest('input, textarea, [contenteditable="true"]');
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
          if (target.closest('.pcb-svg')) {
            event.preventDefault();
            boardCanvas.current?.zoom(event.key === '-' ? 'out' : 'in');
            return;
          }
        }
        if (event.key !== 'Escape') return;
        if (textDrawing) {
          cancelText();
        } else if (copperDrawing) {
          cancelCopperDrawing();
        } else if (objectPick) {
          closeObjectPicker();
        } else if (placementTool && !busy && !routing && !measuring) {
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
              case 'route_pad': setRoutingMode(true, boardMenu.routeStart); break;
              case 'delete':
                if (boardMenu.copper) removeCopperObject(boardMenu.copper);
                else if (boardMenu.artwork) deleteBoardText(boardMenu.artwork);
                break;
              default:
                if (menuShape?.kind === 'polygon') {
                  const next = applyBoardPolygonCommand(menuShape, command, polygonTarget.at, polygonTarget.handle);
                  if (next !== menuShape) edit(() => session.apply([reshapeCopperArea(board, polygonTarget.target, next)]));
                }
            }
          }} />
      )}
      <EditorToolbar className="pcb-toolbar" label="PCB commands">
        {process.env.TARGET_SYSTEM !== 'electron' && (
          <EditorFileMenu>
            <EditorNewMenu submenu />
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
            {!manageClose && <MenuItem disabled={busy} onClick={closeStandaloneBoard}>
              Close board
            </MenuItem>}
          </EditorFileMenu>
        )}
        {process.env.TARGET_SYSTEM === 'electron' && <EditorNewMenu />}
        {!nativeBoardMenus && boardCommands.map(({ title, items }) => (
          <Menu key={title}>
            <MenuTrigger disableButtonEnhancement>
              <ToolbarButton appearance="subtle">{title}</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {items.map((item, index) => item === null ? <MenuDivider key={index} /> :
                  item && <MenuItem key={item.id} disabled={item.disabled} onClick={item.run}>
                    {item.label}
                  </MenuItem>)}
              </MenuList>
            </MenuPopover>
          </Menu>
        ))}
        <EditorSaveButton disabled={busy} onClick={() => { void save(); }} />
        {manageClose && activeCommands && <EditorSaveAllButton disabled={busy || saveAllDisabled} />}
        {session.canSaveAs && <EditorSaveButton saveAs label="Save As…" disabled={busy}
          onClick={() => { void save(true); }} />}
        <ToolbarDivider />
        <EditorHistoryControls compactLabels canUndo={!busy && session.canUndo} canRedo={!busy && session.canRedo}
          onUndo={() => edit(session.undo)} onRedo={() => edit(session.redo)} />
        <ToolbarDivider />
        <ToolbarButton
          ref={routeToggle}
          aria-pressed={routing}
          className={routing ? 'pcb-active-tool' : undefined}
          disabled={routeDisabled}
          icon={<img src={wireImage} width={18} height={18} alt="" />}
          onClick={() => setRoutingMode(!routing)}
        >
          {routing ? 'Cancel route' : 'Route track'}
        </ToolbarButton>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <ToolbarButton icon={<ChevronDownRegular />} data-active-pcb-tool={textDrawing ? 'text' : copperDrawing?.kind}
              className={copperDrawing || textDrawing ? 'pcb-active-tool' : undefined}>Draw</ToolbarButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {areaTools.map(({ kind, label }) => (
                <BoardShapeMenu key={kind} label={label} choices={areaToolShapes}
                  disabled={(!canPickObjects && copperDrawing?.kind !== kind) || (kind === 'zone' && !board.nets?.length)}
                  onDraw={(shape) => startCopperDrawing(kind, shape)} />
              ))}
              <BoardShapeMenu label="Hole or slot" choices={openingToolShapes}
                disabled={!canPickObjects && copperDrawing?.kind !== 'hole'} onDraw={(shape) => startCopperDrawing('hole', shape)} />
              <MenuItem disabled={textDisabled} onClick={startText}>{t('toolbar.text')}</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
        <ToolbarDivider />
        <ToolbarButton disabled={!geometry} onClick={() => boardCanvas.current?.fit()}>
          Fit board
        </ToolbarButton>
        <ToolbarButton disabled={checksDisabled} title={checkSummary} aria-label="Check board"
          icon={<CheckmarkCircleRegular />} onClick={showBoardChecks}>
          Check board
        </ToolbarButton>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <ToolbarButton ref={guideToggle} aria-label="More PCB commands" icon={<MoreHorizontalRegular />} />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem disabled={!geometry || (!routeSelection && !selectedFeatures.length && !routeGroup.length)}
                onClick={fitSelection}>Fit selection</MenuItem>
              <MenuItem disabled={busy || routing || !!copperDrawing} onClick={() => {
                setDeleteRoute(undefined);
                setCleanupDraft(undefined);
                setTrackEditDraft(undefined);
                setMeasuring(!measuring);
                setMeasurement([]);
                if (!measuring) openBoardTools();
              }}>{measuring ? 'End measurement' : 'Measure distance'}</MenuItem>
              <MenuItem className="pcb-overflow-view" disabled={!geometry} onClick={() => boardCanvas.current?.zoom('in')}>
                Zoom In
              </MenuItem>
              <MenuItem className="pcb-overflow-view" disabled={!geometry} onClick={() => boardCanvas.current?.zoom('out')}>
                Zoom Out
              </MenuItem>
              <MenuItem className="pcb-overflow-view" onClick={() => setShowRulers(!showRulers)}>
                {showRulers ? 'Hide rulers' : 'Show rulers'}
              </MenuItem>
              <MenuDivider />
              <MenuItem onClick={() => {
                guideReturnFocus.current = guideToggle.current;
                setGuideOpen(true);
                openBoardTools();
              }}>First board guide</MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>

        <div className="pcb-toolbar-view">
          <ViewToolbarControls
            canZoomIn={!!geometry}
            canZoomOut={!!geometry}
            showRulers={showRulers}
            onZoom={(direction) => boardCanvas.current?.zoom(direction)}
            onToggleRulers={() => setShowRulers(!showRulers)}
          />
        </div>
      </EditorToolbar>

      <Dialog open={confirmDiscard} onOpenChange={(_, { open }) => setConfirmDiscard(open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Discard unsaved PCB edits?</DialogTitle>
            <DialogContent>Edits made since the last save will be lost.</DialogContent>
            <DialogActions>
              <Button autoFocus onClick={() => setConfirmDiscard(false)}>Cancel</Button>
              <Button appearance="primary" onClick={onClose}>Discard edits</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      {fabricationOpen && (
        <BoardFabricationDialog
          board={board}
          advanced
          onClose={() => setFabricationOpen(false)}
          onApply={(operations) => setBoard(session.apply(operations))}
        />
      )}
      {ruleInspectionOpen && (
        <React.Suspense fallback={null}>
          <BoardRuleInspectionDialog board={board} zones={derivedResult?.zones}
            selectedCopperId={selectedRouteId || (selectedPad && selectedPlacement
              ? selectedPlacement.id + ':' + selectedPad : undefined)}
            selectedLayer={visibleCopper === 'top' || visibleCopper === 'bottom' ? visibleCopper : undefined}
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
      {circuitSourceOpen && <BoardCircuitSourceDialog board={board} readProjectCircuit={session.readProjectCircuit}
        onApply={(candidate) => {
          setBoard(session.commit({ ...candidate, revision: board.revision }));
          openBoardList('netlist');
        }}
        onClose={() => setCircuitSourceOpen(false)} />}
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
            onChecked={recordCheck}
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
      {rightPanelHost && createPortal(<>
        <BoardLayersPanel layers={availableLayers} hidden={hiddenLayers} locked={lockedLayers}
          routeLayer={routing ? layer === 'top' ? 'F.Cu' : 'B.Cu' : undefined}
          artworkDisabled={busy || routing} onLock={(id, locked) => {
            const next = new Set(lockedLayers);
            if (locked) {
              next.add(id);
              clearUnavailableSelection(hiddenLayers, next);
            } else next.delete(id);
            setLockedLayers(next);
          }}
          onVisibility={(id, visible) => {
            if (!visible) clearUnavailableSelection(new Set([...hiddenLayers, id]), lockedLayers);
            setLayerVisible(id, visible);
          }}
          onShowAll={() => setHiddenLayers(new Set())}
          onLockAll={(locked) => {
            const next = new Set(locked ? availableLayers.map(({ id }) => id) : []);
            if (locked) clearUnavailableSelection(hiddenLayers, next);
            setLockedLayers(next);
          }}
          onArtwork={() => setArtworkOpen(true)} onResetVisibility={() => {
            const hidden = defaultHiddenLayers();
            clearUnavailableSelection(hidden, lockedLayers);
            setHiddenLayers(hidden);
          }} />
        {boardTools}
      </>, rightPanelHost)}
      <Dialog open={artworkOpen} onOpenChange={(_, { open }) => setArtworkOpen(open)}>
        <DialogSurface className="pcb-dialog pcb-dialog-wide">
          <DialogBody>
            <DialogTitle>Board artwork</DialogTitle>
            <DialogContent>
              <FootprintArtworkEditor graphics={board.annotations?.graphics ?? []} busy={busy}
                copperTextLayers={hasBottomCopper ? ['F.Cu', 'B.Cu'] : ['F.Cu']}
                legend="Layer graphics" initiallyExpanded
                run={async (task) => {
                  try { task(); }
                  catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
                }}
                onChange={(items) => {
                  setBoard(changeAnnotations(datum, dimensions, items));
                  setError('');
                }} />
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions><Button onClick={() => setArtworkOpen(false)}>Done</Button></DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <div className="pcb-content">
        {lastCheck && lastCheck.revision !== board.revision && (
          <p className="pcb-editor-message" role="status">{checkSummary}</p>
        )}
        <div className="mid-container">
          {footprintsHost && createPortal(footprintPanel, footprintsHost)}
          <div className="main-content-area">
          <EditorDrawingStack bottomHeight={bottomPanelHeight} onBottomResize={onBottomPanelResize}
            bottomLabel="Board properties" resizeLabel="Resize board properties"
            drawing={geometry ? (
            <div className="pcb-drawing-layout" data-routing={routing || undefined}>
            {routeControls}
            {!routing && !footprintsVisible && unplaced.length > 0 && (
              <div className="pcb-start-actions">
                <Button size="small" onClick={() => {
                  setFootprintTab('unplaced');
                  onShowFootprints();
                  requestAnimationFrame(() => placementSearch.current?.focus());
                }}>Show unplaced components ({unplaced.length})</Button>
              </div>
            )}
            {placementTool && target && <div className="pcb-placement-instruction" role="status">
              Placing {target.reference ?? 'component'}. Click the board to place. Press Escape to cancel.
            </div>}
            <BoardCanvas
              board={board}
              geometry={geometry}
              canvasRef={boardCanvas}
              onPick={pickingObjects && canPickObjects
                ? (pick) => { setPickingObjects(false); setObjectPick(pick); } : undefined}
              hoveredObject={hoveredObject}
              selectedCopper={bottomView === 'selection' ? selectedCopper : undefined}
              onSelectCopper={selectCopperObject}
              onSelectArtwork={selectPickedObject}
              onMoveGraphic={moveGraphic}
              textDrawing={textDrawing}
              copperDrawing={copperDrawing && { points: copperDrawing.points, shape: copperDrawing.shape,
                snap: canvasPosition, add: addCopperPoint, finish: finishCopperDrawing }}
              areaEditing={selectedCopper && copperAreaGeometry(board, selectedCopper)}
              holeEditing={selectedCopper?.kind === 'hole' ? board.mechanicalHoles.find(({ id }) => id === selectedCopper.id) : undefined}
              snapShape={canvasPosition}
              onReshapeArea={(target, geometry) => edit(() => session.apply([reshapeCopperArea(board, target, geometry)]))}
              onReshapeHole={(hole: BoardMechanicalHole) => edit(() => session.apply([{ type: 'setMechanicalHole', hole }]))}
              selectedSilk={selectedSilk?.id}
              selected={selected}
              group={groupSelection}
              selectedPad={selectedPad}
              selectedNet={hoveredNet || selectedNet}
              selectedRoutes={new Set([...routeGroup, ...(selectedRouteId ? [selectedRouteId] : [])])}
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
              selectionEnabled={!busy && !routing && !measuring && !trackEdit && !deletionDraft &&
                !cleanup && !placementTool && !pickingObjects && !copperDrawing && !textDrawing}
              onSelectArea={selectArea}
              onMoveComponent={moveComponentOnCanvas}
              placementActive={!busy && !routing && !measuring && !!placementTool && placementTool === target?.id}
              placementPreview={currentPlacementPreview()}
              onDropComponent={!busy && !routing && !measuring && !trackEdit && !deletionDraft && !cleanup && !copperDrawing && !textDrawing
                ? (id, x, y) => armPlacement(id, canvasPosition(x, y)) : undefined}
              onContextCommand={openBoardMenu}
              visibleCopper={visibleCopper}
              hiddenLayers={hiddenLayers}
              pickableLayers={pickableLayers}
              trackWidthNm={Number(canonicalBoardDecimal(routeWidth)) * 1_000_000 || 0}
              onLocation={(x, y) => {
                if (busy) return;
                const location = canvasPosition(x, y);
                if (textDrawing) saveBoardText({ ...textDrawing, at: location });
                else if (regionPicking) chooseRegionPoint(location);
                else if (deletionDraft || cleanup) return;
                else if (trackEdit) moveTrackHandle(location);
                else if (routing) void routePoint(location);
                else if (measuring) measureAt(location);
                else if (placementTool && placementTool === target?.id) void place(location);
                else if (!pickingObjects) selectArea([], [], false);
              }}
              routingSnap={routing ? {
                layer,
                activeNet: route.length ? selectedNet : undefined,
                connect: ({ position, netId }, label) => { void routePoint(position, netId, label); },
                preview: (x, y, target) => previewRouteLeg(target ?? canvasPosition(x, y)),
              } : undefined}
              onComponent={(id) => { if (!deletionDraft && !cleanup) selectComponent(id); }}
              onGroupComponent={
                routing || measuring || deletionDraft || cleanup
                  ? undefined
                  : (id) => toggleGroupComponent(id, true)
              }
              onPad={(componentId, id, position) => {
                if (deletionDraft || cleanup) return;
                if (measuring) measureAt(position);
                else if (trackEdit) moveTrackHandle(position);
                else selectComponent(componentId, id);
              }}
              onRouteObject={(id, netId, point, wholeRoute) => {
                if (routing || trackEdit || deletionDraft || cleanup) return;
                setObjectPick(undefined);
                setCopperSelection(undefined);
                setHoveredObject(undefined);
                setBottomView('selection');
                setSelected('');
                setSelectedPad(undefined);
                setGroup([]);
                const tracks = wholeRoute ? new Map(board.tracks?.map(({ id, layerId }) => [id, layerId])) : undefined;
                setRouteGroup(wholeRoute ? connectedRouteIds(board, id, point).filter((routeId) =>
                  canPickOnLayers(pickableLayers, { kind: 'track', layer: tracks.get(routeId) ?? 'both' })) : []);
                pickedRoute.current = point ? { id, point } : undefined;
                setSelectedRouteId(wholeRoute ? '' : id);
                setSelectedNet(netId ?? '');
                setSelectedSilk(undefined);
                boardCanvas.current?.focus();
              }}
            />
            </div>
          ) : (
            <p role="alert">{layout.error}</p>
          )}>
            {objectPick ? <BoardPickPanel pick={objectPick}
              onHover={setHoveredObject} onSelect={selectPickedObject} onClose={closeObjectPicker} /> : <>
              {bottomView === 'netlist' && (
                <BoardNetlistPanel board={board} selectedNet={selectedNet} listModeMenu={listModeMenu}
                  onSelect={route.length || deletionDraft || cleanup ? undefined : (id) => {
                    setHoveredNet('');
                    setSelectedNet(id);
                  }}
                  onHover={routing || deletionDraft || cleanup ? undefined : setHoveredNet}>
                  {netSources.length > 0 && <details open key={selectedNet}>
                    <summary>Schematic net terminals</summary>
                    <ul aria-label="Schematic net terminals">
                      {netSources.map(({ id, reference, signal, number, source }) => (
                        <li key={id}><Button size="small" onClick={() => onProbe?.(source)}>
                          {reference} / {signal}{number ? ' / ' + number : ''}
                        </Button></li>
                      ))}
                    </ul>
                  </details>}
                </BoardNetlistPanel>
              )}
      {bottomView === 'checks' && (
        <BoardChecksPanel key={checksRun}
          board={board}
          readProjectCircuit={session.readProjectCircuit}
          waitForRefill={waitForRefill}
          filename={filename}
          onChecked={recordCheck}
          onClose={() => openBoardList(idleBottomView)}
          onWaive={(waiver) =>
            edit(() => session.apply([{ type: 'addWaiver', waiver }]))
          }
          onRemoveWaiver={(id) =>
            edit(() => session.apply([{ type: 'removeWaiver', id }]))
          }
          onProbe={onProbe && ((source) => {
            onProbe(source);
          })}
          onInspect={({ objects, location }) => {
            setLayerVisible('F.Cu', true);
            setLayerVisible('B.Cu', true);
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
            setBottomView('checks');
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
              {bottomView === 'selection' && !placementTool && !copperDrawing && !textDrawing && (
                <div className="pcb-property-navigation">
                  <Button size="small" appearance="subtle" onClick={() => openBoardList(idleBottomView)}>
                    {idleBottomView === 'netlist' ? 'Back to Netlist' : 'Back to Components'}
                  </Button>
                </div>
              )}
              {bottomView === 'selection' && !routing && !trackEdit && !deletionDraft && !cleanup &&
                (routeSelection || routeGroup.length > 0) && selectedRoutingProperties}
              {bottomView === 'selection' && routeGroup.length > 0 && (
                <p className="pcb-editor-message">
                  {routeGroup.length} {routeGroup.length === 1 ? 'copper object' : 'copper objects'} selected
                </p>
              )}
              {bottomView === 'selection' && selectedSilk && !selectedSilk.componentId && boardTextIndex(selectedSilk) < 0 && (
                <p className="pcb-editor-message">Selected artwork · {selectedSilk.label}</p>
              )}
              {bottomView === 'components' && <div className="pcb-navigation-grid">
                <PersistentDataGrid
                  ariaLabel="Placed components"
                  stateKey="BoardComponentListPanel"
                  items={[
                    ...(geometry?.features ?? []).map(({ id, label, placement }): BoardPickTarget =>
                      ({ kind: 'component', id, label, layer: placement.side })),
                    ...(board.annotations?.graphics ?? []).flatMap((item, index): BoardPickTarget[] =>
                      item.kind === 'text' ? [{ kind: 'artwork', id: 'artwork:' + index, label: item.text,
                        boardLayer: item.layer, layer: 'both' }] : []),
                    ...copperObjects.map((item) => ({ ...item, label: copperObjectLabels[item.kind] + ' · ' + item.label })),
                  ]}
                  getRowId={({ kind, id }) => kind === 'component' ? id : kind + ':' + id}
                  onRowClick={selectPickedObject}
                  onRowMouseEnter={(item) => setHoveredObject(canPickOnLayers(pickableLayers, item) ? item : undefined)}
                  onRowMouseLeave={() => setHoveredObject(undefined)}
                  defaultSortColumn="reference"
                  columnSizingOptions={componentColumnSizing}
                  columns={[{
                    columnId: 'reference',
                    compare: (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }),
                    renderHeaderCell: () => 'Reference',
                    renderCell: (item) => (
                      <Button size="small" appearance="subtle"
                        disabled={!canPickOnLayers(pickableLayers, item)}
                        onFocus={() => setHoveredObject(item)}
                        onBlur={() => setHoveredObject(undefined)}
                        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                          event.stopPropagation();
                          if (event.shiftKey && item.kind === 'component') toggleGroupComponent(item.id, true);
                          else selectPickedObject(item);
                        }}>
                        {item.label}
                      </Button>
                    ),
                  }, ...layerColumnLabels.map((label, index) => ({
                    columnId: index === 0 ? 'layer' : 'layer2',
                    compare: (a: BoardPickTarget, b: BoardPickTarget) =>
                      (pickerLayers(a)[index] ?? '').localeCompare(pickerLayers(b)[index] ?? ''),
                    renderHeaderCell: () => index === layerColumnLabels.length - 1
                      ? <div className="pcb-list-header pcb-component-list-header"><span>{label}</span>{listModeMenu}</div>
                      : label,
                    renderCell: (item: BoardPickTarget) => {
                      const id = pickerLayers(item)[index];
                      if (!id) return null;
                      const layerLabel = boardLayerById.get(id).label;
                      const visible = !hiddenLayers.has(id);
                      const locked = lockedLayers.has(id);
                      const visibilityLabel = visible ? 'Visible' : 'Hidden';
                      const lockLabel = locked ? 'Locked' : 'Unlocked';
                      return <div className="pcb-picker-layer">
                        <span role="img" aria-label={visibilityLabel} title={visibilityLabel}><LayerVisibilityIcon visible={visible} /></span>
                        <span role="img" aria-label={lockLabel} title={lockLabel}><LayerLockIcon locked={locked} /></span>
                        <span className="pcb-picker-layer-label" title={layerLabel}>{layerLabel}</span>
                      </div>;
                    },
                  }))]}
                />
              </div>}
              {copperDrawing && <section className="pcb-panel-scroll" aria-label={copperObjectLabels[copperDrawing.kind] + ' drawing'}>
                <p>{copperDrawing.kind === 'jumper'
                  ? 'Click the two jumper endpoints.'
                  : copperDrawing.shape === 'polygon' ? 'Click to add points. Right-click to finish.'
                  : copperDrawing.shape === 'round-hole' ? 'Drag from the centre to set the hole diameter.'
                  : copperDrawing.shape === 'slot' ? 'Drag between the slot endpoints.'
                  : 'Drag between opposite corners.'}</p>
                {(copperDrawing.kind === 'zone' || copperDrawing.kind === 'jumper') && <label>
                  Net <Select value={copperDrawing.netId}
                    onChange={(event) => setCopperDrawing({ ...copperDrawing, netId: event.target.value })}>
                    {board.nets?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                  </Select>
                </label>}
                {copperDrawing.kind === 'zone' && <label>
                  Layer <Select value={copperDrawing.layerId}
                    onChange={(event) => {
                      const layerId = event.target.value as CopperLayer['id'];
                      setLayerVisible(layerId === 'top' ? 'F.Cu' : 'B.Cu', true);
                      setCopperDrawing({ ...copperDrawing, layerId });
                    }}>
                    {board.copperLayers.map(({ id }) => <option key={id} value={id}>{id === 'top' ? 'Top' : 'Bottom'}</option>)}
                  </Select>
                </label>}
              </section>}
              {textDrawing && <div className="pcb-panel-scroll pcb-selection-properties">
                <StylePanelLayout><StylePanelSection title="Place text">
                  <BoardTextFields item={textDrawing} layers={textLayers} pickableLayers={pickableLayers} onChange={setTextDrawing} autoFocus />
                  <p>Enter text, choose its layer, then click the board to place it.</p>
                </StylePanelSection></StylePanelLayout>
              </div>}
              {bottomView === 'selection' && boardTextIndex(selectedSilk) >= 0 && (
                <div className="pcb-panel-scroll pcb-selection-properties">
                  <StylePanelLayout><StylePanelSection title="Board text">
                    <BoardTextEditor key={selectedSilk.id + ':' + board.revision}
                      item={board.annotations.graphics[boardTextIndex(selectedSilk)] as BoardText}
                      layers={textLayers} pickableLayers={pickableLayers} onApply={(item) => saveBoardText(item, boardTextIndex(selectedSilk))} />
                  </StylePanelSection></StylePanelLayout>
                </div>
              )}
              {!copperDrawing && bottomView === 'selection' && selectedCopper && (
                <section className="pcb-panel-scroll pcb-selection-properties" aria-label={copperObjectLabels[selectedCopper.kind]}>
                  <StylePanelLayout>
                    <StylePanelSection title={copperObjectLabels[selectedCopper.kind]}>
                      <fieldset key={selectedCopper.kind + ':' + selectedCopper.id + ':' + board.revision} disabled={busy || routing}
                        aria-label={selectedCopper.label} style={{ border: 0, margin: 0, padding: 0 }}>
                        {copperAreaGeometry(board, selectedCopper)?.kind === 'polygon' && (
                          <p>Right-click an edge to add points or curves. Right-click a handle to delete it.</p>
                        )}
                        {renderCopperProperties(selectedCopper)}
                      </fieldset>
                    </StylePanelSection>
                  </StylePanelLayout>
                </section>
              )}
              {bottomView === 'selection' && (target || groupMembers.length > 0 || sourcePads.length > 0) && (
                <div className="pcb-panel-scroll pcb-selection-properties">
                  {groupMembers.length > 0 && (
                    <fieldset disabled={busy || routing || measuring}>
                      <legend>Placement group</legend>
                      <p>
                        {groupMembers.length} selected · Anchor {groupAnchor?.label}
                      </p>
                      <label>
                        Group operation{' '}
                        <Select
                          value={groupMode}
                          onChange={(event) => setGroupMode(event.target.value)}
                        >
                          <option value="translate">Move by offset</option>
                          <option value="rotate">Rotate about anchor</option>
                          <option value="align-x">Align X to anchor</option>
                          <option value="align-y">Align Y to anchor</option>
                          <option value="distribute-x">Distribute along X</option>
                          <option value="distribute-y">Distribute along Y</option>
                        </Select>
                      </label>{' '}
                      {groupMode === 'translate' && (
                        <>
                          <label>
                            Group X offset (mm){' '}
                            <Input
                              size="small"
                              value={groupX}
                              onChange={(event) => setGroupX(event.target.value)}
                            />
                          </label>{' '}
                          <label>
                            Group Y offset (mm){' '}
                            <Input
                              size="small"
                              value={groupY}
                              onChange={(event) => setGroupY(event.target.value)}
                            />
                          </label>{' '}
                        </>
                      )}
                      {groupMode === 'rotate' && (
                        <label>
                          Group rotation (°){' '}
                          <Input
                            size="small"
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
                    </fieldset>
                  )}
                  {target && (
                    <fieldset className="pcb-position-form" disabled={busy || routing || measuring}>
                      <legend>
                        {selectedPlacement ? 'Position' : 'Place'}{' '}
                        {target.reference ?? 'component'}
                      </legend>
                      <div className="pcb-position-fields">
                      <label>
                        X (mm){' '}
                        <Input
                          size="small"
                          value={positionLocked ? mm(selectedPlacement.positionNm.x) : x}
                          disabled={positionLocked}
                          onChange={(e) => {
                            setX(e.target.value);
                            setQueuePositionSet(true);
                          }}
                        />
                      </label>
                      <label>
                        Y (mm){' '}
                        <Input
                          size="small"
                          value={positionLocked ? mm(selectedPlacement.positionNm.y) : y}
                          disabled={positionLocked}
                          onChange={(e) => {
                            setY(e.target.value);
                            setQueuePositionSet(true);
                          }}
                        />
                      </label>
                      <label>
                        Rotation (°){' '}
                        <Input
                          size="small"
                          value={
                            rotationLocked
                              ? mm(selectedPlacement.rotationMicrodegree)
                              : rotation
                          }
                          disabled={rotationLocked}
                          onChange={(e) => setRotation(e.target.value)}
                        />
                      </label>
                      <label>
                        Layer{' '}
                        <Select
                          aria-label="Layer"
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
                        </Select>
                      </label>
                      </div>
                      <div className="pcb-position-actions">
                      {selectedPlacement && (
                        <div className="pcb-position-locks" role="group" aria-label="Placement locks">
                          <Checkbox label="Lock component" checked={!!selectedPlacement.locked}
                            onChange={() => togglePlacementLock('locked')} />
                          <Checkbox label="Lock position" checked={!!selectedPlacement.positionLocked}
                            disabled={selectedPlacement.locked} onChange={() => togglePlacementLock('positionLocked')} />
                          <Checkbox label="Lock rotation" checked={!!selectedPlacement.rotationLocked}
                            disabled={selectedPlacement.locked} onChange={() => togglePlacementLock('rotationLocked')} />
                        </div>
                      )}
                      {(
                        <Checkbox label="Show straight-line estimates" checked={showPlacementEstimates}
                          onChange={(_, { checked }) => setShowPlacementEstimates(checked === true)} />
                      )}
                      <Button
                        appearance={selectedPlacement ? 'primary' : 'secondary'}
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
                      </div>
                    </fieldset>
                  )}
                  {selectedSilk && <p>Selected silkscreen · {selectedSilk.label} · {selectedSilk.layer}</p>}
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
            </>}
          </EditorDrawingStack>
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
