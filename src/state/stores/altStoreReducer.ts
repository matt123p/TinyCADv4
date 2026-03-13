import {
  actionCommand,
  AppActionTypes,
  Panels,
  BottomPanels,
} from '../dispatcher/AppDispatcher';
import update from 'immutability-helper';

import { DocActionTypes } from '../actions/docActions';
import { MenuActionTypes } from '../actions/menuActions';
import { DialogActionTypes } from '../actions/dialogActions';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import { LibraryActionTypes } from '../actions/libraryActions';
import { TSheet } from '../../components/svg/Sheet';
import { FindActionTypes } from '../actions/findActions';
import { store } from '../../startup';
import { Coordinate } from '../../model/dsnItem';
import { ContextMenuList } from '../../manipulators/updateInterfaces';
import { FileIdType } from '../../io/files';
import { SearchSymbol } from '../../components/libraryPanel/Search';
import { UserLoginActionTypes } from '../actions/userLogin';
import { ViewActions, ViewActionTypes } from '../actions/viewActions';
import power0Image from 'url:../../../images/power0.png';
import label0Image from 'url:../../../images/label0.png';
import rectangleImage from 'url:../../../images/rectangle.png';
import busImage from 'url:../../../images/bus.png';
import rulerHImage from 'url:../../../images/ruler_h.png';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  imageUrl: string;
}

export interface LibraryFile {
  id: FileIdType;
  name: string;
}

export interface CurrentFile {
  id: FileIdType | string;
  name: string;
  folderId?: string;
}

export interface UserConfig {
  fileId: string;
  libraries: LibraryFile[];
}

interface ToolbarDefault {
  command: string;
  image: string;
}

export interface ToolbarDefaults {
  Power: ToolbarDefault;
  Label: ToolbarDefault;
  Shape: ToolbarDefault;
  Bus: ToolbarDefault;
  Ruler: ToolbarDefault;
}

export interface altStore {
  // Which dialogue is currently being shown?
  show_dialogue: string;
  dialogue_props: any;

  // User libraries that haven been loaded
  libraries: tclib[];
  viewLibrary: tclib;

  // The panel currently being shown
  panel: Panels;

  // The bottom panel currently being shown
  bottomPanel: BottomPanels;

  // The currently selected library symbol for preview
  displaySymbol: tclibSymbol;
  displayName: tclibLibraryEntry;
  displaySearchSymbol: SearchSymbol;

  // The defaults for the toolbar
  toolbarDefaults: ToolbarDefaults;

  // The list of sheets - this is used so that
  // when we select an object sheet we can tell
  // the sheet to scroll to the specific location
  activeSheets: TSheet[];

  // Context menu
  contextMenu: {
    hidden: boolean;
    position: Coordinate;
    items: ContextMenuList;
  };

  // The current state of the user's login
  loginState: number;
  loginError: string;
  user: CurrentUser;
  file: CurrentFile;

  // Currently saving the file
  saveInProgress: boolean;

  // Which version of the file was last saved
  savedVersion: number;

  // List of recently save files
  recentFiles: CurrentFile[];

  config: UserConfig;
  
  // Current mouse position in drawing coordinates
  mousePosition: Coordinate | null;
}

const intialState: altStore = {
  dialogue_props: null,
  show_dialogue: null,

  libraries: [],
  viewLibrary: null,

  panel: Panels.LibrariesPanel,
  bottomPanel: BottomPanels.StylePanel,

  displaySymbol: null,
  displayName: null,
  displaySearchSymbol: null,

  toolbarDefaults: {
    Power: {
      image: power0Image,
      command: 'add_power0',
    },
    Label: {
      image: label0Image,
      command: 'add_label0',
    },
    Shape: {
      image: rectangleImage,
      command: 'add_rectangle',
    },
    Bus: {
      image: busImage,
      command: 'add_bus',
    },
    Ruler: {
      image: rulerHImage,
      command: 'add_hruler',
    },
  },

  // Context menu
  contextMenu: {
    hidden: true,
    items: [],
    position: [0, 0],
  },

  activeSheets: [],

  loginState: 1,
  loginError: null,
  user: null,
  file: {
    id: null,
    name: null,
    folderId: null,
  },

  saveInProgress: false,
  savedVersion: 0,

  config: {
    fileId: null,
    libraries: [],
  },

  recentFiles: [],
  mousePosition: null,
};

//
// Handle dispatcher actions
//
export function AltStoreReducer(
  state: altStore = intialState,
  action: AppActionTypes | ViewActions,
): altStore {
  switch (action.type) {
    case ViewActionTypes.SetMousePosition:
      return update(state, {
        mousePosition: { $set: action.position },
      });

    // Login the user
    case UserLoginActionTypes.UserLoginLoginOK:
      return update(state, {
        loginState: { $set: 3 },
        loginError: { $set: null },
        user: { $set: action.user },
      });

    case UserLoginActionTypes.UserLoginLoginError:
      return update(state, {
        loginState: { $set: 4 },
        loginError: { $set: action.error },
        user: { $set: null },
      });

    case UserLoginActionTypes.BrowserError:
      return update(state, {
        loginState: { $set: 5 },
        loginError: { $set: null },
        user: { $set: null },
      });

    // Load a completely new document
    case DocActionTypes.SetDocument:
      return update(state, {
        loginState: { $set: 3 },
        loginError: { $set: null },

        file: {
          name: { $set: action.filename },
          id: { $set: action.id },
          folderId: { $set: action.folderId },
        },
        savedVersion: { $set: 1 },
      });

    case DocActionTypes.SetFileData:
      return update(state, {
        loginState: { $set: 3 },
        loginError: { $set: null },

        saveInProgress: { $set: false },
        file: {
          name: { $set: action.filename },
          id: { $set: action.id },
          folderId: { $set: action.folderId },
        },
        savedVersion: { $set: action.drawingVersion },
      });

    case DocActionTypes.RenameDocument:
      return update(state, {
        file: {
          name: { $set: action.filename },
        },
      });

    // TSheet Actions
    case DocActionTypes.RegisterTSheet:
      return update(state, {
        activeSheets: { $set: [...state.activeSheets, action.tsheet] },
      });

    case DocActionTypes.UnregisterTSheet:
      return update(state, {
        activeSheets: {
          $set: state.activeSheets.filter((f) => f !== action.tsheet),
        },
      });

    case FindActionTypes.SetFindSelection:
      switch (action.mode) {
        case 0: // Not hovering
          break;
        case 1: // Hovering
          break;
        case 2: // Select
          // Make the sheet come in to focus
          for (const s of state.activeSheets) {
            s.onshowItem(action.selection.id);
          }
          break;
        case 3: // Center without selecting
          // Make the sheet come in to focus and center the item
          for (const s of state.activeSheets) {
            s.onshowItem(action.selection.id);
          }
          break;
      }
      break;

    // Menu Actions
    case MenuActionTypes.MenuSheetRename:
      state = update(state, {
        show_dialogue: { $set: null },
        dialogue_props: { $set: null },
      });
      break;

    case MenuActionTypes.MenuSheetAdd: {
      state = update(state, {
        show_dialogue: { $set: null },
        dialogue_props: { $set: null },
      });
    }

    case MenuActionTypes.MenuSheetRemove:
      {
        state = update(state, {
          show_dialogue: { $set: null },
          dialogue_props: { $set: null },
        });
      }
      break;

    //
    // Editing a library
    //

    case LibraryActionTypes.ViewLibrary:
      state = update(state, {
        viewLibrary: { $set: !!action.lib ? { ...action.lib } : null },
      });
      break;

    case LibraryActionTypes.DeleteLibrarySymbol:
      state = update(state, {
        show_dialogue: { $set: null },
        dialogue_props: { $set: null },
      });
      break;

    case LibraryActionTypes.EditLibrary:
      state = update(state, {
        loginState: { $set: 3 },
        loginError: { $set: null },

        file: {
          name: { $set: action.filename },
          id: { $set: action.id },
          folderId: { $set: action.folderId },
        },
        savedVersion: { $set: 0 },
        panel: { $set: Panels.LibrariesPanel },
      });
      break;

    //
    // Dialogue operations
    //
    case DialogActionTypes.PanelSelect:
      state = update(state, {
        panel: { $set: action.dlg },
      });
      break;

    case DialogActionTypes.BottomPanelSelect:
      state = update(state, {
        bottomPanel: { $set: action.dlg },
      });
      break;

    case DialogActionTypes.SetDisplaySymbol:
      state = update(state, {
        displaySymbol: { $set: action.symbol },
        displayName: { $set: action.name },
        displaySearchSymbol: { $set: action.searchSymbol },
      });
      break;

    case DialogActionTypes.DialogSelect:
      state = update(state, {
        show_dialogue: { $set: action.dlg },
        dialogue_props: { $set: action.props },
      });
      break;

    case DialogActionTypes.SetPageSize:
    case DialogActionTypes.SetDetails:
    case DialogActionTypes.SetSettings:
    case DialogActionTypes.SetColours:
    case DialogActionTypes.SetAnnotate:
      state = update(state, {
        show_dialogue: { $set: null },
        dialogue_props: { $set: null },
      });
      break;

    case DialogActionTypes.SetDRC:
      state = update(state, {
        show_dialogue: { $set: null },
        dialogue_props: { $set: null },
        panel: { $set: Panels.DrcPanel },
      });
      break;

    case LibraryActionTypes.SetLibraryList:
      state = update(state, {
        libraries: { $set: action.libraries },
      });
      break;

    case LibraryActionTypes.SetLibraryData: {
      const libraryIndex = state.libraries.findIndex(
        (l) => l.fileId == action.lib.fileId,
      );
      state = update(state, {
        libraries:
          libraryIndex >= 0
            ? {
                $splice: [[libraryIndex, 1, action.lib]],
              }
            : {
                $push: [action.lib],
              },
      });
      break;
    }

    case MenuActionTypes.MenuCommandWithDefault:
      state = update(state, {
        toolbarDefaults: {
          [action.context]: {
            $set: {
              command: action.item.key,
              image: action.item.iconProps.imageProps.src,
            },
          },
        },
      });
      break;

    case MenuActionTypes.MenuDefaultCommand:
      setTimeout(() => {
        store.dispatch(
          actionCommand((state.toolbarDefaults as any)[action.context].command),
        );
      });
      break;

    case MenuActionTypes.MenuSetContextMenu:
      state = update(state, {
        contextMenu: {
          hidden: { $set: false },
          position: { $set: action.position },
          items: { $set: action.items },
        },
      });
      break;

    case DocActionTypes.SaveInProgress:
      state = update(state, {
        saveInProgress: { $set: action.saveInProgress },
        savedVersion: { $set: action.drawingVersion ?? state.savedVersion },
      });
      break;


    case MenuActionTypes.MenuSetRecentFileList:
      state = update(state, {
        recentFiles: { $set: action.files },
      });
      break;

    default:
      break;
  }

  // Context menu hiding
  switch (action.type) {
    case MenuActionTypes.MenuCommand:
    case MenuActionTypes.MenuCommandWithDefault:
    case LibraryActionTypes.SelectLibrarySymbol:
    case MenuActionTypes.MenuPaste:
    case MenuActionTypes.MenuCut:
    case MenuActionTypes.MenuCopy:
    case DialogActionTypes.DialogSelect:
    case MenuActionTypes.MenuSheetSelect:
      state = update(state, {
        contextMenu: {
          $set: {
            position: state.contextMenu?.position,
            hidden: true,
            items: [] as ContextMenuList,
          },
        },
      });
      break;
  }

  return state;
}
