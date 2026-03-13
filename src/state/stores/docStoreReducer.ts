import {
  actionSelectPanel,
  actionSelectBottomPanel,
  AppActionTypes,
  Panels,
  BottomPanels,
} from '../dispatcher/AppDispatcher';
import update from 'immutability-helper';

import { DocActionTypes } from '../actions/docActions';
import { MenuActionTypes } from '../actions/menuActions';
import { FindActionTypes } from '../actions/findActions';
import { DialogActionTypes } from '../actions/dialogActions';
import { SymbolActionTypes } from '../actions/symbolActions';
import { TextActionTypes } from '../actions/menuText';
import { dsnDrawing, dsnSheet } from '../../model/dsnDrawing';
import { dsnView } from '../../model/dsnView';
import { updateView } from '../../manipulators/updateView';
import { updateDrawing } from '../../manipulators/updateDrawing';
import { blank } from '../../io/ioXml';
import { dsnBomEntry } from '../../model/dsnBomEntry';
import { LibraryActionTypes } from '../actions/libraryActions';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { updateLibrary } from '../../manipulators/updateLibrary';
import { DocItemTypes } from '../../model/dsnItem';
import { AppUiActionTypes } from '../actions/appActions';

// Lazy import to avoid circular dependency
let storeModule: typeof import('../../startup') | null = null;
const getStore = () => {
  if (!storeModule) {
    storeModule = require('../../startup');
  }
  return storeModule.store;
};

export interface docStore {
  drawing: dsnDrawing;
  view: dsnView;
  bom: dsnBomEntry[];
  drawingVersion: number;

  // Editing the library
  editLibrary: tclib;
  editSymbol: tclibLibraryEntry;
  heterogeneous: boolean;
}

const intialState: docStore = {
  drawing: blank(),
  view: {
    selected_sheet: 0,

    // Here is the selectable item (that is the item that
    // the mouse is over)
    selectable: null,

    // Used when dragging an element to determine
    // which handle the user is dragging the object by
    _drag_handle: 0,
    drag: null,

    _selected_handle: 0,
    _in_select_rect: false,
    _select_rect_a: null,
    _select_rect_b: null,
    _selected_array: [],
    cursor: 'arrow',
    hover_obj: null,
    hover_ids: [],
    hover_pins: [],
    
    selection_candidates: null,
    last_click_point: null,

    // Context menu
    contextMenuLastPoint: null,

    // For adding a new item
    add: null,
    display_add: false,
    menu_command: null,

    // Used when dragging an element, the snap object
    // aids in snapping and moving the object
    in_add_rect: null,
    selectedStyle: null,
    hover_point: null,
    tracker: {
      _drag: null,
      _dragArray: null,
      _primary_horz: false,
      a: null,
      b: null,
    },

    // Zoom (in percent)
    zoom: 100,

    // Browser sheets
    browserSheets: []
  },
  bom: null,
  drawingVersion: 0,

  editLibrary: null,
  editSymbol: null,
  heterogeneous: false,
};

export function activeSheet(state: docStore): dsnSheet {
  let sheet = null;
  if (state.view.selected_sheet >= 0) {
    if (state.editSymbol) {
      sheet = state.heterogeneous
        ? state.drawing.sheets[state.view.selected_sheet]
        : state.drawing.sheets[0];
    } else {
      sheet = state.drawing.sheets[state.view.selected_sheet];
    }
  }
  return sheet;
}

export function activeSelectedSheet(state: docStore) {
  let index = 0;
  if (state.view.selected_sheet >= 0) {
    if (state.editSymbol) {
      index = state.heterogeneous ? state.view.selected_sheet : 0;
    } else {
      index = state.view.selected_sheet;
    }
  }
  return index;
}

//
// Handle dispatcher actions
//
export function DocStoreReducer(
  state: docStore = intialState,
  action: AppActionTypes,
): docStore {
  let sheet = activeSheet(state);
  let view = state.view;
  const prev_selected_array = view._selected_array;
  const update_view = new updateView();
  const update_drawing = new updateDrawing();
  const prev_drawing = state.drawing;
  const prev_library = state.editLibrary;
  const prev_edit_symbol = state.editSymbol;
  let update_hatches = false;
  let update_library;

  switch (action.type) {
    case AppUiActionTypes.ToggleRulers:
      state = update(state, {
        drawing: {
          settings: {
            showRulers: { $set: !state.drawing.settings.showRulers },
          },
        },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      break;

    // Load a completely new document
    case DocActionTypes.SetDocument:
      let new_drawing = action.doc;
      for (let i = 0; i < new_drawing.sheets.length; ++i) {
        new_drawing.sheets[i] = update_view.tidy_wires(new_drawing.sheets[i]);
      }
      state = update(state, {
        drawing: { $set: new_drawing },
        drawingVersion: { $set: 0 },
        editLibrary: { $set: null },
        editSymbol: { $set: null },
        view: {
          selected_sheet: { $set: 0 },
        },
      });
      view = null;
      break;

    case DocActionTypes.BomClose:
      state = update(state, { bom: { $set: null } });
      view = update(view, {
        selected_sheet: { $set: Math.max(view.selected_sheet, 0) },
      });
      break;

    case MenuActionTypes.BrowserClose:
      view = update(view, {
        selected_sheet: { $set: Math.max(view.selected_sheet, 0) },
        browserSheets: {
          $splice: [[action.index, 1]],
        },
      });
      break;

    case MenuActionTypes.BrowserOpen:
      const index = view.browserSheets.findIndex((b) => b.url == action.url)
      if (index < 0) {
        view = update(view, {
          browserSheets: {
            $push: [{ name: action.name, url: action.url }],
          },
          selected_sheet: { $set: -2 - view.browserSheets.length },
        });
      } else {
        view = update(view, {
          selected_sheet: { $set: -2 - index },
        });
      }
      break;

    case DocActionTypes.BomGenerate:
      if (state.drawing) {
        const bom = update_drawing.makeBomForDrawing(state.drawing);
        state = update(state, {
          bom: { $set: bom },
        });
        view = update(view, {
          selected_sheet: { $set: -1 },
        });
      }
      break;

    case DocActionTypes.UpdateNetlistHints:
      state = update(state, {
        drawing: {
          $set: update_drawing.updateNetlistHints(
            state.drawing,
            action.netlist,
          ),
        },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      view = null;
      sheet = null;
      break;

    case DocActionTypes.UpdateNetlistTypes:
      state = update(state, {
        drawing: {
          $set: update_drawing.updateNetlistTypes(
            state.drawing,
            action.netlist,
            action.netlistTypes,
            action.netTypeAssignments,
          ),
        },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      view = null;
      sheet = null;
      break;
    //
    // The text actions
    //
    case TextActionTypes.TextUpdateText:
      if (sheet) {
        sheet = update_view.updateText(
          view,
          sheet,
          action.item,
          action.handle,
          action.new_text,
        );
      }
      break;

    case TextActionTypes.TextKeyDown:
      if (sheet) {
        sheet = update_view.handleKeyDown(
          view,
          sheet,
          action.keyCode,
          action.shiftKey,
          action.ctrlKey,
        );
      }
      break;

    case TextActionTypes.TextKeyPress:
      if (sheet) {
        sheet = update_view.handleKeyPress(view, sheet, action.keyCode);
      }
      break;

    //
    // Toolbar buttons
    //
    case MenuActionTypes.MenuCommand:
    case MenuActionTypes.MenuCommandWithDefault:
      {
        if (action.command) {
          let fname = 'command_' + action.command;
          if (fname in update_view && sheet) {
            ({ view, sheet } = (update_view as any)[fname](view, sheet, action.dx, action.dy));
          }
        }
      }
      break;

    //
    // Editing objects
    //
    case MenuActionTypes.MenuEditor:
      if (sheet) {
        if (view.add) {
          ({ view, sheet } = update_view.add_event(
            view,
            sheet,
            action.event_name,
            action.p,
            action.r,
            action.key,
          ));
        } else {
          ({ view, sheet } = update_view.editor_event(
            view,
            sheet,
            action.event_name,
            update_view.is_inside(
              view,
              sheet,
              action.p,
              state.editSymbol && !state.heterogeneous
                ? state.view.selected_sheet
                : 0,
              !!state.editSymbol && state.view.selected_sheet === 0,
              !!state.editSymbol,
              state.heterogeneous,
            ),
            action.p,
            action.r,
            action.event_pos,
            [action.target.x, action.target.y],
            action.key,
            !!state.editSymbol && state.view.selected_sheet === 0,
            !!state.editSymbol,
            state.view.selected_sheet,
            state.heterogeneous,
          ));
        }
      }
      break;

    case MenuActionTypes.MenuUnfocus:
      view = update_view.unfocus(view);
      break;

    case MenuActionTypes.MenuSetStyle:
      if (sheet) {
        ({ view, sheet } = update_view.set_style(view, sheet, action.style));
        update_hatches = true;
      }
      break;

    case FindActionTypes.SetFindSelection:
      if (sheet) {
        // For modes 2 and 3, we may need to switch sheets, so find the item in the target sheet
        const targetSheetIndex = Math.max(
          0,
          state.drawing.sheets.findIndex(
            (s) => s.name === action.selection.sheet,
          ),
        );
        const targetSheet = state.drawing.sheets[targetSheetIndex];
        const hoverSheet = action.mode === 2 || action.mode === 3 ? targetSheet : sheet;
        const hoverIds =
          action.selection.ids && action.selection.ids.length > 0
            ? action.selection.ids
            : [action.selection.id];
        const hoverPins = action.selection.pins || [];
        const hoverItems = hoverIds
          .map((id) => hoverSheet?.items.find((e) => e._id === id))
          .filter((item) => !!item);
        const hover =
          hoverItems.length <= 1
            ? hoverItems[0] || null
            : hoverItems;

        switch (action.mode) {
          case 0: // Not hovering
            view = update(view, {
              hover_obj: { $set: null },
              hover_ids: { $set: [] },
              hover_pins: { $set: [] },
              hover_point: { $set: null },
            });
            break;
          case 1: // Hovering
            view = update(view, {
              hover_obj: { $set: hover },
              hover_ids: { $set: hoverIds },
              hover_pins: { $set: hoverPins },
              hover_point: { $set: action.selection.a },
            });
            break;
          case 2: // Select
            view = update(view, {
              hover_obj: { $set: hover },
              hover_ids: { $set: hoverIds },
              hover_pins: { $set: hoverPins },
              hover_point: { $set: null },
              _selected_array: { $set: [action.selection.id] },
              selected_sheet: { $set: targetSheetIndex },
            });
            break;
          case 3: // Center without selecting
            view = update(view, {
              hover_obj: { $set: hover },
              hover_ids: { $set: hoverIds },
              hover_pins: { $set: hoverPins },
              hover_point: { $set: null },
              selected_sheet: { $set: targetSheetIndex },
            });
            break;
        }
      }
      break;

    //
    // Library actions
    //
    case LibraryActionTypes.SelectLibrarySymbol:
      if (sheet) {
        ({ view, sheet } = update_view.handleSelectLibrarySymbol(
          view,
          sheet,
          action.name,
          action.symbolData,
          action.pos ?? view.contextMenuLastPoint,
        ));
      }
      break;

    //
    // Add an image
    //
    case DocActionTypes.AddImage:
      if (sheet) {
        ({ view, sheet } = update_view.handleAddImage(
          view,
          sheet,
          action.data,
          action.imgType,
          action.dataSize,
          action.size,
          action.pos ?? view.contextMenuLastPoint,
        ));
      }
      break;

    //
    // Clipboard operations
    //
    case MenuActionTypes.MenuPaste:
      if (sheet) {
        ({ view, sheet } = update_view.handlePaste(
          view,
          sheet,
          action.text,
          action.pos ?? view.contextMenuLastPoint,
        ));
        update_hatches = true;
      }
      break;

    case MenuActionTypes.MenuCut:
      if (sheet) {
        ({ view, sheet } = update_view.handleCopy(view, sheet, true));
      }
      break;

    case MenuActionTypes.MenuCopy:
      if (sheet) {
        ({ view, sheet } = update_view.handleCopy(view, sheet, false));
      }
      break;

    //
    // Sheet operations
    //
    case MenuActionTypes.MenuSheetSelect:
      view = update(view, {
        selected_sheet: { $set: action.sheet_index },
      });
      break;
    case MenuActionTypes.MenuSheetLeft:
      if (
        ((state.drawing.sheets[0].hierarchicalSymbol &&
          view.selected_sheet > 1) ||
          (!state.drawing.sheets[0].hierarchicalSymbol &&
            view.selected_sheet > 0)) &&
        !state.editSymbol
      ) {
        let sheets = state.drawing.sheets.slice();
        let a = sheets[view.selected_sheet - 1];
        sheets[view.selected_sheet - 1] = sheets[view.selected_sheet];
        sheets[view.selected_sheet] = a;
        state = update(state, {
          drawing: {
            sheets: { $set: sheets },
          },
          view: {
            selected_sheet: { $set: view.selected_sheet - 1 },
          },
        });
        sheet = null;
        view = null;
      }
      break;
    case MenuActionTypes.MenuSheetRight:
      if (
        view.selected_sheet < state.drawing.sheets.length - 1 &&
        !state.editSymbol
      ) {
        let sheets = state.drawing.sheets.slice();
        let a = sheets[view.selected_sheet + 1];
        sheets[view.selected_sheet + 1] = sheets[view.selected_sheet];
        sheets[view.selected_sheet] = a;
        state = update(state, {
          drawing: {
            sheets: { $set: sheets },
          },
          view: {
            selected_sheet: { $set: view.selected_sheet + 1 },
          },
        });
        sheet = null;
        view = null;
      }
      break;
    case MenuActionTypes.MenuSheetMove:
      {
        const { fromIndex, toIndex } = action;
        // Determine the minimum allowed index (skip hierarchical symbol sheet if present)
        const minIndex = state.drawing.sheets[0]?.hierarchicalSymbol ? 1 : 0;
        
        if (
          !state.editSymbol &&
          fromIndex >= minIndex &&
          toIndex >= minIndex &&
          fromIndex < state.drawing.sheets.length &&
          toIndex < state.drawing.sheets.length &&
          fromIndex !== toIndex
        ) {
          let sheets = state.drawing.sheets.slice();
          const [movedSheet] = sheets.splice(fromIndex, 1);
          sheets.splice(toIndex, 0, movedSheet);
          state = update(state, {
            drawing: {
              sheets: { $set: sheets },
            },
            view: {
              selected_sheet: { $set: toIndex },
            },
          });
          sheet = null;
          view = null;
        }
      }
      break;
    case MenuActionTypes.MenuSheetRename:
      sheet = update(sheet, {
        name: { $set: action.sheet_name },
      });
      break;
    case MenuActionTypes.MenuSheetAdd:
      {
        let sheets = state.drawing.sheets.slice();
        let new_sheet: dsnSheet = {
          items: [],
          details: sheet.details,
          options: sheet.options,
          name: action.sheet_name,
          symbols: {},
          images: {},
          hatches: [],
          hierarchicalSymbol: false,
        };
        sheets.push(new_sheet);
        sheet = null;
        view = null;
        state = update(state, {
          drawing: {
            sheets: { $set: sheets },
          },
          view: {
            selected_sheet: { $set: sheets.length - 1 },
          },
        });
      }
      break;
    case MenuActionTypes.MenuSheetRemove:
      if (!state.editSymbol) {
        let sheets = state.drawing.sheets.slice();
        sheets.splice(view.selected_sheet, 1);
        let selected_sheet = view.selected_sheet;
        if (selected_sheet > 0) {
          --selected_sheet;
        }
        sheet = null;
        view = null;
        state = update(state, {
          drawing: {
            sheets: { $set: sheets },
          },
          view: {
            selected_sheet: { $set: selected_sheet },
          },
        });
      } else {
        if (state.editSymbol.ppp > 1) {
          let sheets = state.drawing.sheets;
          let selected_sheet = view.selected_sheet;

          if (state.heterogeneous) {
            sheets = sheets.slice();
            sheets.splice(selected_sheet, 1);
            if (selected_sheet >= sheets.length) {
              selected_sheet = sheets.length - 1;
            }
          }

          state = update(state, {
            editSymbol: {
              ppp: { $set: state.editSymbol.ppp - 1 },
            },
            drawing: {
              sheets: { $set: sheets },
            },
            view: {
              selected_sheet: { $set: selected_sheet },
            },
          });
        }
      }
      break;

    //
    // Dialogue operations
    //
    case DialogActionTypes.SetPageSize:
      if (sheet) {
        sheet = update(sheet, {
          details: {
            page_size: { $set: action.page_size },
          },
        });
      }
      break;

    case DialogActionTypes.SetDetails:
      if (sheet) {
        sheet = update(sheet, {
          details: {
            title: { $set: action.details.title },
            author: { $set: action.details.author },
            revision: { $set: action.details.revision },
            docnumber: { $set: action.details.docnumber },
            organisation: { $set: action.details.organisation },
            sheets: { $set: action.details.sheets },
            date: { $set: action.details.date },
            horiz_guide: { $set: action.details.horiz_guide },
            vert_guide: { $set: action.details.vert_guide },
            show_details: { $set: action.details.show_details },
            show_guides: { $set: action.details.show_guides },
          },
        });
      }
      break;

    case DialogActionTypes.SetDetailsAllSheets:
      // Apply design details to all sheets (except "sheets" field which typically contains page number)
      {
        let updatedSheets = state.drawing.sheets.map((s) => {
          return update(s, {
            details: {
              title: { $set: action.details.title },
              author: { $set: action.details.author },
              revision: { $set: action.details.revision },
              docnumber: { $set: action.details.docnumber },
              organisation: { $set: action.details.organisation },
              date: { $set: action.details.date },
              horiz_guide: { $set: action.details.horiz_guide },
              vert_guide: { $set: action.details.vert_guide },
              show_details: { $set: action.details.show_details },
              show_guides: { $set: action.details.show_guides },
              // Note: "sheets" field is intentionally NOT updated - it typically contains page numbers
            },
          });
        });
        sheet = null;
        view = null;
        state = update(state, {
          drawing: {
            sheets: { $set: updatedSheets },
          },
        });
      }
      break;

    case DialogActionTypes.SetSettings:
      if (sheet) {
        sheet = update(sheet, {
          details: {
            grid: { $set: action.details.grid },
            grid_snap: { $set: action.details.grid_snap },
          },
          options: {
            show_grid: { $set: action.details.show_grid },
            units: { $set: action.details.units },
          },
        });
      }
      break;

    case DialogActionTypes.SetColours:
      if (sheet) {
        sheet = update(sheet, {
          options: {
            color_background: { $set: action.colours.color_background },
            color_bus: { $set: action.colours.color_bus },
            color_hidden_pin: { $set: action.colours.color_hidden_pin },
            color_junction: { $set: action.colours.color_junction },
            color_label: { $set: action.colours.color_label },
            color_noconnect: { $set: action.colours.color_noconnect },
            color_notetext_fill: { $set: action.colours.color_notetext_fill },
            color_notetext_line: { $set: action.colours.color_notetext_line },
            color_notetext_text: { $set: action.colours.color_notetext_text },
            color_pin: { $set: action.colours.color_pin },
            color_power: { $set: action.colours.color_power },
            color_wire: { $set: action.colours.color_wire },
          },
        });
      }
      break;

    case DialogActionTypes.SetColoursAllSheets:
      {
        let updatedSheets = state.drawing.sheets.map((s) => {
          return update(s, {
            options: {
              color_background: { $set: action.colours.color_background },
              color_bus: { $set: action.colours.color_bus },
              color_hidden_pin: { $set: action.colours.color_hidden_pin },
              color_junction: { $set: action.colours.color_junction },
              color_label: { $set: action.colours.color_label },
              color_noconnect: { $set: action.colours.color_noconnect },
              color_notetext_fill: { $set: action.colours.color_notetext_fill },
              color_notetext_line: { $set: action.colours.color_notetext_line },
              color_notetext_text: { $set: action.colours.color_notetext_text },
              color_pin: { $set: action.colours.color_pin },
              color_power: { $set: action.colours.color_power },
              color_wire: { $set: action.colours.color_wire },
            },
          });
        });
        sheet = null;
        view = null;
        state = update(state, {
          drawing: {
            sheets: { $set: updatedSheets },
          },
        });
      }
      break;

    case DialogActionTypes.SetDRC:
      let drcTable = update_drawing.designRulesCheck(
        state.drawing,
        action.drc,
        action.netlist,
      );
      state = update(state, {
        drawing: {
          drc: { $set: action.drc },
          drcTable: { $set: drcTable },
        },
      });
      break;

    case DialogActionTypes.SetAnnotate:
      state = update(state, {
        drawing: {
          $set: update_drawing.global_annotate(
            state.drawing,
            action.annotate,
            activeSelectedSheet(state),
          ),
        },
      });
      sheet = null;
      view = null;
      break;

    //
    // Symbol operations
    //
    case SymbolActionTypes.SymbolShowPower:
      if (sheet) {
        sheet = update_view.showShowPower(view, sheet, action.show_power);
      }
      break;

    case SymbolActionTypes.SymbolAllowResize:
      if (sheet) {
        sheet = update_view.allowResize(view, sheet, action.allow_resize);
      }
      break;

    case SymbolActionTypes.SymbolResetResize:
      if (sheet) {
        sheet = update_view.resetResize(view, sheet);
      }
      break;

    case SymbolActionTypes.SymbolShow:
      if (sheet) {
        sheet = update_view.showShow(view, sheet, action.index);
      }
      break;

    case SymbolActionTypes.SetSymbolValue:
      if (sheet) {
        sheet = update_view.showValue(view, sheet, action.index, action.value);
      }
      break;

    case SymbolActionTypes.SetSymbolPPP:
      if (sheet) {
        sheet = update_view.showPPP(view, sheet, parseInt(action.value, 10));
      }
      break;

    case SymbolActionTypes.SetSymbolName:
      if (sheet) {
        sheet = update_view.showName(view, sheet, action.index, action.value);
      }
      break;

    case SymbolActionTypes.SymbolDelete:
      if (sheet) {
        sheet = update_view.showDelete(view, sheet, action.index);
      }
      break;

    case SymbolActionTypes.SymbolAdd:
      if (sheet) {
        sheet = update_view.showAdd(view, sheet);
        update_hatches = true;
      }
      break;

    case SymbolActionTypes.SymbolEditPin:
      if (sheet) {
        sheet = update_view.editPin(view, sheet, action.pin);
      }
      break;

    //
    // Editing a library
    //
    case LibraryActionTypes.EditLibrary:
      update_library = new updateLibrary(action.lib);
      if (action.lib.names.length == 0) {
        update_library.lib = update_library.addNewLibrarySymbol();
      }
      state = update(state, {
        editLibrary: { $set: update_library.lib },
        editSymbol: { $set: update_library.lib.names[0] },
        drawing: { $set: blank() },
        drawingVersion: { $set: 0 },
      });
      view = null;
      break;

    case LibraryActionTypes.UpdateCurrentLibrary:
      state = update(state, {
        editLibrary: { $set: action.lib },
      });
      break;

    case LibraryActionTypes.EditLibrarySymbol:
      update_library = new updateLibrary(state.editLibrary);
      if (state.editSymbol) {
        // First write back the edited symbol to the library
        state = update(state, {
          editLibrary: {
            $set: update_library.writeSymbolData(
              state.editSymbol,
              state.drawing,
            ),
          },
        });
      }
      state = update(state, {
        editSymbol: { $set: action.name },
        view: {
          selected_sheet: { $set: 0 },
        },
      });
      view = null;
      break;

    case SymbolActionTypes.SymbolEditSymbol:
      state = update(state, {
        editSymbol: { $set: { ...state.editSymbol, ...action.editSymbol } },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      break;

    case SymbolActionTypes.SymbolEditOutline:
      // If we are going from heterogeneous to homogeneous, we need to
      // copy all of the pins on to the first sheet and delete the others
      if (!action.heterogeneous && state.heterogeneous) {
        const items = state.drawing.sheets.reduce(
          (acc, sheet, index) => [
            ...acc,
            ...sheet.items
              .filter((i) => index === 0 || i.NodeName == DocItemTypes.Pin)
              .map((i) =>
                i.NodeName == DocItemTypes.Pin ? { ...i, part: index + 1 } : i,
              ),
          ],
          [],
        );
        const sheets = [{ ...state.drawing.sheets[0], items: items }];

        state = update(state, {
          drawing: {
            sheets: { $set: sheets },
          },
          heterogeneous: { $set: false },
        });
      } else if (action.heterogeneous && !state.heterogeneous) {
        // If we are going from homogeneous to heterogeneous, we need to
        // copy all of the pins on to the first sheet to the new sheets
        const sheets = [];
        for (let i = 0; i < state.editSymbol.ppp; ++i) {
          const sheet = {
            ...state.drawing.sheets[0],
            items: state.drawing.sheets[0].items
              .filter(
                (item) =>
                  item.NodeName !== DocItemTypes.Pin ||
                  (item.NodeName === DocItemTypes.Pin && item.part === i),
              )
              .map((item) =>
                item.NodeName === DocItemTypes.Pin
                  ? { ...item, part: 0 }
                  : item,
              ),
          };
          sheets.push(sheet);
        }

        state = update(state, {
          drawing: {
            sheets: {
              $set: sheets,
            },
          },
          heterogeneous: { $set: true },
        });
      }
      break;

    case LibraryActionTypes.SetPPP:
      // Is this changing the PPP of the symbol?
      if (state.editSymbol.ppp !== action.ppp) {
        // Are we heterogeneous?
        if (state.heterogeneous) {
          // We need to change the number of sheets in the symbol
          let sheets = state.drawing.sheets.slice();

          if (action.ppp > state.editSymbol.ppp) {
            // Adding parts
            for (let i = state.editSymbol.ppp + 1; i <= action.ppp; i++) {
              let new_sheet: dsnSheet = {
                items: state.drawing.sheets[0].items.slice(),
                details: state.drawing.sheets[0].details,
                options: state.drawing.sheets[0].options,
                name: `Part ${String.fromCharCode(64 + i)}`,
                symbols: {},
                images: { ...state.drawing.sheets[0].images },
                hatches: state.drawing.sheets[0].hatches.slice(),
                hierarchicalSymbol: false,
              };
              sheets.push(new_sheet);
            }
          } else {
            // Removing parts
            sheets = sheets.slice(0, action.ppp);
          }

          sheet = null;
          view = null;
          state = update(state, {
            drawing: {
              sheets: { $set: sheets },
            },
            view: {
              selected_sheet: {
                $set: Math.min(state.view.selected_sheet, sheets.length - 1),
              },
            },
          });
        }
        state = update(state, {
          editSymbol: {
            ppp: { $set: action.ppp },
          },
        });
      }
      update_library = new updateLibrary(state.editLibrary);
      break;

    case LibraryActionTypes.DuplicateLibrarySymbol:
      // Make sure we always have at least one symbol in the library
      update_library = new updateLibrary(state.editLibrary);
      const dup = update_library.duplicateLibrarySymbol(action.nameId);
      update_library.lib = dup.lib;
      state = update(state, {
        editLibrary: {
          $set: dup.lib,
        },
        editSymbol: { $set: dup.name },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      break;

    case LibraryActionTypes.DeleteLibrarySymbol:
      // Make sure we always have at least one symbol in the library
      update_library = new updateLibrary(state.editLibrary);
      if (update_library.lib.names.length === 1) {
        update_library.setLib(update_library.addNewLibrarySymbol());
      }

      // Find a new name to edit
      let newEditSymbol = state.editSymbol;
      if (action.nameId == state.editSymbol?.NameID) {
        newEditSymbol = update_library.lib.names.find(
          (n) => n.NameID != action.nameId,
        );
      }
      state = update(state, {
        editLibrary: {
          $set: update_library.deleteLibrarySymbol(action.nameId),
        },
        editSymbol: { $set: newEditSymbol },
        drawingVersion: { $set: state.drawingVersion + 1 },
      });
      break;

    case LibraryActionTypes.AddLibrarySymbol:
      update_library = new updateLibrary(state.editLibrary);
      update_library.lib = update_library.addNewLibrarySymbol();
      state = update(state, {
        editLibrary: {
          $set: update_library.lib,
        },
        editSymbol: {
          $set: update_library.lib.names[update_library.lib.names.length - 1],
        },
      });
      break;

    default:
      break;
  }

  if (sheet && update_hatches) {
    sheet = update_view.rebuildHatches(sheet);
  }

  if (view && sheet && sheet !== activeSheet(state)) {
    let sheets = state.drawing.sheets.slice();
    sheets[activeSelectedSheet(state)] = sheet;
    state = update(state, {
      drawing: {
        sheets: { $set: sheets },
      },
    });
  }

  if (view && sheet && prev_selected_array !== view._selected_array) {
    const symbol = update_view.getSelectedSymbol(view, sheet);
    if (symbol && action.type !== FindActionTypes.SetFindSelection) {
      setTimeout(() => {
        // Switch to the symbol panel - bottom panel for normal mode, side panel for edit symbol mode
        if (state.editSymbol) {
          getStore().dispatch(actionSelectPanel(Panels.SymbolPanel));
        } else {
          getStore().dispatch(actionSelectBottomPanel(BottomPanels.SymbolPanel));
        }
      });
    }
  }

  if (view && view !== state.view) {
    state = update(state, {
      view: { $set: view },
    });
  }

  if (state.editSymbol != prev_edit_symbol) {
    // Has the name changed?
    if (state.editSymbol.NameID === prev_edit_symbol?.NameID) {
      // No, so write back the new name data
      const index = state.editLibrary.names.findIndex(
        (n) => n.NameID === state.editSymbol.NameID,
      );
      state = update(state, {
        editLibrary: {
          names: {
            [index]: {
              $set: state.editSymbol,
            },
          },
        },
      });
    }

    // Has the symbol changed?
    if (state.editSymbol.SymbolID !== prev_edit_symbol?.SymbolID) {
      let new_symbol_drawing = null;
      if (!update_library) {
        update_library = new updateLibrary(state.editLibrary);
      }
      new_symbol_drawing = update_library.getSymbolDoc(state.editSymbol);
      if (!new_symbol_drawing) {
        new_symbol_drawing = blank();
      }
      for (let i = 0; i < new_symbol_drawing.sheets.length; ++i) {
        new_symbol_drawing.sheets[i] = update_view.tidy_wires(
          new_symbol_drawing.sheets[i],
        );
      }
      state = update(state, {
        drawing: { $set: new_symbol_drawing },
        heterogeneous: { $set: new_symbol_drawing.sheets.length > 1 },
      });
    }
  } else if (
    state.drawing !== prev_drawing ||
    prev_library !== state.editLibrary
  ) {
    state = update(state, {
      drawingVersion: { $set: state.drawingVersion + 1 },
    });
  }

  return state;
}
