import type { TFunction } from 'i18next';

export interface NativeMenuTranslations {
  [key: string]: string;
}

const menuLabel = (t: TFunction<'common'>, key: string, fallback: string): string => {
  const value = t(key, { defaultValue: fallback });
  return value === key ? fallback : value;
};

export const buildNativeMenuTranslations = (t: TFunction<'common'>): NativeMenuTranslations => ({
  file: menuLabel(t, 'toolbar.file', 'File'),
  new: menuLabel(t, 'toolbar.new', 'New'),
  newDesign: menuLabel(t, 'toolbar.newDesign', 'New Design'),
  newLibrary: menuLabel(t, 'toolbar.newCustomLibrary', 'New Library'),
  open: menuLabel(t, 'toolbar.open', 'Open'),
  openRecent: menuLabel(t, 'toolbar.openRecent', 'Open Recent'),
  noRecentFiles: menuLabel(t, 'toolbar.noRecentFiles', 'No Recent Files'),
  save: menuLabel(t, 'toolbar.save', 'Save'),
  saveAs: menuLabel(t, 'toolbar.saveAs', 'Save As...'),
  import: menuLabel(t, 'toolbar.import', 'Import'),
  export: menuLabel(t, 'toolbar.export', 'Export'),
  importKicadSymbols: menuLabel(t, 'toolbar.importKicad', 'KiCad Symbols...'),
  print: menuLabel(t, 'toolbar.print', 'Print'),
  exportSvg: menuLabel(t, 'toolbar.exportSvg', 'Export to SVG'),
  exportPdf: menuLabel(t, 'toolbar.exportPdf', 'Export to PDF'),

  edit: menuLabel(t, 'toolbar.edit', 'Edit'),
  undo: menuLabel(t, 'toolbar.undo', 'Undo'),
  redo: menuLabel(t, 'toolbar.redo', 'Redo'),
  rotateLeft: menuLabel(t, 'toolbar.rotateLeft', 'Rotate Left'),
  rotateRight: menuLabel(t, 'toolbar.rotateRight', 'Rotate Right'),
  flipHorizontal: menuLabel(t, 'toolbar.flipHorizontal', 'Flip Horizontal'),
  flipVertical: menuLabel(t, 'toolbar.flipVertical', 'Flip Vertical'),

  view: menuLabel(t, 'toolbar.view', 'View'),
  zoomIn: menuLabel(t, 'toolbar.zoomIn', 'Zoom In'),
  zoomOut: menuLabel(t, 'toolbar.zoomOut', 'Zoom Out'),

  tools: menuLabel(t, 'toolbar.tools', 'Tools'),
  annotateSymbols: menuLabel(t, 'toolbar.annotateSymbols', 'Annotate Symbols...'),
  billOfMaterials: menuLabel(t, 'toolbar.billOfMaterials', 'Bill of Materials...'),
  checkDesignRules: menuLabel(t, 'toolbar.checkDesignRules', 'Check Design Rules'),
  generateNetlist: menuLabel(t, 'toolbar.generateNetlist', 'Generate Netlist...'),
  generateSpiceNetlist: menuLabel(t, 'toolbar.generateSpiceNetlist', 'Generate Spice NetList'),
  createVhdlFile: menuLabel(t, 'toolbar.createVhdlFile', 'Create VHDL file'),

  settings: menuLabel(t, 'toolbar.settings', 'Settings'),
  designDetails: menuLabel(t, 'toolbar.designDetails', 'Design Details...'),
  pageSize: menuLabel(t, 'toolbar.pageSize', 'Page Size...'),
  settingsDialog: menuLabel(t, 'toolbar.settingsDialog', 'Settings...'),
  colours: menuLabel(t, 'toolbar.colours', 'Colours...'),

  discord: menuLabel(t, 'toolbar.discord', 'Discord'),
  manual: menuLabel(t, 'toolbar.manual', 'Manual'),
  aboutTinyCAD: menuLabel(t, 'toolbar.aboutTinyCAD', 'About TinyCAD'),
});
