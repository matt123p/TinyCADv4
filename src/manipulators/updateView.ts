import { dsnView, FindResult } from '../model/dsnView';
import {
  dsnRectangle,
  DocItemTypes,
  dsnEllipse,
  dsnText,
  Coordinate,
  DocItem,
  dsnLine,
  dsnWire,
  dsnNoConnect,
  dsnLabel,
  dsnBusSlash,
  dsnBusWire,
  dsnDesignRuler,
  dsnJunction,
  dsnPower,
  dsnBusLabel,
  dsnSymbol,
  dsnImage,
  dsnPin,
  SymbolTextItem,
} from '../model/dsnItem';
import { get_global_id } from '../util/global_id';
import {
  dsnDrawing,
  dsnSheet,
  libImage,
  libSymbol,
  Size,
} from '../model/dsnDrawing';
import {
  isText,
  isStroked,
  isFilled,
  isTextColour,
  isBorderStyle,
} from '../model/dsnTypeGuards';
import {
  updateFactory,
  updateSimpleAddFactory,
  updateMoveAddFactory,
  updateTextFactory,
  updateSimpleDragFactory,
  updateLineFactoryFactory,
  updateAPFactory,
  updateRotateFactory,
} from './updateFactory';
import { UtilityService } from '../util/utilityService';
import {
  IsInsideResult,
  MergedStyle,
  ContextMenuList,
  ContextualMenuItemType,
} from './updateInterfaces';
import update from 'immutability-helper';
import { XMLBuilder } from '../util/xmlbuilder';
import { Snap } from './snap';
import { updateWire } from './updateWire';
import { PointToPointWireRouter } from './pointToPointWireRouter';
import { ioXML } from '../io/ioXml';
import { dragObject } from './dragObject';
import { updateSymbol } from './updateSymbol';
import { updatePower } from './updatePower';
import { updatePin } from './updatePin';
import { updateLabel } from './updateLabel';
import { updateBusLabel } from './updateBusLabel';
import { dsnBomEntry } from '../model/dsnBomEntry';
import { tclibLibraryEntry } from '../model/tclib';
import { ReplaceSymbolScope } from '../state/actions/symbolActions';
import md5 from 'md5';
import { store } from '../startup';
import {
  actionMenuSetContextMenu,
  actionSelectDialog,
} from '../state/dispatcher/AppDispatcher';
import i18n from '../i18n';

const MIN_ZOOM = 10;
const MAX_ZOOM = 400;
const ZOOM_STEP = 1.25;

function StyleSet<T>(original: T, value: T): T {
  if (original === undefined || original === value) {
    return value;
  } else {
    return null;
  }
}

function StyleMerge<T>(value: any, original: T): T {
  if (value === undefined || value === null) {
    return original;
  } else {
    return value;
  }
}

export interface DeltaCoordinate {
  dx: number;
  dy: number;
}

export interface SheetColours {
  color_background: string;
  color_bus: string;
  color_hidden_pin: string;
  color_junction: string;
  color_label: string;
  color_noconnect: string;
  color_notetext_fill: string;
  color_notetext_line: string;
  color_notetext_text: string;
  color_pin: string;
  color_power: string;
  color_wire: string;
  show_label_connection_point: boolean;
}

export interface SheetOptions extends SheetColours {
  show_grid: boolean;
  units: number;
}

export const style_names = {
  line: ['stroked', 'line_colour', 'line_width', 'line_pattern'],
  fill: ['filled', 'fill_colour'],
  text: ['font_name', 'font_size', 'font_bold', 'font_italic'],
  text_colour: ['font_colour'],
  border_style: ['rounded_rect'],
};

export interface viewResult {
  view: dsnView;
  sheet: dsnSheet;
}

export class updateView {
  constructor() {}

  private wirePointKey(point: Coordinate): string {
    return point[0] + ':' + point[1];
  }

  private addWireEndpoint(
    endpointMap: Map<string, number[]>,
    point: Coordinate,
    wireId: number,
  ) {
    const key = this.wirePointKey(point);
    const existing = endpointMap.get(key);
    if (existing) {
      existing.push(wireId);
    } else {
      endpointMap.set(key, [wireId]);
    }
  }

  private extendWireChainFromEndpoint(
    wiresById: Map<number, dsnWire>,
    endpointMap: Map<string, number[]>,
    selectedIds: Set<number>,
    startWire: dsnWire,
    endpointIndex: number,
  ) {
    let currentWire = startWire;
    let currentEndpointIndex = endpointIndex;

    while (currentWire.d_points.length > 1) {
      const currentPoint = currentWire.d_points[currentEndpointIndex];
      const connectedIds = (endpointMap.get(this.wirePointKey(currentPoint)) || [])
        .filter((wireId) => wireId !== currentWire._id && !selectedIds.has(wireId));

      if (connectedIds.length !== 1) {
        return;
      }

      const nextWire = wiresById.get(connectedIds[0]);
      if (!nextWire || nextWire.d_points.length < 2) {
        return;
      }

      const lastIndex = nextWire.d_points.length - 1;
      if (this.samePoint(nextWire.d_points[0], currentPoint)) {
        selectedIds.add(nextWire._id);
        currentWire = nextWire;
        currentEndpointIndex = lastIndex;
      } else if (this.samePoint(nextWire.d_points[lastIndex], currentPoint)) {
        selectedIds.add(nextWire._id);
        currentWire = nextWire;
        currentEndpointIndex = 0;
      } else {
        return;
      }
    }
  }

  private extendWireNetFromSeed(
    wiresById: Map<number, dsnWire>,
    endpointMap: Map<string, number[]>,
    selectedIds: Set<number>,
    startWire: dsnWire,
  ) {
    const pending: number[] = [startWire._id];

    while (pending.length > 0) {
      const wireId = pending.pop();
      const wire = wiresById.get(wireId);
      if (!wire || wire.d_points.length < 2) {
        continue;
      }

      const endpoints = [wire.d_points[0], wire.d_points[wire.d_points.length - 1]];
      for (const endpoint of endpoints) {
        const connectedIds = endpointMap.get(this.wirePointKey(endpoint)) || [];
        for (const connectedId of connectedIds) {
          if (selectedIds.has(connectedId)) {
            continue;
          }

          selectedIds.add(connectedId);
          pending.push(connectedId);
        }
      }
    }
  }

  private getWireSelectionItems(
    sheet: dsnSheet,
    item: DocItem,
    includeBranches: boolean,
  ): DocItem[] {
    if (item.NodeName !== DocItemTypes.Wire || item.d_points.length < 2) {
      return [item];
    }

    const wiresById = new Map<number, dsnWire>();
    const endpointMap = new Map<string, number[]>();
    for (const candidate of sheet.items) {
      if (candidate.NodeName !== DocItemTypes.Wire || candidate.d_points.length < 2) {
        continue;
      }

      wiresById.set(candidate._id, candidate);
      this.addWireEndpoint(endpointMap, candidate.d_points[0], candidate._id);
      this.addWireEndpoint(
        endpointMap,
        candidate.d_points[candidate.d_points.length - 1],
        candidate._id,
      );
    }

    const selectedIds = new Set<number>([item._id]);
    if (includeBranches) {
      this.extendWireNetFromSeed(wiresById, endpointMap, selectedIds, item);
    } else {
      this.extendWireChainFromEndpoint(
        wiresById,
        endpointMap,
        selectedIds,
        item,
        0,
      );
      this.extendWireChainFromEndpoint(
        wiresById,
        endpointMap,
        selectedIds,
        item,
        item.d_points.length - 1,
      );
    }

    return sheet.items.filter((candidate) => selectedIds.has(candidate._id));
  }

  private unselectItems(view: dsnView, sheet: dsnSheet, items: DocItem[]): dsnView {
    const idsToRemove = new Set(items.map((item) => item._id));
    return this._updateSelection(
      view,
      sheet,
      view._selected_handle,
      view._selected_array.filter((id) => !idsToRemove.has(id)),
    );
  }

  // Get the selected symbol
  getSelectedSymbol(view: dsnView, sheet: dsnSheet) {
    if (view._selected_array.length === 1) {
      let id = view._selected_array[0];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      if (a && a.NodeName === DocItemTypes.Symbol) {
        return a;
      }
    }

    return null;
  }

  // Get the selected pin
  getSelectedPin(view: dsnView, sheet: dsnSheet) {
    if (view._selected_array.length === 1) {
      let id = view._selected_array[0];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      if (a && a.NodeName === DocItemTypes.Pin) {
        return a;
      }
    }

    return null;
  }

  // Get the selected text handler
  getSelectedText(view: dsnView, sheet: dsnSheet): DocItem {
    // Get a union of all of the styles of the selected objects
    if (view._selected_array.length === 1) {
      let id = view._selected_array[0];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      if (a && isText(a)) {
        return a;
      }
    }

    return null;
  }

  // The selected item
  getSelected(view: dsnView, sheet: dsnSheet): DocItem {
    // Get a union of all of the styles of the selected objects
    if (view._selected_array.length === 1) {
      let id = view._selected_array[0];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      return a;
    }

    return null;
  }

  // Zoom
  can_zoom_in(view: dsnView, sheet: dsnSheet) {
    return view.zoom < MAX_ZOOM;
  }

  can_zoom_out(view: dsnView, sheet: dsnSheet) {
    return view.zoom > MIN_ZOOM;
  }

  clampZoom(zoom: number) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  // Clipboard operations
  //

  // Copy the document to the clipboard
  can_paste(view: dsnView, sheet: dsnSheet) {
    return true;
  }

  can_copy(view: dsnView, sheet: dsnSheet) {
    return view._selected_array.length > 0;
  }

  can_rotate(view: dsnView, sheet: dsnSheet) {
    if (view._selected_array.length > 1) {
      return true;
    } else if (view._selected_array.length === 1) {
      let a = sheet.items.find((e) => {
        return e._id === view._selected_array[0];
      });

      const updater_a = updateFactory(a);
      return a && updater_a.can_rotate();
    }

    return false;
  }

  can_flip(view: dsnView, sheet: dsnSheet) {
    if (view._selected_array.length === 1) {
      let a = sheet.items.find((e) => {
        return e._id === view._selected_array[0];
      });
      return a && a.NodeName === DocItemTypes.Symbol;
    }

    return false;
  }

  // The user is adding an item to the document
  public add_event(
    view: dsnView,
    sheet: dsnSheet,
    event_name: string,
    p: Coordinate,
    r: Coordinate,
    key: number,
  ): viewResult {
    if (view.menu_command === 'add_wire_point_to_point') {
      return this.add_point_to_point_wire_event(view, sheet, event_name, p);
    }

    // The user can cancel with a rbuttondown
    if (event_name === 'rbuttondown') {
      if (view.in_add_rect) {
        return this.complete_add(view, sheet);
      } else {
        return this.cancel_add(view, sheet);
      }
    } else if (event_name === 'lbuttondown') {
      return this.click_add(view, sheet, p);
    } else if (event_name === 'mousemove' && view.in_add_rect) {
      // Ok, the user is adding an item
      return this.move_add(view, sheet, p);
    } else if (event_name === 'mousemove' && !view.in_add_rect) {
      // Ok, the user is adding an item
      return this.mousemove_add(view, sheet, p);
    } else if (event_name === 'mousedrag' && view.in_add_rect) {
      return this.drag_add(view, sheet, p);
    } else if (event_name === 'dragend' && view.in_add_rect) {
      return this.end_add(view, sheet, p);
    } else {
      if (view.cursor !== 'copy') {
        return {
          view: update(view, {
            cursor: { $set: 'copy' },
          }),
          sheet: sheet,
        };
      }
    }

    return { view: view, sheet: sheet };
  }

  public rebuildHatches(sheet: dsnSheet): dsnSheet {
    let hatches = sheet.items
      .map((i) => (isFilled(i) ? i : null))
      .filter((i) => i?.hatch >= 0)
      .map((filled) => ({
        // ID for this hatch
        id: `hatch${filled.hatch}${filled.fill_colour}`,
        index: filled.hatch,
        color: filled.fill_colour,
      }));

    // Remove duplicates
    hatches = hatches.filter(
      (hatch, index) => index === hatches.findIndex((t) => t.id === hatch.id),
    );

    return update(sheet, {
      hatches: {
        $set: hatches,
      },
    });
  }

  ////////////////// ADD ITEM HANDLER //////////////////

  private add_point_to_point_wire_event(
    view: dsnView,
    sheet: dsnSheet,
    event_name: string,
    p: Coordinate,
  ): viewResult {
    if (event_name === 'rbuttondown') {
      return this.cancel_add(view, sheet);
    }

    if (event_name === 'lbuttondown') {
      return this.click_add_point_to_point_wire(view, sheet, p);
    }

    if (event_name === 'mousemove' || event_name === 'mousedrag') {
      return this.move_add_point_to_point_wire(view, sheet, p);
    }

    if (view.cursor !== 'copy') {
      return {
        view: update(view, {
          cursor: { $set: 'copy' },
        }),
        sheet,
      };
    }

    return { view, sheet };
  }

  private move_add_point_to_point_wire(
    view: dsnView,
    sheet: dsnSheet,
    p: Coordinate,
  ): viewResult {
    const add = view.add as dsnWire;
    if (!add || add.NodeName !== DocItemTypes.Wire) {
      return { view, sheet };
    }

    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    const magnetic = snap.snap_magnetic(p, false, sheet.items);
    const startPoint = add.d_points.length > 0 ? add.d_points[0] : null;
    let d_points: Coordinate[] = [];
    let display = magnetic != null;
    let previewMagnetic = magnetic;

    if (startPoint) {
      display = true;
      previewMagnetic = magnetic || { point: startPoint.slice(0), wire: null };
      if (magnetic && !this.samePoint(startPoint, magnetic.point)) {
        const preview = view.tracker.pointToPointPreview;
        const canReuseWorkspace =
          preview &&
          preview.items === sheet.items &&
          preview.grid === sheet.details.grid &&
          this.samePoint(preview.start, startPoint);
        const previewWorkspace = canReuseWorkspace
          ? preview.workspace as ConstructorParameters<typeof PointToPointWireRouter>[1]
          : undefined;
        const router = new PointToPointWireRouter(
          sheet,
          previewWorkspace,
        );
        d_points = router.route(
          startPoint,
          magnetic.point,
          canReuseWorkspace ? preview.route : null,
        );
        view.tracker.pointToPointPreview = {
          start: startPoint.slice(0),
          end: magnetic.point.slice(0),
          route: d_points.map((point) => point.slice(0)),
          workspace: router.getWorkspace(),
          items: sheet.items,
          grid: sheet.details.grid,
        };
      } else {
        d_points = [startPoint.slice(0)];
        view.tracker.pointToPointPreview = null;
      }
    }

    return {
      view: update(view, {
        add: {
          $set: update(add, {
            _magnetic: { $set: previewMagnetic },
            d_points: { $set: d_points },
          }),
        },
        display_add: { $set: display },
        cursor: { $set: 'copy' },
      }),
      sheet,
    };
  }

  private click_add_point_to_point_wire(
    view: dsnView,
    sheet: dsnSheet,
    p: Coordinate,
  ): viewResult {
    const add = view.add as dsnWire;
    if (!add || add.NodeName !== DocItemTypes.Wire) {
      return { view, sheet };
    }

    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    let magnetic = snap.snap_magnetic(p, false, sheet.items);
    if (!magnetic) {
      return { view, sheet };
    }

    if (add.d_points.length === 0) {
      view.tracker.pointToPointPreview = null;
      let items = sheet.items;
      ({ magnetic, items } = this.split_magnetic_wire_if_needed(magnetic, items));
      const nextSheet = items !== sheet.items
        ? update(sheet, {
            items: { $set: items },
          })
        : sheet;

      return {
        view: update(view, {
          add: {
            $set: update(add, {
              _magnetic: { $set: magnetic },
              d_points: { $set: [magnetic.point.slice(0)] },
            }),
          },
          display_add: { $set: true },
          in_add_rect: { $set: false },
          cursor: { $set: 'copy' },
          _in_select_rect: { $set: false },
        }),
        sheet: nextSheet,
      };
    }

    if (this.samePoint(add.d_points[0], magnetic.point)) {
      return { view, sheet };
    }

    const preview = view.tracker.pointToPointPreview;
    const canReuseWorkspace =
      preview &&
      preview.items === sheet.items &&
      preview.grid === sheet.details.grid &&
      this.samePoint(preview.start, add.d_points[0]);
    const previewWorkspace = canReuseWorkspace
      ? preview.workspace as ConstructorParameters<typeof PointToPointWireRouter>[1]
      : undefined;
    const router = new PointToPointWireRouter(
      sheet,
      previewWorkspace,
    );
    const routePoints = router.route(
      add.d_points[0],
      magnetic.point,
      canReuseWorkspace ? preview.route : null,
    );
    if (routePoints.length < 2) {
      return { view, sheet };
    }
    view.tracker.pointToPointPreview = null;

    const routedEnd = routePoints[routePoints.length - 1];
    if (magnetic.wire && !this.samePoint(routedEnd, magnetic.point)) {
      magnetic = {
        point: [routedEnd[0], routedEnd[1]],
        wire: magnetic.wire,
      };
    }

    let items = sheet.items;
    ({ magnetic, items } = this.split_magnetic_wire_if_needed(magnetic, items));

    const newWires = this.make_wire_segments(routePoints);
    if (newWires.length === 0) {
      return { view, sheet };
    }

    let nextSheet = items !== sheet.items
      ? update(sheet, {
          items: { $set: items },
        })
      : sheet;

    nextSheet = update(nextSheet, {
      items: { $push: newWires },
    });
    nextSheet = this.tidy_wires(nextSheet);

    const createdIds = new Set(newWires.map((wire) => wire._id));
    const selectedIds = nextSheet.items
      .filter((item) => item.NodeName === DocItemTypes.Wire && createdIds.has(item._id))
      .map((item) => item._id);

    return {
      view: update(view, {
        display_add: { $set: false },
        add: { $set: null },
        menu_command: { $set: '' },
        cursor: { $set: 'auto' },
        in_add_rect: { $set: false },
        selectable: { $set: null },
        hover_obj: { $set: null },
        _drag_handle: { $set: -1 },
        _selected_handle: { $set: 0 },
        _selected_array: { $set: selectedIds },
      }),
      sheet: nextSheet,
    };
  }

  private split_magnetic_wire_if_needed(
    magnetic: { point: Coordinate; wire: dsnWire },
    items: DocItem[],
  ) {
    if (!magnetic || !magnetic.wire) {
      return { magnetic, items };
    }

    const updateMagWire = new updateWire(magnetic.wire);
    const result = updateMagWire.split_wire(magnetic.point, items);
    return {
      magnetic: {
        point: magnetic.point.slice(0),
        wire: result.obj,
      },
      items: UtilityService.updateDupArray(result.items, magnetic.wire, result.obj),
    };
  }

  private make_wire_segments(points: Coordinate[]): dsnWire[] {
    const wires: dsnWire[] = [];

    for (let index = 0; index < points.length - 1; ++index) {
      if (this.samePoint(points[index], points[index + 1])) {
        continue;
      }

      wires.push({
        NodeName: DocItemTypes.Wire,
        _id: get_global_id(),
        _magnetic: null,
        d_points: [points[index].slice(0), points[index + 1].slice(0)],
      });
    }

    return wires;
  }

  private samePoint(a: Coordinate | null, b: Coordinate | null): boolean {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1];
  }

  click_add(view: dsnView, sheet: dsnSheet, p: Coordinate): viewResult {
    const updater_add = updateSimpleAddFactory(view.add);
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    if (updater_add) {
      let dr = updater_add.begin_add(p, view.tracker, snap, sheet.items);
      view = update(view, {
        add: { $set: dr.obj },
        in_add_rect: { $set: true },
        display_add: { $set: true },
        cursor: { $set: 'copy' },
        _in_select_rect: { $set: false },
      });
      if (dr.items !== sheet.items) {
        sheet = update(sheet, {
          items: { $set: dr.items },
        });
      }

      if (dr.end) {
        return this.complete_add(view, sheet);
      }
    }
    return { view: view, sheet: sheet };
  }

  complete_add(view: dsnView, sheet: dsnSheet): viewResult {
    view.tracker.pointToPointPreview = null;
    const update_add = updateSimpleAddFactory(view.add);
    if (update_add) {
      let obj = update_add.complete_add();
      sheet = this.tidy_wires(
        update(sheet, {
          items: { $push: [obj] },
        }),
      );

      view = update(view, {
        display_add: { $set: false },
        add: { $set: null },
        menu_command: { $set: '' },
        cursor: { $set: 'auto' },
        in_add_rect: { $set: false },
      });

      return {
        view: this.selectSingleItem(view, sheet, obj, false),
        sheet: sheet,
      };
    } else {
      return { view: view, sheet: sheet };
    }
  }

  cancel_add(view: dsnView, sheet: dsnSheet): viewResult {
    view.tracker.pointToPointPreview = null;
    return {
      sheet: sheet,
      view: update(view, {
        in_add_rect: { $set: false },
        display_add: { $set: false },
        add: { $set: null },
        menu_command: { $set: '' },
        cursor: { $set: 'auto' },
      }),
    };
  }

  move_add(view: dsnView, sheet: dsnSheet, p: Coordinate): viewResult {
    const update_add = updateMoveAddFactory(view.add);
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    if (update_add) {
      let item = update_add.move_add(p, snap, view.tracker, sheet.items);
      return {
        view: update(view, {
          add: { $set: item },
        }),
        sheet: sheet,
      };
    }
    return { view: view, sheet: sheet };
  }

  mousemove_add(view: dsnView, sheet: dsnSheet, p: Coordinate): viewResult {
    const update_add = updateMoveAddFactory(view.add);
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    if (update_add) {
      let dr = update_add.mousemove_add(p, snap, view.tracker, sheet.items);
      return {
        view: update(view, {
          add: { $set: dr.item },
          display_add: { $set: dr.display },
        }),
        sheet: sheet,
      };
    }

    return { view: view, sheet: sheet };
  }

  drag_add(view: dsnView, sheet: dsnSheet, p: Coordinate): viewResult {
    const update_add = updateMoveAddFactory(view.add);
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    if (update_add) {
      let item = update_add.drag_add(p, snap, view.tracker, sheet.items);
      return {
        view: update(view, {
          add: { $set: item },
        }),
        sheet: sheet,
      };
    }
    return { view: view, sheet: sheet };
  }

  end_add(view: dsnView, sheet: dsnSheet, p: Coordinate): viewResult {
    const update_add = updateSimpleAddFactory(view.add);
    if (update_add) {
      let dr = update_add.end_add(view.tracker, sheet.items);
      view = update(view, {
        add: { $set: dr.item },
        drag: { $set: null },
      });
      sheet = update(sheet, {
        items: { $set: dr.items },
      });
      if (dr.end) {
        return this.complete_add(view, sheet);
      } else {
        return { view: view, sheet: sheet };
      }
    }

    return { view: view, sheet: sheet };
  }

  ////////////////// EDITOR HANDLERS ///////////////////

  // The user is editing the existing items
  editor_event(
    view: dsnView,
    sheet: dsnSheet,
    event_name: string,
    is_inside: IsInsideResult,
    p: Coordinate,
    r: Coordinate,
    event_pos: Coordinate,
    target: Coordinate,
    key: number,
    show_power: boolean,
    editingLibrary: boolean,
    selected_sheet: number,
    heterogeneous: boolean,
  ): viewResult {
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);

    // Do we append?
    const append = key === 2;

    if (!is_inside) {
      is_inside = {
        item: null,
        handle: 0,
        distance: 0,
      };
    }

    // Clear the hover point
    view = update(view, {
      hover_point: {
        $set: is_inside.search_marker ? is_inside.search_marker.a : null,
      },
    });

    let hover_obj = is_inside.item;
    if (
      event_name === 'lbuttondown' ||
      event_name === 'ldoubleclick' ||
      event_name === 'ltripleclick' ||
      event_name === 'rbuttondown'
    ) {
      if (
        event_name === 'lbuttondown' ||
        event_name === 'ldoubleclick' ||
        event_name === 'ltripleclick'
      ) {
        const click_threshold = 2.0;
        const is_same_spot =
          view.last_click_point &&
          Math.abs(view.last_click_point[0] - p[0]) < click_threshold &&
          Math.abs(view.last_click_point[1] - p[1]) < click_threshold;

        if (
          is_same_spot &&
          is_inside.candidates &&
          is_inside.candidates.length > 1
        ) {
          const sorted = is_inside.candidates.sort((a, b) => {
            const dA = a.distance || 0;
            const dB = b.distance || 0;
            if (Math.abs(dA - dB) > 0.001) {
              return dA - dB;
            }
            // Prefer text (handle != 0) over symbol (handle == 0)
            const hA = a.handle === 0 ? 1 : 0;
            const hB = b.handle === 0 ? 1 : 0;
            return hA - hB;
          });

          // We need to compare candidates based on identity (item id and handle)
          // Current selection
          const selected = UtilityService.singleSelectedItem(
            sheet.items,
            view._selected_array,
          );
          const selectedHandle = view._selected_handle;

          if (selected) {
            const idx = sorted.findIndex(
              (c) => c.item._id === selected._id && c.handle === selectedHandle,
            );
            if (idx >= 0) {
              const nextIdx = (idx + 1) % sorted.length;
              is_inside = sorted[nextIdx];
              hover_obj = is_inside.item;
            }
          }
        }

        view = update(view, {
          last_click_point: { $set: p },
        });
      }

      view = update(view, {
        selectable: { $set: null },
      });

      if (hover_obj) {
        const selectionItems =
          event_name === 'ldoubleclick'
            ? this.getWireSelectionItems(sheet, hover_obj, false)
            : event_name === 'ltripleclick'
              ? this.getWireSelectionItems(sheet, hover_obj, true)
              : [hover_obj];
        const isSelected = UtilityService.isSelected(view._selected_array, hover_obj);
        const allSelectionItemsSelected = selectionItems.every((item) =>
          UtilityService.isSelected(view._selected_array, item),
        );
        const toggleSelection =
          append &&
          (
            event_name === 'lbuttondown' ||
            event_name === 'ldoubleclick' ||
            event_name === 'ltripleclick'
          ) &&
          allSelectionItemsSelected;

        if (toggleSelection) {
          view = this.unselectItems(view, sheet, selectionItems);
        } else if (
          event_name === 'ldoubleclick' ||
          event_name === 'ltripleclick'
        ) {
          view = this.selectItems(view, sheet, selectionItems, append);
        } else if (!isSelected) {
          view = this.selectSingleItem(view, sheet, hover_obj, append);
        }

        if (
          !toggleSelection &&
          UtilityService.isSingleItemSelected(view._selected_array, hover_obj)
        ) {
          if (view._selected_handle !== is_inside.handle) {
            view = this._updateSelection(
              view,
              sheet,
              is_inside.handle,
              view._selected_array,
            );
            view = update(view, {
              _selected_handle: { $set: is_inside.handle },
            });
          }

          let update_hover_obj = updateFactory(hover_obj);
          let cursor = update_hover_obj.getCursor(is_inside.handle);
          view = update(view, {
            _drag_handle: { $set: is_inside.handle },
            hover_obj: { $set: hover_obj },
            cursor: {
              $set: cursor,
            },
          });

          if (is_inside.handle <= -2) {
            sheet = this.on_mouse_click(
              sheet,
              hover_obj,
              view._drag_handle,
              event_name,
              p,
            );
          }
        }
        view = update(view, {
          _in_select_rect: { $set: false },
        });
      } else {
        if (!append) {
          ({ view, sheet } = this.unselect(view, sheet));
          sheet = this.tidy_wires(sheet);
        }
        view = update(view, {
          _in_select_rect: {
            $set: true,
          },
          _select_rect_a: {
            $set: p,
          },
          _select_rect_b: {
            $set: p,
          },
        });
      }

      view.tracker.a = null;
      view.tracker.b = null;
    } else if (event_name === 'mousedrag' && view._in_select_rect) {
      view = update(view, {
        _select_rect_b: { $set: p },
      });
    } else if (event_name === 'mousedrag') {
      if (view._drag_handle <= -2) {
        sheet = this.on_mouse_click(
          sheet,
          hover_obj,
          view._drag_handle,
          event_name,
          p,
        );
      } else if (r[0] !== 0 || r[1] !== 0) {
        ({ view, sheet } = this.move_selected(
          view,
          sheet,
          snap,
          view._selected_array,
          r,
          view._drag_handle,
          key === 2,
        ));
      }
    } else if (event_name === 'dragend' && view._in_select_rect) {
      let items = this.is_inside_rect(
        sheet,
        show_power,
        editingLibrary,
        editingLibrary && !heterogeneous ? selected_sheet : 0,
        heterogeneous,
        view._select_rect_a,
        view._select_rect_b,
      );
      view = this.selectItems(view, sheet, items, append);
      view = update(view, {
        _in_select_rect: {
          $set: false,
        },
      });
      view.tracker.a = null;
      // view.tracker.b = null;
    } else if (event_name === 'dragend') {
      if (view._drag_handle <= -2) {
        sheet = this.on_mouse_click(
          sheet,
          hover_obj,
          view._drag_handle,
          event_name,
          p,
        );
      } else if (
        UtilityService.singleSelectedItem(sheet.items, view._selected_array)
      ) {
        ({ view, sheet } = this.drag_end(
          view,
          sheet,
          UtilityService.singleSelectedItem(sheet.items, view._selected_array),
          view._drag_handle,
        ));
      }
    } else if (event_name === 'dragstart') {
      if (view._drag_handle <= -2) {
        sheet = this.on_mouse_click(
          sheet,
          hover_obj,
          view._drag_handle,
          event_name,
          p,
        );
      } else if (
        UtilityService.singleSelectedItem(sheet.items, view._selected_array)
      ) {
        sheet = this.drag_start(
          view,
          sheet,
          UtilityService.singleSelectedItem(sheet.items, view._selected_array),
          view._drag_handle,
        );
      }
    }

    if (event_name === 'rbuttonup') {
      // Bring up the context menu
      view = this.showContextMenu(view, sheet, p, event_pos, target);
    }

    if (
      event_name === 'lbuttondown' ||
      event_name === 'ldoubleclick' ||
      event_name === 'ltripleclick' ||
      event_name === 'mousemove' ||
      event_name === 'dragstart'
    ) {
      if (
        !UtilityService.isSingleItemSelected(view._selected_array, hover_obj) ||
        hover_obj == null
      ) {
        view = update(view, {
          selectable: {
            $set: hover_obj,
          },
        });
      }
      if (
        hover_obj != null &&
        UtilityService.isSingleItemSelected(view._selected_array, hover_obj)
      ) {
        const drag_handle = is_inside.handle;
        const update_hover_obj = updateFactory(hover_obj);
        let cursor = update_hover_obj.getCursor(drag_handle);

        view = update(view, {
          _drag_handle: { $set: drag_handle },
          hover_obj: { $set: hover_obj },
          cursor: { $set: cursor },
        });
      } else {
        view = update(view, {
          drag: { $set: null },
          _drag_handle: { $set: -1 },
          hover_obj: { $set: hover_obj },
        });

        if (
          hover_obj &&
          UtilityService.isSelected(view._selected_array, hover_obj)
        ) {
          view = update(view, {
            cursor: { $set: 'move' },
          });
        } else {
          view = update(view, {
            cursor: { $set: 'auto' },
          });
        }
      }
    }

    return { view: view, sheet: sheet };
  }

  // The user has clicked or dragged across a text area
  on_mouse_click(
    sheet: dsnSheet,
    item: DocItem,
    handle: number,
    event_name: string,
    p: Coordinate,
  ): dsnSheet {
    let update_item = updateTextFactory(item);
    if (update_item) {
      let new_item = item;
      if (event_name === 'lbuttondown') {
        new_item = update_item.on_mouse_click(handle, p, true);
      } else if (event_name === 'ldoubleclick') {
        new_item = update_item.on_mouse_double_click(handle, p);
      } else if (event_name === 'mousedrag') {
        new_item = update_item.on_mouse_click(handle, p, false);
      }

      let items = UtilityService.updateDupArray(sheet.items, item, new_item);
      if (items !== sheet.items) {
        sheet = update(sheet, {
          items: { $set: items },
        });
      }
    }
    return sheet;
  }

  drag_start(
    view: dsnView,
    sheet: dsnSheet,
    item: DocItem,
    drag_handle: number,
  ): dsnSheet {
    const update_item = updateSimpleDragFactory(item);
    if (update_item) {
      let dr = update_item.dragStart(view.tracker, sheet.items, drag_handle);
      const items = UtilityService.updateDupArray(dr.items, item, dr.obj);
      if (items !== sheet.items) {
        sheet = update(sheet, {
          items: { $set: items },
        });
      }
    }
    return sheet;
  }

  drag_end(
    view: dsnView,
    sheet: dsnSheet,
    item: DocItem,
    drag_handle: number,
  ): viewResult {
    const update_item = updateSimpleDragFactory(item);
    if (update_item) {
      let dr = update_item.dragEnd(view.tracker, sheet.items, drag_handle);
      const items = UtilityService.updateDupArray(dr.items, item, dr.obj);
      if (items !== sheet.items) {
        sheet = update(sheet, {
          items: { $set: items },
        });
      }
      if (view._drag_handle !== 0) {
        view = update(view, {
          _drag_handle: { $set: 0 },
        });
      }
    }
    return { sheet: sheet, view: view };
  }

  // Bring up the context menu
  showContextMenu(
    view: dsnView,
    sheet: dsnSheet,
    p: Coordinate,
    event_pos: Coordinate,
    target: Coordinate,
  ): dsnView {
    let items: ContextMenuList = [];

    items = items.concat([
      {
        key: 'cut',
        text: i18n.t('toolbar.contextMenu.cut'),
        iconProps: {
          iconName: 'cut',
        },
        disabled: !this.can_copy(view, sheet),
      },
      {
        key: 'copy',
        text: i18n.t('toolbar.contextMenu.copy'),
        iconProps: {
          iconName: 'copy',
        },
        disabled: !this.can_copy(view, sheet),
      },
      {
        key: 'paste',
        text: i18n.t('toolbar.contextMenu.paste'),
        iconProps: {
          iconName: 'paste',
        },
      },
      {
        key: 'delete',
        text: i18n.t('toolbar.contextMenu.delete'),
        iconProps: {
          iconName: 'delete',
        },
        disabled: !this.can_copy(view, sheet),
      },
      {
        key: 'divider_1',
        itemType: ContextualMenuItemType.Divider,
      },
      {
        key: 'undo',
        text: i18n.t('toolbar.contextMenu.undo'),
        iconProps: {
          iconName: 'Undo',
        },
        disabled: false,
      },
      {
        key: 'redo',
        text: i18n.t('toolbar.contextMenu.redo'),
        iconProps: {
          iconName: 'Redo',
        },
        disabled: false,
      },
      {
        key: 'divider_4',
        itemType: ContextualMenuItemType.Divider,
      },
      {
        key: 'move_front',
        text: i18n.t('toolbar.contextMenu.moveToFront'),
        iconProps: {
          iconName: 'ArrangeBringToFront',
        },
        disabled: !this.can_copy(view, sheet),
      },
      {
        key: 'move_back',
        text: i18n.t('toolbar.contextMenu.moveToBack'),
        iconProps: {
          iconName: 'ArrangeSendToBack',
        },
        disabled: !this.can_copy(view, sheet),
      },
      {
        key: 'divider_5',
        itemType: ContextualMenuItemType.Divider,
      },
      {
        key: 'zoom_in',
        text: i18n.t('toolbar.contextMenu.zoomIn'),
        iconProps: {
          iconName: 'ZoomIn',
        },
        disabled: !this.can_zoom_in(view, sheet),
      },
      {
        key: 'zoom_out',
        text: i18n.t('toolbar.contextMenu.zoomOut'),
        iconProps: {
          iconName: 'ZoomOut',
        },
        disabled: !this.can_zoom_out(view, sheet),
      },
      {
        key: 'zoom_100',
        text: i18n.t('toolbar.contextMenu.zoom100'),
        iconProps: {
          iconName: 'Zoom',
        },
      },
    ]);

    // If we have a single item selected, then
    // use it as the source of the context menu
    let item = UtilityService.singleSelectedItem(
      sheet.items,
      view._selected_array,
    );
    if (item) {
      const updater_item = updateFactory(item);
      items = updater_item.getContextMenu(items, p);
    }

    setTimeout(() => {
      store.dispatch(actionMenuSetContextMenu(target, items));
    }, 0);

    return update(view, {
      cursor: { $set: 'auto' },
      contextMenuLastPoint: { $set: p },
    });
  }

  ////////////////// CLIPBOARD COMMAND HANDLERS FROM CHROME ASYNC CLIPBOARD API //////////////////

  command_cut(view: dsnView, sheet: dsnSheet): viewResult {
    return this.handleCopy(view, sheet, true);
  }

  command_copy(view: dsnView, sheet: dsnSheet): viewResult {
    return this.handleCopy(view, sheet, false);
  }

  ////////////////// MENU HANDLERS //////////////////

  command_delete(view: dsnView, sheet: dsnSheet): viewResult {
    let items = sheet.items.filter((e, index) => {
      return !view._selected_array.find((id) => {
        return e._id === id;
      });
    });

    view = update(view, {
      _selected_array: { $set: [] },
    });
    sheet = update(sheet, {
      items: { $set: items },
    });
    return { view: view, sheet: sheet };
  }

  // Zoom commands

  command_zoom_in(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: update(view, {
        zoom: { $set: this.clampZoom(view.zoom * ZOOM_STEP) },
      }),
      sheet,
    };
  }

  command_zoom_out(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: update(view, {
        zoom: { $set: this.clampZoom(view.zoom / ZOOM_STEP) },
      }),
      sheet,
    };
  }

  command_zoom_scale(view: dsnView, sheet: dsnSheet, factor?: number): viewResult {
    const nextZoom = this.clampZoom(view.zoom * (factor && factor > 0 ? factor : 1));

    return {
      view: update(view, {
        zoom: { $set: nextZoom },
      }),
      sheet,
    };
  }

  command_zoom_100(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: update(view, {
        zoom: { $set: this.clampZoom(100) },
      }),
      sheet: sheet,
    };
  }

  command_move_front(view: dsnView, sheet: dsnSheet): viewResult {
    return { view: view, sheet: this.move_z(view, sheet, true) };
  }

  command_move_back(view: dsnView, sheet: dsnSheet): viewResult {
    return { view: view, sheet: this.move_z(view, sheet, false) };
  }

  // Polygons only
  command_user_add_handle(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_user_add_handle'),
    };
  }

  command_user_add_curve(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_user_add_curve'),
    };
  }

  command_user_add_curve_quadratic(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_user_add_curve_quadratic'),
    };
  }

  command_user_add_curve_cubic(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_user_add_curve_cubic'),
    };
  }

  command_user_del_handle(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_user_del_handle'),
    };
  }

  command_make_polyline(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_make_polyline'),
    };
  }

  command_make_polygon(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: view,
      sheet: this.executePolygonCommand(view, sheet, 'menu_make_polygon'),
    };
  }

  ////////////////// ROTATION/FLIP HANDLERS //////////////////

  command_rotate_left(view: dsnView, sheet: dsnSheet): viewResult {
    if (view._selected_array.length > 1) {
      return {
        view: view,
        sheet: this.rotate_selected(view, sheet, 'rotate_left'),
      };
    } else {
      let item = this.getSelected(view, sheet);
      const update = updateRotateFactory(item);
      if (update) {
        return {
          view: view,
          sheet: this.updateObject(sheet, item, update.menu_rotate_left()),
        };
      }
    }

    return { view, sheet };
  }

  command_rotate_right(view: dsnView, sheet: dsnSheet): viewResult {
    if (view._selected_array.length > 1) {
      return {
        view: view,
        sheet: this.rotate_selected(view, sheet, 'rotate_right'),
      };
    } else {
      let item = this.getSelected(view, sheet);
      const update = updateRotateFactory(item);
      if (update) {
        return {
          view: view,
          sheet: this.updateObject(sheet, item, update.menu_rotate_right()),
        };
      }
    }

    return { view, sheet };
  }

  command_mirror_h(view: dsnView, sheet: dsnSheet): viewResult {
    if (view._selected_array.length > 1) {
      return {
        view: view,
        sheet: this.rotate_selected(view, sheet, 'mirror_h'),
      };
    } else {
      let item = this.getSelectedSymbol(view, sheet);
      if (item) {
        const update = new updateSymbol(item);
        return {
          view: view,
          sheet: this.updateObject(sheet, item, update.menu_mirror_h()),
        };
      }
    }

    return { view, sheet };
  }

  command_mirror_v(view: dsnView, sheet: dsnSheet): viewResult {
    if (view._selected_array.length > 1) {
      return {
        view: view,
        sheet: this.rotate_selected(view, sheet, 'mirror_v'),
      };
    } else {
      let item = this.getSelectedSymbol(view, sheet);
      if (item) {
        const update = new updateSymbol(item);
        return {
          view: view,
          sheet: this.updateObject(sheet, item, update.menu_mirror_v()),
        };
      }
    }

    return { view, sheet };
  }

  command_replace_symbol(view: dsnView, sheet: dsnSheet): viewResult {
    const item = this.getSelectedSymbol(view, sheet);
    if (!item) {
      return { view, sheet };
    }

    const currentName = item._symbol?.name?.value ||
      item.text.find((field) => field.description === 'Name')?.value ||
      '';

    setTimeout(() => {
      store.dispatch(
        actionSelectDialog('replace_symbol', {
          sourceUid: item._symbol?.uid,
          targetSymbolId: item._id,
          targetSheetIndex: view.selected_sheet,
          initialSearch: currentName,
        }),
      );
    }, 0);

    return { view, sheet };
  }

  ////////////////// KEYBOARD MOVEMENT HANDLERS //////////////////

  // Move selected objects by grid spacing
  command_move_selected_grid(
    view: dsnView,
    sheet: dsnSheet,
    dx?: number,
    dy?: number,
  ): viewResult {
    if (!view._selected_array || view._selected_array.length === 0) {
      return { view, sheet };
    }

    const grid = sheet.details.grid || 10;
    const moveX = (dx || 0) * grid;
    const moveY = (dy || 0) * grid;

    return this.moveSelectedObjects(view, sheet, moveX, moveY);
  }

  // Move selected objects by 1 pixel
  command_move_selected_pixel(
    view: dsnView,
    sheet: dsnSheet,
    dx?: number,
    dy?: number,
  ): viewResult {
    if (!view._selected_array || view._selected_array.length === 0) {
      return { view, sheet };
    }

    const moveX = dx || 0;
    const moveY = dy || 0;

    return this.moveSelectedObjects(view, sheet, moveX, moveY);
  }

  // Helper method to move selected objects by a specified amount
  private moveSelectedObjects(
    view: dsnView,
    sheet: dsnSheet,
    moveX: number,
    moveY: number,
  ): viewResult {
    let items = sheet.items;

    for (let i = 0; i < view._selected_array.length; ++i) {
      const id = view._selected_array[i];
      const obj = items.find((e) => e._id === id);
      if (obj) {
        const updater = updateFactory(obj);
        // relative_move uses negative values to move in positive direction
        const movedObj = updater.relative_move([-moveX, -moveY]);
        items = UtilityService.updateDupArray(items, obj, movedObj);
      }
    }

    if (items !== sheet.items) {
      sheet = update(sheet, {
        items: { $set: items },
      });
    }

    return { view, sheet };
  }

  ////////////////// ADD OBJECT HANDLERS //////////////////

  command_add_rectangle(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnRectangle = {
      NodeName: DocItemTypes.Rectangle,
      _id: get_global_id(),
      fill_colour: sheet.options.color_shape_fill,
      filled: sheet.options.fill_shape,
      hatch: 0,
      line_colour: sheet.options.color_shape,
      stroked: sheet.options.stroke_shape,
      line_pattern: sheet.options.shape_line_pattern,
      line_width: sheet.options.shape_line_width,
      rounded_rect: false,
      point: [0, 0],
      point_b: [0, 0],
    };
    return this.add_object(view, sheet, n, 'add_rectangle');
  }

  command_add_ellipse(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnEllipse = {
      NodeName: DocItemTypes.Ellipse,
      _id: get_global_id(),
      fill_colour: sheet.options.color_shape_fill,
      filled: sheet.options.fill_shape,
      hatch: 0,
      line_colour: sheet.options.color_shape,
      stroked: sheet.options.stroke_shape,
      line_pattern: sheet.options.shape_line_pattern,
      line_width: sheet.options.shape_line_width,
      point: [0, 0],
      point_b: [0, 0],
    };
    return this.add_object(view, sheet, n, 'add_ellipse');
  }

  command_add_text(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnText = {
      NodeName: DocItemTypes.Text,
      _id: get_global_id(),
      fill_colour: sheet.options.color_notetext_fill,
      filled: sheet.options.notetext_fill,
      hatch: 0,
      line_colour: sheet.options.color_notetext_line,
      stroked: sheet.options.notetext_stroke,
      line_pattern: sheet.options.notetext_line_pattern,
      line_width: sheet.options.notetext_line_width,
      rounded_rect: false,
      point: [0, 0],
      point_b: [0, 0],
      font_bold: sheet.options.font_bold,
      font_italic: sheet.options.font_italic,
      font_name: sheet.options.font_name,
      font_size: sheet.options.font_size,
      rotation: 0,
      text: '',
      textData: null,
    };
    const t = updateTextFactory(n);
    return this.add_object(view, sheet, t.post_construction(), 'add_text');
  }

  command_add_line(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnLine = {
      NodeName: DocItemTypes.Line,
      _id: get_global_id(),
      fill_colour: sheet.options.color_shape_fill,
      filled: sheet.options.fill_shape,
      hatch: 0,
      line_colour: sheet.options.color_shape,
      stroked: sheet.options.stroke_shape,
      line_pattern: sheet.options.shape_line_pattern,
      line_width: sheet.options.shape_line_width,
      d_points: [],
      polygon: false,
    };
    return this.add_object(view, sheet, n, 'add_line');
  }

  command_add_wire(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnWire = {
      NodeName: DocItemTypes.Wire,
      _id: get_global_id(),
      _magnetic: null,
      d_points: [],
    };
    return this.add_object(view, sheet, n, 'add_wire');
  }

  command_add_wire_point_to_point(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnWire = {
      NodeName: DocItemTypes.Wire,
      _id: get_global_id(),
      _magnetic: null,
      d_points: [],
    };
    return this.add_object(view, sheet, n, 'add_wire_point_to_point');
  }

  command_add_pin(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnPin = {
      NodeName: DocItemTypes.Pin,
      _id: get_global_id(),
      point: [0, 0],
      rotation: 0,
      name: '',
      number: '1',
      length: 20,
      number_pos: 0,
      centre_name: false,
      which: 0,
      elec: 0,
      show_name: true,
      show_number: true,
      part: view.selected_sheet,
      // The label's default style
      font_name: 'Arial',
      font_colour: '#000000',
      font_bold: false,
      font_italic: false,
      font_size: 10,
      textData: null,
    };
    return this.add_object(view, sheet, n, 'add_pin');
  }

  command_add_no_connect(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnNoConnect = {
      NodeName: DocItemTypes.NoConnect,
      _id: get_global_id(),
      point: [0, 0],
    };
    return this.add_object(view, sheet, n, 'add_no_connect');
  }

  command_add_power0(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_power(view, sheet, 0);
  }

  command_add_power1(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_power(view, sheet, 1);
  }

  command_add_power2(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_power(view, sheet, 2);
  }

  command_add_power3(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_power(view, sheet, 3);
  }

  command_add_power4(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_power(view, sheet, 4);
  }

  command_add_label0(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_label(view, sheet, 0);
  }

  command_add_label1(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_label(view, sheet, 1);
  }

  command_add_label2(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_label(view, sheet, 2);
  }

  command_add_label3(view: dsnView, sheet: dsnSheet): viewResult {
    return this.command_add_label(view, sheet, 3);
  }

  command_add_bus_junction(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnBusSlash = {
      NodeName: DocItemTypes.BusSlash,
      _id: get_global_id(),
      point: [0, 0],
      rotation: 0,
    };
    return this.add_object(view, sheet, n, 'add_bus_junction');
  }

  command_add_bus(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnBusWire = {
      NodeName: DocItemTypes.BusWire,
      _id: get_global_id(),
      d_points: [],
    };
    return this.add_object(view, sheet, n, 'add_bus');
  }

  command_add_vruler(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnDesignRuler = {
      NodeName: DocItemTypes.Ruler,
      _id: get_global_id(),
      rotation: 1,
      point: [0, 0],
    };
    return this.add_object(view, sheet, n, 'add_vruler');
  }

  command_add_hruler(view: dsnView, sheet: dsnSheet): viewResult {
    const n: dsnDesignRuler = {
      NodeName: DocItemTypes.Ruler,
      _id: get_global_id(),
      rotation: 0,
      point: [0, 0],
    };
    return this.add_object(view, sheet, n, 'add_hruler');
  }

  //////////////////  SHEET FUNCTIONS //////////////////

  ////////////////// Tidy up wires //////////////////
  //
  // Any wire meeting horizontally or vertically where there is no
  // junction are joined in to a single wire
  tidy_wires(sheet: dsnSheet): dsnSheet {
    let items = sheet.items.slice(0);
    let changed = false;

    // Search all wires and see if any other wires are near them
    let in_use_junctions: { [key: number]: boolean } = {};
    for (let i = 0; i < items.length; ++i) {
      const item1 = items[i];
      let splices = [];

      switch (item1.NodeName) {
        case DocItemTypes.Wire:
          const update_item1_wire = new updateWire(item1);
          if (update_item1_wire.is_zero_length()) {
            // Discard this wire
            splices.push(i);
            changed = true;
          } else {
            // We can start searching from one above
            // this item in the array
            let count = [0, 0];
            let connected_wire: dsnWire[] = [null, null];
            let connected_j: number[] = [null, null];
            let connected_point: { first: number; second: number }[] = [
              null,
              null,
            ];
            let junctions: number[][] = [[], []];
            let o = item1;
            let update_o_wire = new updateWire(o);
            for (let j = 0; j < items.length; ++j) {
              let item2 = items[j];
              switch (item2.NodeName) {
                case DocItemTypes.Wire:
                  if (update_o_wire.is_contained(item2)) {
                    // Remove this wire because it is completely contained in another wire
                    splices.push(j);
                  } else {
                    let oz = item2;
                    let done = true;
                    let update_oz_wire = new updateWire(oz);
                    do {
                      done = true;
                      let cp = update_o_wire.is_connected(oz);
                      if (cp != null) {
                        ++count[cp.first];
                        connected_wire[cp.first] = oz;
                        connected_j[cp.first] = j;
                        connected_point[cp.first] = cp;
                      } else {
                        for (let k = 0; k < 2; ++k) {
                          if (update_oz_wire.is_touching(o.d_points[k])) {
                            // This wire is touching another wire but not at it's end, so we need to split the
                            // wire here
                            let sw = update_oz_wire.split_wire_simple(
                              o.d_points[k],
                              items,
                            );
                            oz = sw.obj;
                            update_oz_wire = new updateWire(oz);
                            items = sw.items;
                            items[j] = oz;
                            done = false;
                            changed = true;
                          }
                        }
                      }
                    } while (!done);
                  }
                  break;
                case DocItemTypes.Junction:
                  // Is there a junction here?
                  let junction = item2;
                  if (
                    junction.point[0] === o.d_points[0][0] &&
                    junction.point[1] === o.d_points[0][1]
                  ) {
                    junctions[0].push(j);
                    in_use_junctions[junction._id] = true;
                  } else if (
                    junction.point[0] === o.d_points[1][0] &&
                    junction.point[1] === o.d_points[1][1]
                  ) {
                    junctions[1].push(j);
                    in_use_junctions[junction._id] = true;
                  }
                  break;
                case DocItemTypes.Power:
                case DocItemTypes.Symbol:
                  let o2 = item2;
                  const update_o2_ap = updateAPFactory(o2);
                  let aps = update_o2_ap.active_points();

                  // Is any active point here?
                  for (let k = 0; k < aps.length; ++k) {
                    let p = aps[k];
                    if (
                      p[0] === o.d_points[0][0] &&
                      p[1] === o.d_points[0][1]
                    ) {
                      ++count[0];
                    } else if (
                      p[0] === o.d_points[1][0] &&
                      p[1] === o.d_points[1][1]
                    ) {
                      ++count[1];
                    } else if (update_o_wire.is_touching(p)) {
                      // split the wire here, because we have a touching point!
                      ({ items: items, obj: o } =
                        update_o_wire.split_wire_simple(p, items));
                      update_o_wire = new updateWire(o);
                      items[i] = o;
                      ++count[0];
                    }
                  }
                  break;
              }
            }

            // Is there only 1 extra wire joined to this point?
            for (let k = 0; k < 2; ++k) {
              let update_connected_wire = new updateWire(connected_wire[k]);
              if (
                count[k] === 1 &&
                connected_wire[k] &&
                ((update_o_wire.is_horizontal() &&
                  update_connected_wire.is_horizontal()) ||
                  (update_o_wire.is_vertical() &&
                    update_connected_wire.is_vertical()))
              ) {
                // Merge the two wires together
                items[i] = update_o_wire.merge_wire(
                  connected_point[k],
                  connected_wire[k],
                );

                // .. and discard the second wire
                splices.push(connected_j[k]);
                changed = true;
              }

              // Auto-placement of junctions
              if (count[k] <= 1 && junctions[k].length > 0) {
                // Remove all junctions at this spot
                for (let j = 0; j < junctions[k].length; ++j) {
                  splices.push(junctions[k][j]);
                }
              } else if (count[k] > 1 && junctions[k].length === 0) {
                // Add a junction at this spot
                let new_junction: dsnJunction = {
                  NodeName: DocItemTypes.Junction,
                  _id: get_global_id(),
                  point: o.d_points[k].slice(),
                };
                in_use_junctions[new_junction._id] = true;
                items.push(new_junction);
                changed = true;
              }
            }
          }
          break;
      }

      // Now action the splices (we sort the array so the largest index is deleted first)
      splices.sort((a: number, b: number) => {
        return b - a;
      });
      for (let j = 0; j < splices.length; ++j) {
        items.splice(splices[j], 1);
        changed = true;
        if (splices[j] >= i) {
          --i;
        }
      }
    }

    // Remove unused junctions
    for (let i = 0; i < items.length; ++i) {
      let o = items[i];
      if (o.NodeName === DocItemTypes.Junction) {
        if (!in_use_junctions[o._id]) {
          items.splice(i, 1);
          changed = true;
          --i;
        }
      }
    }

    if (changed) {
      return update(sheet, {
        items: { $set: items },
      });
    } else {
      return sheet;
    }
  }

  ////////////////// VIEW HANDLERS //////////////////

  ////////////////// SELECTION HANDLERS //////////////////

  // Select a single item
  selectSingleItem(
    view: dsnView,
    sheet: dsnSheet,
    o: DocItem,
    append: boolean,
  ): dsnView {
    if (!append) {
      let ns = [o._id];
      return this._updateSelection(view, sheet, view._selected_handle, ns);
    } else {
      if (!UtilityService.isSelected(view._selected_array, o)) {
        let ns = view._selected_array.slice();
        ns.push(o._id);
        return this._updateSelection(view, sheet, view._selected_handle, ns);
      }
    }

    return view;
  }

  // Select one or more objects inside a rectangle
  selectItems(
    view: dsnView,
    sheet: dsnSheet,
    items: DocItem[],
    append: boolean,
  ): dsnView {
    let ns: number[];
    if (!append) {
      ns = [];
    } else {
      ns = view._selected_array.slice();
    }

    // Add the selected items
    for (let o = 0; o < items.length; ++o) {
      let item = items[o];
      if (!UtilityService.isSelected(ns, item)) {
        ns.push(item._id);
      }
    }

    return this._updateSelection(view, sheet, view._selected_handle, ns);
  }

  // Unselect all objects
  unselect(view: dsnView, sheet: dsnSheet): viewResult {
    return {
      view: this._updateSelection(view, sheet, view._selected_handle, []),
      sheet: sheet,
    };
  }

  unselectSingleItem(view: dsnView, sheet: dsnSheet, o: DocItem): dsnView {
    const ns = view._selected_array.filter((id) => id !== o._id);
    return this._updateSelection(view, sheet, view._selected_handle, ns);
  }

  _updateSelection(
    view: dsnView,
    sheet: dsnSheet,
    selected_handle: number,
    selected_array: number[],
  ): dsnView {
    // Get a union of all of the styles of the selected objects
    let r: MergedStyle = {
      line: false,
      fill: false,
      text: false,
      text_colour: false,
      border_style: false,
    };
    for (let i = 0; i < selected_array.length; ++i) {
      let id = selected_array[i];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      this.copyStyleObject(a, r);
    }

    if (r.line && !r.stroked) {
      r.line_colour = null;
    }
    if (r.fill && !r.filled) {
      r.fill_colour = null;
    }

    return update(view, {
      selectedStyle: { $set: r },
      _selected_array: { $set: selected_array },
    });
  }

  ////////////////// STYLE HANDLERS //////////////////

  // Copy from one object to another, without over-writing
  // the new object, only adding to it.  If there are differences
  // between this object and the target object then the target
  // is set to null
  copyStyleObject(from: DocItem, to: MergedStyle) {
    if (isStroked(from)) {
      to.line = true;
      to.stroked = StyleSet(to.stroked, from.stroked);
      to.line_colour = StyleSet(to.line_colour, from.line_colour);
      to.line_width = StyleSet(to.line_width, from.line_width);
      to.line_pattern = StyleSet(to.line_pattern, from.line_pattern);
    }

    if (isFilled(from)) {
      to.fill = true;
      to.filled = StyleSet(to.filled, from.filled);
      to.hatch = StyleSet(to.hatch, from.hatch);
      to.fill_colour = StyleSet(to.fill_colour, from.fill_colour);
    }
    if (isText(from)) {
      to.text = true;
      to.font_name = StyleSet(to.font_name, from.font_name);
      to.font_size = StyleSet(to.font_size, from.font_size);
      to.font_bold = StyleSet(to.font_bold, from.font_bold);
      to.font_italic = StyleSet(to.font_italic, from.font_italic);
    }

    if (isTextColour(from)) {
      to.text_colour = true;
      to.font_colour = StyleSet(to.font_colour, from.font_colour);
    }

    if (isBorderStyle(from)) {
      to.border_style = true;
      to.rounded_rect = StyleSet<boolean>(to.rounded_rect, from.rounded_rect);
    }
  }

  set_style(view: dsnView, sheet: dsnSheet, style: MergedStyle): viewResult {
    let items = sheet.items;

    for (let i = 0; i < view._selected_array.length; ++i) {
      let id = view._selected_array[i];
      let a = sheet.items.find((e) => {
        return e._id === id;
      });
      let obj = a;

      if (isStroked(a) && style.line) {
        a = update(a, {
          stroked: { $set: StyleMerge(style.stroked, a.stroked) },
          line_colour: { $set: StyleMerge(style.line_colour, a.line_colour) },
          line_width: { $set: StyleMerge(style.line_width, a.line_width) },
          line_pattern: {
            $set: StyleMerge(style.line_pattern, a.line_pattern),
          },
        });
      }
      if (isFilled(a) && style.fill) {
        a = update(a, {
          filled: { $set: StyleMerge(style.filled, a.filled) },
          fill_colour: { $set: StyleMerge(style.fill_colour, a.fill_colour) },
          hatch: { $set: StyleMerge(style.hatch, a.hatch) },
        });
      }
      if (isText(a) && style.text) {
        a = update(a, {
          font_name: { $set: StyleMerge(style.font_name, a.font_name) },
          font_size: { $set: StyleMerge(style.font_size, a.font_size) },
          font_bold: { $set: StyleMerge(style.font_bold, a.font_bold) },
          font_italic: { $set: StyleMerge(style.font_italic, a.font_italic) },
        });

        // Apply changes
        const update_a = updateTextFactory(a);
        if (update_a) {
          a = update_a.post_construction();
        }
      }
      if (isTextColour(a) && style.text_colour) {
        a = update(a, {
          font_colour: { $set: StyleMerge(style.font_colour, a.font_colour) },
        });
      }
      if (isBorderStyle(a) && style.border_style) {
        a = update(a, {
          rounded_rect: {
            $set: StyleMerge(style.rounded_rect, a.rounded_rect),
          },
        });
      }

      items = UtilityService.updateDupArray(items, obj, a);
    }

    if (items !== sheet.items) {
      sheet = update(sheet, {
        items: { $set: items },
      });
    }

    // Update the selection too
    // We want to update the properties in the style but keep the flags if they are already set
    // This is because the UI sends a partial style with only the changed property set to true
    // but we don't want to hide the other sections if they are already visible
    const newStyle = { ...style };
    if (view.selectedStyle) {
      newStyle.line = view.selectedStyle.line || style.line;
      newStyle.fill = view.selectedStyle.fill || style.fill;
      newStyle.text = view.selectedStyle.text || style.text;
      newStyle.text_colour =
        view.selectedStyle.text_colour || style.text_colour;
      newStyle.border_style =
        view.selectedStyle.border_style || style.border_style;
    }

    return {
      sheet: sheet,
      view: update(view, {
        selectedStyle: { $merge: newStyle },
      }),
    };
  }

  // Block rotations
  // dir = rotate_right   : Clockwise
  // dir = rotate_left    : Counter-clockwise
  // dir = mirror_v       : Mirror vertical
  // dir = mirror_h       : Mirror horizontal
  rotate_selected(view: dsnView, sheet: dsnSheet, dir: string) {
    let items = sheet.items.slice();

    let angle = 1;
    if (dir === 'rotate_left') {
      angle = -1;
    }

    // Rotate each selected item around the centre of rotation
    let first = true;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = 0; i < items.length; ++i) {
      let obj = items[i];
      let selected = view._selected_array.find((e) => {
        return obj._id === e;
      });
      if (selected) {
        const updater_obj = updateFactory(obj);
        let r = updater_obj.getBoundingRect();

        if (first) {
          x1 = r.x1;
          y1 = r.y1;
          x2 = r.x2;
          y2 = r.y2;
          first = false;
        } else {
          x1 = Math.min(x1, r.x1);
          y1 = Math.min(y1, r.y1);
          x2 = Math.max(x2, r.x2);
          y2 = Math.max(y2, r.y2);
        }
      }
    }

    let centre: Coordinate = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
    const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
    centre = snap.snap(centre);

    for (let i = 0; i < items.length; ++i) {
      let obj = items[i];
      let selected = view._selected_array.findIndex((e) => {
        return obj._id === e;
      });

      const updater_item = updateFactory(items[i]);
      if (selected !== -1 && updater_item.rotate) {
        // Ok, we now perform the translation and rotation
        items[i] = updater_item.rotate(angle, centre);
      }
    }

    return update(sheet, {
      items: { $set: items },
    });
  }


  // Is the user pointing inside a search marker?
  is_inside_rect(
    sheet: dsnSheet,
    show_power: boolean,
    editingLibrary: boolean,
    part: number,
    heterogeneous: boolean,
    a: Coordinate,
    b: Coordinate,
  ): DocItem[] {
    const delta = {
      dx: 0,
      dy: 0,
      dr: 0,
      part: part,
      show_power: show_power,
      editingLibrary: editingLibrary,
      heterogeneous: heterogeneous,
      scale_x: 1.0,
      scale_y: 1.0,
    };

    let r: DocItem[] = [];
    for (let index = 0; index < sheet.items.length; ++index) {
      const item = sheet.items[index];
      const updater_item = updateFactory(item);
      r = updater_item.is_inside_rect(delta, a, b, r);
    }

    return r;
  }

  is_inside(
    view: dsnView,
    sheet: dsnSheet,
    tp: Coordinate,
    part: number,
    show_power: boolean,
    editingLibrary: boolean,
    heterogeneous: boolean,
  ): IsInsideResult {
    const delta = {
      dx: 0,
      dy: 0,
      dr: 0,
      part: part,
      show_power: show_power,
      editingLibrary: editingLibrary,
      heterogeneous: heterogeneous,
      scale_x: 0,
      scale_y: 0,
    };
    const selected = UtilityService.singleSelectedItem(
      sheet.items,
      view._selected_array,
    );

    let best_distance: number = null;
    let best_match: IsInsideResult = null;
    const candidates: IsInsideResult[] = [];

    for (let index = 0; index < sheet.items.length; ++index) {
      const item = sheet.items[index];
      const updater_item = updateFactory(item);
      const is_selected = selected === item;
      const i = updater_item.is_inside(delta, tp, is_selected);
      if (i) {
        if (i.candidates) {
          candidates.push(...i.candidates);
        } else {
          candidates.push(i);
        }
        // Check distance...
        if (
          best_distance === null ||
          i.distance < best_distance ||
          (i.distance === best_distance && is_selected)
        ) {
          best_match = i;
          best_distance = i.distance;
        }
      }
    }

    if (best_match) {
      best_match.candidates = candidates;
    }

    return best_match;
  }

  // The sheet has been un-focused
  unfocus(view: dsnView) {
    return update(view, {
      _selected_handle: { $set: null },
    });
  }

  // Move a selected block
  move_selected(
    view: dsnView,
    sheet: dsnSheet,
    snap: Snap,
    _selected_array: number[],
    r: Coordinate,
    handle: number,
    no_dragging: boolean,
  ): viewResult {
    let items = sheet.items;

    // When moving more than one object, we can
    // only move the entire object, not handles
    if (_selected_array.length > 1) {
      handle = 0;
    }

    if (no_dragging) {
      view = update(view, {
        drag: { $set: null },
      });
    } else if (!view.drag && handle === 0) {
      let drag = new dragObject();
      drag.move_objects(items, _selected_array);
      view = update(view, {
        drag: { $set: drag },
      });
    }

    let anchor = items.find((e) => {
      return e._id === _selected_array[0];
    });

    const update_anchor = updateSimpleAddFactory(anchor);
    if (update_anchor) {
      // Perform the actual move
      let dr = update_anchor.mouse_move(view.tracker, r, handle, snap, items);
      items = UtilityService.updateDupArray(items, anchor, dr.obj);
      anchor = dr.obj;

      // Apply the same movement to all the other objects...
      for (let i = 0; i < _selected_array.length; ++i) {
        let id = _selected_array[i];
        let obj = items.find((e) => {
          return e._id === id;
        });
        if (id !== anchor._id) {
          const updater_obj = updateFactory(obj);
          let a = updater_obj.relative_move(dr.r);
          items = UtilityService.updateDupArray(items, obj, a);
        }
      }

      const update_anchor2 = updateSimpleDragFactory(anchor);
      if (view.drag) {
        items = view.drag.drag(items, dr.r);
      } else if (handle !== 0 && update_anchor2) {
        items = update_anchor2.drag_handle(view.tracker, items, handle);
      }
    }

    if (items !== sheet.items) {
      sheet = update(sheet, {
        items: { $set: items },
      });
    }

    return {
      sheet: sheet,
      view: view,
    };
  }

  ////////////////// CLIPBOARD EVENT HANDLERS //////////////////

  paste_tinycad_doc(
    view: dsnView,
    sheet: dsnSheet,
    text: string,
    point: Coordinate,
  ): viewResult {
    if (!point) {
      point = [100, 100];
    }
    // See if it is TinyCAD XML file data
    if (text.includes('<TinyCADSheets>') || text.includes('<TinyCAD>')) {
      // Convert from text to an XML document
      let xmlBuilder = new XMLBuilder();
      const io = new ioXML();
      xmlBuilder.fromText(text);
      const doc = io.from_dsn(xmlBuilder);
      let dr = [0, 0];
      let copy_items = doc.sheets[0].items;
      if (point != null) {
        // Find the top-left of this collection
        let min_x = 0;
        let min_y = 0;
        for (let j = 0; j < copy_items.length; ++j) {
          const update_copy_item = updateFactory(copy_items[j]);
          let x = update_copy_item.x();
          let y = update_copy_item.y();
          if (j === 0) {
            min_x = x;
            min_y = y;
          } else {
            min_x = Math.min(x, min_x);
            min_y = Math.max(y, min_y);
          }
        }

        // Now move these items in to place
        dr = [min_x - point[0], min_y - point[1]];
      }

      // Now merge symbol libraries
      let symbol_map: { [key: string]: libSymbol } = {};
      let next_symbol_id = 1;
      for (let s2_id in sheet.symbols) {
        if (sheet.symbols.hasOwnProperty(s2_id)) {
          next_symbol_id = Math.max(+s2_id + 1, next_symbol_id);
        }
      }
      let merged_symbols = Object.assign({}, sheet.symbols);
      for (let s_id in doc.sheets[0].symbols) {
        if (doc.sheets[0].symbols.hasOwnProperty(s_id)) {
          let symbol = doc.sheets[0].symbols[s_id];
          // Do we already know about this symbol?
          let m;
          for (let s2_id in sheet.symbols) {
            if (sheet.symbols[s2_id].uid === symbol.uid) {
              m = s2_id;
            }
          }
          if (m) {
            // Already known
            symbol_map[s_id] = sheet.symbols[m];
          } else {
            // New symbol for this design, so merge
            symbol = update(symbol, {
              id: { $set: next_symbol_id },
            });
            symbol_map[s_id] = symbol;
            merged_symbols[next_symbol_id] = symbol;
            ++next_symbol_id;
          }
        }
      }

      let items = sheet.items.slice();
      let selected_array = [];
      for (var i = 0; i < copy_items.length; ++i) {
        const update_copy_item = updateFactory(copy_items[i]);
        let item = update_copy_item.relative_move(dr);
        if (item.NodeName === DocItemTypes.Symbol) {
          // Point to the correct symbol
          item._symbol = symbol_map[item._symbol.id];
        }
        items.push(item);
        selected_array.push(copy_items[i]._id);
      }

      sheet = update(sheet, {
        items: { $set: items },
        symbols: { $set: merged_symbols },
      });

      view = update(view, {
        _selected_array: { $set: selected_array },
      });

      sheet = this.tidy_wires(sheet);
    }

    return { view: view, sheet: sheet };
  }

  copy_tinycad_doc(view: dsnView, sheet: dsnSheet) {
    let items = [];
    for (let i = 0; i < view._selected_array.length; ++i) {
      let a = sheet.items.find((e) => {
        return e._id === view._selected_array[i];
      });
      items.push(a);
    }

    let copy_doc = new XMLBuilder();
    copy_doc.createDoc('TinyCADSheets');
    const io = new ioXML();
    io.to_tinycad(sheet, copy_doc, items, false, false, false);
    return copy_doc.tostring();
  }

  // Z-Order commands
  move_z(view: dsnView, sheet: dsnSheet, front: boolean) {
    // Find the items to move
    let move_items = sheet.items.filter((e, index) => {
      return view._selected_array.find((id) => {
        return e._id === id;
      });
    });

    // Now remove them from the items array
    let items = sheet.items.filter((e, index) => {
      return !view._selected_array.find((id) => {
        return e._id === id;
      });
    });

    // Finally put the items at the front or back of the array
    if (front) {
      items.push(...move_items);
    } else {
      items.unshift(...move_items);
    }

    return update(sheet, {
      items: { $set: items },
    });
  }

  executePolygonCommand(
    view: dsnView,
    sheet: dsnSheet,
    command: string,
  ): dsnSheet {
    let sel_item = UtilityService.singleSelectedItem(
      sheet.items,
      view._selected_array,
    );

    // Do we need to update this style?
    const update_sel_item = updateLineFactoryFactory(sel_item);
    if (update_sel_item) {
      // Apply the menu item
      let obj = (update_sel_item as any)[command](
        view.contextMenuLastPoint,
        new Snap(sheet.details.grid, sheet.details.grid_snap),
      );

      const items = UtilityService.updateDupArray(sheet.items, sel_item, obj);

      if (items !== sheet.items) {
        sheet = update(sheet, {
          items: { $set: items },
        });
      }
    }

    // No action
    return sheet;
  }

  //
  // Update a single object in the items array
  //
  updateObject(sheet: dsnSheet, prev_object: DocItem, new_object: DocItem) {
    const items = UtilityService.updateDupArray(
      sheet.items,
      prev_object,
      new_object,
    );

    if (items !== sheet.items) {
      sheet = update(sheet, {
        items: { $set: items },
      });
    }

    return sheet;
  }

  ////////////////// Symbol operations //////////////////

  private getLibrarySymbolUid(name: tclibLibraryEntry, items: DocItem[][]) {
    return name.id || md5(JSON.stringify(items));
  }

  private ensureLibrarySymbolOnSheet(
    sheet: dsnSheet,
    name: tclibLibraryEntry,
    items: DocItem[][],
  ) {
    const symbolUid = this.getLibrarySymbolUid(name, items);

    let next_symbol_id = 1;
    let selected_symboldef: libSymbol = null;
    for (let s2_id in sheet.symbols) {
      if (sheet.symbols.hasOwnProperty(s2_id)) {
        if (sheet.symbols[s2_id].uid === symbolUid) {
          selected_symboldef = sheet.symbols[s2_id];
        }
        next_symbol_id = Math.max(+s2_id + 1, next_symbol_id);
      }
    }

    if (!selected_symboldef) {
      const ioxml = new ioXML();
      const snap = new Snap(sheet.details.grid, sheet.details.grid_snap);
      const heterogeneous = items.length > 1;
      const outlines = items.map((item) =>
        ioxml.normalize_symbol(item, snap, null, false, heterogeneous),
      );

      selected_symboldef = {
        id: next_symbol_id,
        description: null,
        name: {
          type: name.ShowName,
          value: name.Name,
        },
        ref: {
          type: name.ShowRef,
          value: name.Reference,
        },
        outlines: outlines,
        heterogeneous: heterogeneous,
        parts: name.ppp,
        uid: symbolUid,
      };

      sheet = update(sheet, {
        symbols: {
          [selected_symboldef.id]: { $set: selected_symboldef },
        },
      });
    }

    return {
      sheet,
      symbol: selected_symboldef,
    };
  }

  private getAnchorPoint(symbol: dsnSymbol): Coordinate {
    const updater = new updateSymbol(symbol);
    const delta = { dx: 0, dy: 0 };
    updater.calcDelta(delta);
    const outline = updater.outline();

    for (const activePoint of outline.active_points) {
      if (activePoint.power) {
        continue;
      }

      if (!symbol._symbol.heterogeneous && activePoint.part !== symbol.part) {
        continue;
      }

      let point = [
        activePoint.pos[0] * symbol.scale_x,
        activePoint.pos[1] * symbol.scale_y,
      ];
      point = UtilityService.rotateSymCordinate(symbol.rotation, point);

      return [
        point[0] + delta.dx + symbol.point[0],
        point[1] + delta.dy + symbol.point[1],
      ];
    }

    return null;
  }

  private createReplacementText(
    oldSymbol: dsnSymbol,
    newSymbolDef: libSymbol,
    name: tclibLibraryEntry,
    keepFieldValues: boolean,
    part: number,
  ): SymbolTextItem[] {
    const fallback = new updateSymbol(oldSymbol);
    const existingFields = new Map(
      oldSymbol.text.map((field) => [field.description, field]),
    );
    const fieldDefinitions = [
      {
        description: 'Name',
        value: name.Name,
        display: name.ShowName,
      },
      {
        description: 'Ref',
        value: name.Reference,
        display: name.ShowRef,
      },
      ...name.Attributes.filter(
        (attribute) =>
          attribute.AttName !== 'Reference' &&
          attribute.AttName.indexOf('$$') !== 0,
      ).map((attribute) => ({
        description: attribute.AttName,
        value: attribute.AttValue,
        display: attribute.ShowAtt,
      })),
    ];

    const text = fieldDefinitions.map((field) => {
      const existingField = existingFields.get(field.description);
      const value = keepFieldValues && existingField
        ? existingField.value
        : field.value;

      return {
        description: field.description,
        value,
        show: fallback.show_text(field.display, value),
        display: field.display,
        position: [0, 0],
      } as SymbolTextItem;
    });

    const layoutHelper = new updateSymbol({
      ...oldSymbol,
      _symbol: newSymbolDef,
      part,
      text,
    });
    const laidOut = layoutHelper.layout_text_fields(
      oldSymbol.rotation,
      text.map((field) => ({
        ...field,
        position: [...field.position],
      })),
    );

    if (!keepFieldValues) {
      return laidOut;
    }

    return laidOut.map((field) => {
      const existingField = existingFields.get(field.description);
      if (!existingField) {
        return field;
      }

      return {
        ...field,
        position: existingField.position
          ? [...existingField.position]
          : field.position,
      };
    });
  }

  private replaceSymbolInstance(
    item: dsnSymbol,
    newSymbolDef: libSymbol,
    name: tclibLibraryEntry,
    keepFieldValues: boolean,
  ) {
    const nextPart = Math.min(item.part, Math.max(newSymbolDef.parts, 1) - 1);
    let replacement: dsnSymbol = {
      ...item,
      point: [...item.point],
      part: nextPart,
      _symbol: newSymbolDef,
      _active_points: null,
      text: this.createReplacementText(
        item,
        newSymbolDef,
        name,
        keepFieldValues,
        nextPart,
      ),
      textData: [],
    };

    const oldAnchor = this.getAnchorPoint(item);
    const newAnchor = this.getAnchorPoint(replacement);
    if (oldAnchor && newAnchor) {
      replacement = {
        ...replacement,
        point: [
          replacement.point[0] + oldAnchor[0] - newAnchor[0],
          replacement.point[1] + oldAnchor[1] - newAnchor[1],
        ],
      };
    }

    return new updateSymbol(replacement).post_construction();
  }

  replaceSymbolsInDrawing(
    drawing: dsnDrawing,
    sourceUid: string,
    targetSymbolId: number,
    targetSheetIndex: number,
    scope: ReplaceSymbolScope,
    name: tclibLibraryEntry,
    items: DocItem[][],
    keepFieldValues: boolean,
  ) {
    if (!sourceUid || targetSheetIndex == null || targetSheetIndex < 0) {
      return drawing;
    }

    let changed = false;
    const sheets = drawing.sheets.map((sheet, sheetIndex) => {
      if (sheetIndex !== targetSheetIndex) {
        return sheet;
      }

      const hasMatches = sheet.items.some(
        (item) =>
          item.NodeName === DocItemTypes.Symbol &&
          this.shouldReplaceSymbol(
            item as dsnSymbol,
            sourceUid,
            targetSymbolId,
            scope,
          ),
      );
      if (!hasMatches) {
        return sheet;
      }

      changed = true;
      const ensured = this.ensureLibrarySymbolOnSheet(sheet, name, items);
      const nextItems = ensured.sheet.items.map((item) => {
        if (
          item.NodeName !== DocItemTypes.Symbol ||
          !this.shouldReplaceSymbol(
            item as dsnSymbol,
            sourceUid,
            targetSymbolId,
            scope,
          )
        ) {
          return item;
        }

        return this.replaceSymbolInstance(
          item as dsnSymbol,
          ensured.symbol,
          name,
          keepFieldValues,
        );
      });

      return update(ensured.sheet, {
        items: { $set: nextItems },
      });
    });

    if (!changed) {
      return drawing;
    }

    return update(drawing, {
      sheets: { $set: sheets },
    });
  }

  private shouldReplaceSymbol(
    item: dsnSymbol,
    sourceUid: string,
    targetSymbolId: number,
    scope: ReplaceSymbolScope,
  ) {
    if (item._symbol?.uid !== sourceUid) {
      return false;
    }

    if (scope === 'single_symbol') {
      return item._id === targetSymbolId;
    }

    return true;
  }

  showShowPower(view: dsnView, sheet: dsnSheet, show_power: boolean): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      let selectedSymbol = update(_selectedSymbol, {
        show_power: {
          $set: show_power,
        },
      });

      // Update the object in the array
      return this.updateObject(sheet, _selectedSymbol, selectedSymbol);
    }

    return sheet;
  }

  allowResize(view: dsnView, sheet: dsnSheet, allow_resize: boolean): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      let selectedSymbol = update(_selectedSymbol, {
        allow_resize: {
          $set: allow_resize,
        },
      });

      // Update the object in the array
      return this.updateObject(sheet, _selectedSymbol, selectedSymbol);
    }

    return sheet;
  }

  resetResize(view: dsnView, sheet: dsnSheet): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      let selectedSymbol = update(_selectedSymbol, {
        scale_x: {
          $set: 1.0,
        },
        scale_y: {
          $set: 1.0,
        },
      });

      // Update the object in the array
      return this.updateObject(sheet, _selectedSymbol, selectedSymbol);
    }

    return sheet;
  }

  editPin(view: dsnView, sheet: dsnSheet, pin: dsnPin): dsnSheet {
    const updatedPin = new updatePin(pin).post_construction();

    // First try to get the selected pin
    let _selectedPin = this.getSelectedPin(view, sheet);
    if (_selectedPin) {
      return this.updateObject(sheet, _selectedPin, updatedPin);
    }

    // If no pin is selected, find by ID
    const existingPin = sheet.items.find(
      (item) => item._id === pin._id && item.NodeName === DocItemTypes.Pin
    ) as dsnPin | undefined;
    
    if (existingPin) {
      return this.updateObject(sheet, existingPin, updatedPin);
    }

    return sheet;
  }

  showShow(view: dsnView, sheet: dsnSheet, index: number): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showShow(index),
      );
    }

    return sheet;
  }

  showValue(
    view: dsnView,
    sheet: dsnSheet,
    index: number,
    value: string,
  ): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showValue(index, value),
      );
    }

    return sheet;
  }

  showPPP(view: dsnView, sheet: dsnSheet, part: number): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showPPP(part),
      );
    }

    return sheet;
  }

  showName(
    view: dsnView,
    sheet: dsnSheet,
    index: number,
    value: string,
  ): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showName(index, value),
      );
    }

    return sheet;
  }

  showDelete(view: dsnView, sheet: dsnSheet, index: number): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showDelete(index),
      );
    }

    return sheet;
  }

  showAdd(view: dsnView, sheet: dsnSheet): dsnSheet {
    let _selectedSymbol = this.getSelectedSymbol(view, sheet);
    if (_selectedSymbol) {
      const update_selected = new updateSymbol(_selectedSymbol);
      return this.updateObject(
        sheet,
        _selectedSymbol,
        update_selected.showAdd(),
      );
    }

    return sheet;
  }

  ////////////////// Update the text of a specific item //////////////////

  updateText(
    view: dsnView,
    sheet: dsnSheet,
    item: DocItem,
    handle: number,
    new_text: string,
  ) {
    const update_item = updateTextFactory(item);
    if (update_item) {
      const newItem = update_item.updateText(handle, new_text);
      sheet = this.updateObject(sheet, item, newItem);
    }

    return sheet;
  }

  handleKeyDown(
    view: dsnView,
    sheet: dsnSheet,
    keyCode: number,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    metaKey: boolean,
  ): dsnSheet {
    const item = this.getSelectedText(view, sheet);
    const update_item = updateTextFactory(item);
    if (update_item) {
      const newItem = update_item.handleKeyDown(
        view._selected_handle,
        keyCode,
        shiftKey,
        ctrlKey,
        altKey,
        metaKey,
      );
      sheet = this.updateObject(sheet, item, newItem);
    }
    return sheet;
  }

  handleKeyPress(view: dsnView, sheet: dsnSheet, keyCode: number): dsnSheet {
    const item = this.getSelectedText(view, sheet);
    const update_item = updateTextFactory(item);
    if (update_item) {
      const newItem = update_item.handleKeyPress(
        view._selected_handle,
        keyCode,
      );
      sheet = this.updateObject(sheet, item, newItem);
    }
    return sheet;
  }

  handleCopy(view: dsnView, sheet: dsnSheet, cut: boolean): viewResult {
    const item = this.getSelectedText(view, sheet);
    let copy_data: string = null;
    const update_item = updateTextFactory(item);
    if (update_item && view._selected_handle < -1) {
      const data = update_item.handleTextCopy(view._selected_handle, cut);
      sheet = this.updateObject(sheet, item, data.item);
      copy_data = data.copy_data;

      if (copy_data !== null) {
        if (copy_data.length > 0) {
          navigator.clipboard
            .writeText(copy_data)
            .then(() => {
              console.log('Text copied to clipboard');
            })
            .catch((err) => {
              console.log(err);
            });
        }

        return { view: view, sheet: sheet };
      }
    }

    if (!copy_data) {
      copy_data = this.copy_tinycad_doc(view, sheet);
      if (cut) {
        ({ view, sheet } = this.command_delete(view, sheet));
      }
    }

    navigator.clipboard
      .writeText(copy_data)
      .then(() => {
        console.log('Text copied to clipboard');
      })
      .catch((err) => {
        console.log(err);
      });

    return { view: view, sheet: sheet };
  }

  handleSelectLibrarySymbol(
    view: dsnView,
    sheet: dsnSheet,
    name: tclibLibraryEntry,
    items: DocItem[][],
    point: Coordinate,
  ) {
    const ensured = this.ensureLibrarySymbolOnSheet(sheet, name, items);
    sheet = ensured.sheet;
    const selected_symboldef = ensured.symbol;

    let pos = -selected_symboldef.outlines[0].size[0] + 2.4 * 5;
    const posfn = (show: boolean) => {
      const r = pos;
      if (show) {
        pos += 2.4 * 5;
      }
      return r;
    };

    // Centre symbol on drop point
    if (!point) {
      point = [100, 100];
    }
    point[0] = point[0] + selected_symboldef.outlines[0].size[0] / 2.0;
    point[1] = point[1] + selected_symboldef.outlines[0].size[1] / 2.0;

    const update_symbol = new updateSymbol(null);

    let newSymbol: dsnSymbol = {
      NodeName: DocItemTypes.Symbol,
      _id: get_global_id(),
      point: point,
      show_power: false,
      allow_resize: false,
      scale_x: 1.0,
      scale_y: 1.0,
      part: 0,
      rotation: 0,
      _symbol: selected_symboldef,
      text: [
        {
          description: 'Name',
          value: name.Name,
          show: update_symbol.show_text(name.ShowName, name.Name),
          display: name.ShowName,
          position: [
            5.0,
            posfn(update_symbol.show_text(name.ShowName, name.Name)),
          ],
        },
        {
          description: 'Ref',
          value: name.Reference,
          show: update_symbol.show_text(name.ShowRef, name.Reference),
          display: name.ShowRef,
          position: [
            5.0,
            posfn(update_symbol.show_text(name.ShowRef, name.Reference)),
          ],
        },
        ...name.Attributes.filter(
          (a) => a.AttName !== 'Reference' && a.AttName.indexOf('$$') !== 0,
        ).map((a) => ({
          position: [
            5.0,
            posfn(update_symbol.show_text(a.ShowAtt, a.AttValue)),
          ],
          value: a.AttValue,
          description: a.AttName,
          show: update_symbol.show_text(a.ShowAtt, a.AttValue),
          display: a.ShowAtt,
        })),
      ],
      hints: [],
      font_name: 'Arial',
      font_colour: '#FF0000',
      font_bold: false,
      font_italic: false,
      font_size: 10,
      _active_points: null,
      textData: [],
    };
    const o = new updateSymbol(newSymbol);
    newSymbol = o.post_construction();

    sheet = update(sheet, {
      items: { $push: [newSymbol] },
    });

    return {
      view: view,
      sheet: sheet,
    };
  }

  handleAddImage(
    view: dsnView,
    sheet: dsnSheet,
    data: string,
    type: string,
    dataSize: number,
    size: Size,
    pos: Coordinate,
  ): viewResult {
    let id = 1;
    for (const i in sheet.images) {
      const im = sheet.images[i];
      id = Math.max(im.id + 1, id);
    }
    const img: libImage = {
      id: id,
      imageData: data,
      size: dataSize,
      type: type,
    };

    const scale = Math.max(1.0, Math.max(size[0] / 255.0, size[1] / 255.0)) * 2;

    const dImg: dsnImage = {
      NodeName: DocItemTypes.Image,
      _id: get_global_id(),
      filled: false,
      fill_colour: '#ffffff',
      hatch: 0,
      line_colour: '#000000',
      line_pattern: -1,
      line_width: 1,
      stroked: false,
      rounded_rect: false,
      point: [pos[0] - size[0] / scale, pos[1] - size[1] / scale],
      point_b: [pos[0] + size[0] / scale, pos[1] + size[1] / scale],
      imageData: img,
    } as dsnImage;

    sheet = update(sheet, {
      images: {
        $merge: {
          [id]: img,
        },
      },
      items: { $push: [dImg] },
    });

    return { view, sheet };
  }

  handlePaste(
    view: dsnView,
    sheet: dsnSheet,
    text: string,
    point: Coordinate,
  ): viewResult {
    const item = this.getSelectedText(view, sheet);
    const update_item = updateTextFactory(item);
    if (update_item && view._selected_handle < -1) {
      const newItem = update_item.handleTextPaste(view._selected_handle, text);
      if (newItem !== item) {
        return {
          view: view,
          sheet: this.updateObject(sheet, item, newItem),
        };
      }
    }

    // Not handled by our selected item, so is it a TinyCAD document?
    return this.paste_tinycad_doc(view, sheet, text, point);
  }

  add_object(
    view: dsnView,
    sheet: dsnSheet,
    item: DocItem,
    command: string,
  ): viewResult {
    return {
      view: update(view, {
        add: { $set: item },
        menu_command: { $set: command },
      }),
      sheet: sheet,
    };
  }

  command_add_power(view: dsnView, sheet: dsnSheet, n: number): viewResult {
    let sel_item = UtilityService.singleSelectedItem(
      sheet.items,
      view._selected_array,
    );
    if (sel_item != null && sel_item.NodeName === DocItemTypes.Power) {
      const update_sel_item = new updatePower(sel_item);
      let updated_sel_item = update_sel_item.set_which(n);
      return {
        view: view,
        sheet: this.updateObject(sheet, sel_item, updated_sel_item),
      };
    } else {
      let add: dsnPower = {
        NodeName: DocItemTypes.Power,
        _id: get_global_id(),
        which: n,
        rotation: 0,
        point: [0, 0],
        text: '5v',
        textData: null,
        font_name: 'Arial',
        font_colour: '#000000',
        font_bold: false,
        font_italic: false,
        font_size: 10,
        _magnetic: null,
        _no_show: false,
      };
      const update_add = new updatePower(add);
      return this.add_object(
        view,
        sheet,
        update_add.post_construction(),
        'add_power' + n,
      );
    }
  }

  command_add_label(view: dsnView, sheet: dsnSheet, n: number): viewResult {
    let sel_item = UtilityService.singleSelectedItem(
      sheet.items,
      view._selected_array,
    );
    if (sel_item != null && sel_item.NodeName === DocItemTypes.Label) {
      const update_sel_item = new updateLabel(sel_item);
      let updated_sel_item = update_sel_item.set_which(n);
      return {
        view: view,
        sheet: this.updateObject(sheet, sel_item, updated_sel_item),
      };
    } else {
      let add: dsnLabel = {
        NodeName: DocItemTypes.Label,
        _id: get_global_id(),
        which: n,
        rotation: 0,
        point: [0, 0],
        text: 'Label',
        textData: null,

        font_name: 'Arial',
        font_colour: sheet.options.color_label,
        font_bold: false,
        font_italic: false,
        font_size: 10,
      };
      const update_add = new updateLabel(add);
      return this.add_object(
        view,
        sheet,
        update_add.post_construction(),
        'add_label' + n,
      );
    }
  }

  command_add_bus_label(view: dsnView, sheet: dsnSheet) {
    let bus_label: dsnBusLabel = {
      NodeName: DocItemTypes.BusLabel,
      _id: get_global_id(),
      rotation: 0,
      point: [0, 0],
      text: 'Label',
      textData: null,

      font_name: 'Arial',
      font_colour: sheet.options.color_label,
      font_bold: false,
      font_italic: false,
      font_size: 10,
    };
    const update_label = new updateBusLabel(bus_label);
    return this.add_object(
      view,
      sheet,
      update_label.post_construction(),
      'add_bus_label',
    );
  }

  makeBomForSheet(sheet: dsnSheet, bom: dsnBomEntry[]): dsnBomEntry[] {
    for (let i = 0; i < sheet.items.length; ++i) {
      let ObjPtr = sheet.items[i];

      switch (ObjPtr.NodeName) {
        case DocItemTypes.Symbol:
          {
            const myRefDes = ObjPtr.text.find(
              (a) => a.description === 'Ref',
            ).value;
            const myName = ObjPtr.text.find(
              (a) => a.description === 'Name',
            ).value;

            let bomEntry = bom.find(
              (be) => be.Name.toLowerCase() === myName.toLowerCase(),
            );
            if (bomEntry) {
              bomEntry.References.push(myRefDes);
              bomEntry.References.sort((a, b) => a.localeCompare(b));
              ++bomEntry.Quantity;
            } else {
              bom = [
                ...bom,
                {
                  Name: myName,
                  References: [myRefDes],
                  Quantity: 1,
                },
              ];
            }
          }
          break;
      }
    }

    return bom;
  }
}
