import { DocItem, Coordinate, dsnPin } from './dsnItem';
import { Snap } from '../manipulators/snap';

export interface SheetDetails {
  author: string;
  date: string;
  docnumber: string;
  organisation: string;
  revision: string;
  sheets: string;
  title: string;
  show_details: boolean;
  show_guides: boolean;
  horiz_guide: number;
  vert_guide: number;
  filename: string;
  page_size: Coordinate;
  grid_snap: boolean;
  grid: number;
}

export interface ActivePoint {
  pos: Coordinate;
  power: boolean;
  part: number;
  pin: dsnPin;
}

export interface SymbolProperty {
  value: string;
  type: number;
}

export type Size = [number, number];

export interface libSymbolPart {
  // Symbol definitons
  items: DocItem[];

  // Here is the size of the symbol
  size: Size;

  // Hotspots for connections
  active_points: ActivePoint[];

  // Reference point for placement
  ref_point: Coordinate;
}

export interface libSymbol {
  // ID for this drawing
  id: number;

  // Some symbol properties
  description: string;
  name: SymbolProperty;
  ref: SymbolProperty;

  // Parts per package
  parts: number;

  // Globally Unique identifier
  uid: string;

  // The different outlines of the symbol
  outlines: libSymbolPart[];

  // What type of symbol is this
  heterogeneous: boolean;
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
  notetext_fill: boolean;
  notetext_stroke: boolean;
  notetext_line_pattern: number;
  notetext_line_width: number;
  color_pin: string;
  color_power: string;
  color_wire: string;
  color_shape: string;
  color_shape_fill: string;
  fill_shape: boolean;
  stroke_shape: boolean;
  shape_line_pattern: number;
  shape_line_width: number;
  font_bold: boolean;
  font_italic: boolean;
  font_name: string;
  font_size: number;
}

export interface SheetOptions extends SheetColours {
  show_grid: boolean;
  units: number;
}

export interface libImage {
  // ID for this Images
  id: number;

  // (as base64)
  imageData: string;
  size: number;

  // PNG or JPEG
  type: string;
}

export interface libHatch {
  // ID for this hatch
  id: string;

  // Hatch type
  index: number;

  // Hatch colour
  color: string;
}

export interface dsnSheet {
  items: DocItem[];
  details: SheetDetails;

  // The name of this sheet
  name: string;

  // Currently in use symbols
  symbols: { [key: string]: libSymbol };

  // Currently in use images
  images: { [key: string]: libImage };

  // Currently in use hatches
  hatches: libHatch[];

  // Current options for this sheet
  options: SheetOptions;

  // Is this a hierarchical symbol for the design?
  hierarchicalSymbol: boolean;
}

export interface DrcError {
  symbol?: string;
  pin?: string;
  text: string;
  a: Coordinate;
  id: number;
  sheet: string;
}

export interface DrcOptions {
  DupRef: boolean;
  UnConnect: boolean;
  NoConnect: boolean;
  Power: boolean;
  OutputPwr: boolean;
  Output: boolean;
  NoOutput: boolean;
  UnConnected: boolean;
  MultipleNetNames: boolean;
  NonCaseDistinctNetNames: boolean;
  UnAssignedRefDes: boolean;
  PowerInputConflict: boolean;
  PowerOutputConflict: boolean;
}

export interface AnnotateOptions {
  matching: string;
  all_sheets: boolean;
  add_references: boolean;
  which_references: number;
  start_value: number;
}

export interface NetlistTypeDefinition {
  name: string;
  wireColor: string | null;
  labelColor: string | null;
  powerColor: string | null;
  wireThickness: number | null;
  attributes: { [key: string]: string };
}

export interface NetlistTypes {
  [name: string]: NetlistTypeDefinition;
}

export interface DsnSettings {
  showRulers: boolean;
}

export interface dsnDrawing {
  sheets: dsnSheet[];

  // Global document settings
  settings: DsnSettings;

  // The DRC dialogue
  drc: DrcOptions /* = {
    DupRef: true, // Duplicated references
    UnConnect: true, // Unconnected items
    NoConnect: true, // Mode than one item on a no-connect net
    Power: true, // Power connected to power
    OutputPwr: true, // Power connected to an output
    Output: true, // Output connected to an output
    NoOutput: true, // No outputs driving inputs
    UnConnected: true, // Unconnected nets
    MultipleNetNames: true, // Multiple net names on same net
    NonCaseDistinctNetNames: true, // Non-case distinct net names (i.e., Vcc and VCC)
    UnAssignedRefDes: true // Unassigned reference designators (i.e., U?)
  };*/;

  // The DRC output
  drcTable: any[];

  // The annotate dialogue
  annotate: AnnotateOptions;

  // Netlist type definitions
  netlistTypes: NetlistTypes;

  // Net -> netlist type assignment
  netTypeAssignments: { [net: string]: string };
}

export const DEFAULT_NETLIST_TYPE_NAME = 'default';

export function createDefaultNetlistType(): NetlistTypeDefinition {
  return {
    name: DEFAULT_NETLIST_TYPE_NAME,
    wireColor: null,
    labelColor: null,
    powerColor: null,
    wireThickness: null,
    attributes: {},
  };
}

export function ensureNetlistTypes(
  types: NetlistTypes | null | undefined,
): NetlistTypes {
  const next: NetlistTypes = { ...(types || {}) };
  if (!next[DEFAULT_NETLIST_TYPE_NAME]) {
    const def = createDefaultNetlistType();
    next[DEFAULT_NETLIST_TYPE_NAME] = def;
  } else {
    next[DEFAULT_NETLIST_TYPE_NAME] = {
      ...next[DEFAULT_NETLIST_TYPE_NAME],
      name: DEFAULT_NETLIST_TYPE_NAME,
      wireColor: null,
      labelColor: null,
      powerColor: null,
      wireThickness: null,
      attributes: {
        ...(next[DEFAULT_NETLIST_TYPE_NAME].attributes || {}),
      },
    };
  }
  return next;
}
