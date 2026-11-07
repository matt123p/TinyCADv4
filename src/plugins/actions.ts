import type { dsnDrawing } from '../model/dsnDrawing';
import type { tclib, tclibLibraryEntry } from '../model/tclib';
export const PLUGIN_EDIT = '[Plugins] Edit transaction';
export const PLUGIN_SELECTION = '[Plugins] Selection';
export const RESTORE_SESSION = '[Plugins] Restore session';
export interface PluginEditAction {
  type: typeof PLUGIN_EDIT; drawing: dsnDrawing; expectedVersion: number;
  library?: tclib; symbol?: tclibLibraryEntry;
}
export interface PluginSelectionAction { type: typeof PLUGIN_SELECTION; ids: number[]; sheetIndex: number; }
export type PluginActions = PluginEditAction | PluginSelectionAction;
