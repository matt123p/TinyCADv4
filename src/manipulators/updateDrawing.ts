//
// This object deals with collections of drawing
// objects, which it collects together as a single
// drawing.
//
import {
  NetlistData,
  NetlistGenerator,
  NetListNode,
} from '../io/netlists/netlistGenerator';
import update from 'immutability-helper';
import { IsInsideResult } from './updateInterfaces';
import { Panels } from '../state/dispatcher/AppDispatcher';
import { Coordinate, DocItemTypes, dsnSymbolHint } from '../model/dsnItem';
import {
  dsnSheet,
  dsnDrawing,
  DrcError,
  DrcOptions,
  AnnotateOptions,
  NetlistTypes,
  ensureNetlistTypes,
} from '../model/dsnDrawing';
import { updateView } from './updateView';
import { dsnView, FindResult } from '../model/dsnView';
import { updateSymbol } from './updateSymbol';
import { dsnBomEntry } from '../model/dsnBomEntry';

// Constructor
export class updateDrawing {
  constructor() {}

  // Is the user pointing inside a search marker?
  is_inside(
    view: dsnView,
    drawing: dsnDrawing,
    panel: Panels,
    selected_sheet: number,
    tp: Coordinate,
    editingLibrary: boolean,
    heterogeneous: boolean,
  ): IsInsideResult {
    let findTable = [];
    if (panel === Panels.DrcPanel) {
      findTable = drawing.drcTable;
    }

    for (let i = 0; i < findTable.length; ++i) {
      const search_marker = findTable[i];
      const dx = search_marker.a[0] - tp[0];
      const dy = search_marker.a[1] - tp[1];
      if (dx * dx + dy * dy < 25) {
        return {
          item: null,
          handle: 0,
          distance: 0,
          search_marker: search_marker,
        };
      }
    }

    // Pass this on to the selected sheet
    const update_sheet = new updateView();
    return update_sheet.is_inside(
      view,
      drawing.sheets[selected_sheet],
      tp,
      editingLibrary && !heterogeneous ? selected_sheet : 0,
      editingLibrary && selected_sheet === 0,
      editingLibrary,
      heterogeneous,
    );
  }

  makeBomForDrawing(drawing: dsnDrawing): dsnBomEntry[] {
    // Generate the netlist
    let bom: dsnBomEntry[] = [];
    const update_sheet = new updateView();
    for (var i = 0; i < drawing.sheets.length; ++i) {
      bom = update_sheet.makeBomForSheet(drawing.sheets[i], bom);
    }
    bom.sort((a, b) => a.Name.localeCompare(b.Name));

    return bom;
  }

  updateNetlistHints(drawing: dsnDrawing, netlist: NetlistData) {
    // Determine the start indexes for all the different reference types
    for (let i = 0; i < drawing.sheets.length; ++i) {
      let sheet = drawing.sheets[i];
      for (let j = 0; j < sheet.items.length; ++j) {
        let s = sheet.items[j];
        if (s.NodeName === DocItemTypes.Symbol) {
          let hints: dsnSymbolHint[] = [];

          // Is there a netlist entry for this symbol?
          for (const nl in netlist.nets) {
            if (!isNaN(Number(nl))) {
              const nets = netlist.nets[nl];
              for (const net of nets) {
                if (net.symbol?._id === s._id) {
                  if (net.parent.NodeName === DocItemTypes.Pin) {
                    hints.push({
                      pin: net.parent.number,
                      net: nl,
                    });
                  }
                }
              }
            }
          }
          drawing = update(drawing, {
            sheets: {
              [i]: {
                items: {
                  [j]: {
                    hints: { $set: hints },
                  },
                },
              },
            },
          });
        } else if (
          s.NodeName === DocItemTypes.Label ||
          s.NodeName === DocItemTypes.Power
        ) {
          let hints: dsnSymbolHint[] = [];
          for (const nl in netlist.nets) {
            if (!netlist.nets.hasOwnProperty(nl)) {
              continue;
            }
            const nets = netlist.nets[nl];
            for (const net of nets) {
              if (net.parent?._id === s._id) {
                hints.push({
                  pin: '',
                  net: nl,
                });
              }
            }
          }

          drawing = update(drawing, {
            sheets: {
              [i]: {
                items: {
                  [j]: {
                    hints: { $set: hints },
                  },
                },
              },
            },
          });
        }
      }
    }
    return drawing;
  }

  updateNetlistTypes(
    drawing: dsnDrawing,
    netlist: NetlistData,
    netlistTypes: NetlistTypes,
    netTypeAssignments: { [net: string]: string },
  ) {
    const resolvedTypes = ensureNetlistTypes(netlistTypes);
    const resolvedAssignments: { [net: string]: string } = {
      ...(netTypeAssignments || {}),
    };
    return {
      ...drawing,
      netlistTypes: resolvedTypes,
      netTypeAssignments: resolvedAssignments,
    };
  }

  _addDrcError(
    drawing: dsnDrawing,
    r: DrcError[],
    name: string,
    net: NetListNode[],
  ) {
    for (let i = 0; i < net.length; ++i) {
      let n = net[i];
      if (n.reference && n.symbol) {
        let a = n.a;
        if (!a) {
          a = n.symbol.point;
        }
        r.push({
          symbol: n.reference,
          pin: n.pin,
          text: name,
          a: a.slice(),
          id: n.symbol._id,
          sheet: n.sheet,
        });
        break;
      }
    }
  }

  designRulesCheck(
    drawing: dsnDrawing,
    drc_options: DrcOptions,
    netlist: NetlistData,
  ) {
    let r: DrcError[] = [];

    let b = null;
    let last_ref = '';
    let ref_count = 1;
    let last_index = netlist.symbols.length - 1;
    for (let i = 0; i < netlist.symbols.length; i++) {
      let ax = netlist.symbols[i];
      let a = ax[1];
      let ref_a = a.text.find((t) => t.description === 'Ref')?.value;
      let ref_ra = ref_a;
      const update_symbol_a = new updateSymbol(a);
      if (update_symbol_a.parts() > 1) {
        ref_a = ref_a + String.fromCharCode(65 + a.part);
      }
      if (ref_a.indexOf('?') !== -1) {
        if (drc_options.UnAssignedRefDes) {
          r.push({
            symbol: ref_a,
            pin: '',
            text: 'Unassigned reference designators (i.e., U?)',
            a: a.point.slice(),
            id: a._id,
            sheet: ax[0],
          });
        }
      } else if (drc_options.DupRef && b) {
        let ref_b = b.text.find((t) => t.description === 'Ref').value;
        const update_symbol_b = new updateSymbol(b);
        if (update_symbol_b.parts() > 1) {
          ref_b += String.fromCharCode(65 + b.part);
        }

        if (ref_a.toLowerCase() === ref_b.toLowerCase()) {
          r.push({
            symbol: ref_a,
            pin: '',
            text: 'Duplicated references: ' + ref_a,
            a: a.point.slice(),
            id: a._id,
            sheet: ax[0],
          });
        }
      }

      if (drc_options.UnConnect && b) {
        let ref_b = b.text.find((t) => t.description === 'Ref').value;
        if (ref_ra === ref_b) {
          ++ref_count;
        }
        if (ref_ra !== ref_b || i === last_index) {
          if (update_symbol_a.parts() > 1) {
            if (ref_count !== update_symbol_a.parts()) {
              r.push({
                symbol: ref_ra,
                pin: '',
                text: 'Not all parts in package are in use: ' + ref_ra,
                a: a.point.slice(),
                id: a._id,
                sheet: ax[0],
              });
            }
          }
          ref_count = 1;
        }
      }

      b = a;
    }

    // Now check each net for problems
    for (let net in netlist.nets) {
      if (netlist.nets.hasOwnProperty(net)) {
        let eprop = netlist.eprops[net];

        let total =
          eprop.input_outputs +
          eprop.inputs +
          eprop.not_connecteds +
          eprop.open_collectors +
          eprop.outputs +
          eprop.passives +
          eprop.powers +
          eprop.tristates +
          eprop.free +
          eprop.unspecified +
          eprop.power_inputs +
          eprop.power_outputs +
          eprop.open_emitters;

        if (drc_options.NoConnect && eprop.not_connecteds > 0 && total > 2) {
          this._addDrcError(
            drawing,
            r,
            'Mode than one item on a no-connect net',
            netlist.nets[net],
          );
        } else if (drc_options.Power && eprop.powers > 1) {
          this._addDrcError(
            drawing,
            r,
            'Power connected to power',
            netlist.nets[net],
          );
        } else if (
          drc_options.PowerOutputConflict &&
          eprop.power_outputs > 1
        ) {
          this._addDrcError(
            drawing,
            r,
            'Multiple power outputs on same net',
            netlist.nets[net],
          );
        } else if (
          drc_options.PowerInputConflict &&
          eprop.power_inputs > 1 &&
          eprop.power_outputs === 0 &&
          eprop.outputs === 0 &&
          eprop.passives === 0
        ) {
          this._addDrcError(
            drawing,
            r,
            'Multiple power inputs with no driver',
            netlist.nets[net],
          );
        } else if (
          drc_options.OutputPwr &&
          (eprop.powers > 0 || eprop.power_inputs > 0) &&
          (eprop.outputs > 0 || eprop.power_outputs > 0)
        ) {
          this._addDrcError(
            drawing,
            r,
            'Power connected to an output',
            netlist.nets[net],
          );
        } else if (drc_options.Output && eprop.outputs > 1) {
          this._addDrcError(
            drawing,
            r,
            'Output connected to an output',
            netlist.nets[net],
          );
        } else if (
          drc_options.NoOutput &&
          eprop.outputs === 0 &&
          eprop.passives === 0 &&
          eprop.power_outputs === 0 &&
          eprop.free === 0 &&
          eprop.inputs > 0 &&
          eprop.not_connecteds === 0
        ) {
          this._addDrcError(
            drawing,
            r,
            'No outputs driving inputs',
            netlist.nets[net],
          );
        } else if (
          drc_options.UnConnected &&
          total === 1 &&
          eprop.not_connecteds === 0
        ) {
          this._addDrcError(drawing, r, 'Unconnected nets', netlist.nets[net]);
        }

        let labels: { [key: string]: NetListNode } = {};
        let lc_labels: { [key: string]: NetListNode } = {};
        for (let i in netlist.nets[net]) {
          if (netlist.nets[net].hasOwnProperty(i)) {
            let n = netlist.nets[net][i];
            if (n.label) {
              labels[n.label] = n;
              lc_labels[n.label.toLowerCase()] = n;
            }
          }
        }

        if (
          drc_options.NonCaseDistinctNetNames &&
          Object.keys(labels).length > 1 &&
          Object.keys(lc_labels).length === 1
        ) {
          for (let l in labels) {
            if (labels.hasOwnProperty(l)) {
              let label = labels[l];
              let a = [0, 0];
              if (label.parent && label.parent.NodeName !== DocItemTypes.Wire) {
                a = label.parent.point;
              }
              r.push({
                symbol: l,
                pin: '',
                text: 'Non-case distinct net names (i.e., Vcc and VCC)',
                a: a,
                id: label.parent ? label.parent._id : 0,
                sheet: label.sheet,
              });
            }
          }
        } else if (
          drc_options.MultipleNetNames &&
          Object.keys(lc_labels).length > 1
        ) {
          for (let l in labels) {
            if (labels.hasOwnProperty(l)) {
              let label = labels[l];
              let a = [0, 0];
              if (label.parent && label.parent.NodeName !== DocItemTypes.Wire) {
                a = label.parent.point;
              }
              r.push({
                symbol: l,
                pin: '',
                text: 'Multiple names on same net',
                a: a,
                id: label.parent ? label.parent._id : 0,
                sheet: label.sheet,
              });
            }
          }
        }
      }
    }

    return r;
  }

  //
  // Generate netlists
  //
  global_annotate(
    drawing: dsnDrawing,
    options: AnnotateOptions,
    selected_sheet: number,
  ): dsnDrawing {
    /*
        add_references: true, // Action: Add References/Remove references
        which_references: 0, // 0 = All, 1 = Un-numbered, 2 = matching
        matching: "U?", // Wildcard to match
        all_sheets: true, // All sheets?
        start_value: 0 // 0 = Default, otherwise the starting value
    */
    let match = options.matching.replace('?', '').toLowerCase();
    let sheets = drawing.sheets.slice();
    let indexes: { [key: string]: { number: number; part: number } } = {};

    // Determine the start indexes for all the different reference types
    for (let i = 0; i < drawing.sheets.length; ++i) {
      if (options.all_sheets || i === selected_sheet) {
        let sheet = drawing.sheets[i];
        for (let j = 0; j < sheet.items.length; ++j) {
          let s = sheet.items[j];
          if (s.NodeName === DocItemTypes.Symbol) {
            // What do we do with this symbol?
            let ref = s.text.find((r) => r.description === 'Ref');
            let base = ref.value.replace(/\d/g, '');
            base = base.replace('?', '');
            let n = ref.value.replace(/\D/g, '');
            let number = Math.max(1, options.start_value);
            let part = 0;
            // Only do this for default values for unnumbered references
            if (options.which_references === 1 && options.start_value === 0) {
              if (n.length > 0) {
                number = parseInt(n, 10);
                part = s.part + 1;
                const update_symbol_s = new updateSymbol(s);
                if (part >= update_symbol_s.parts()) {
                  ++number;
                  part = 0;
                }
              } else {
                number = 1;
                part = 0;
              }
            }
            if (
              !indexes[base.toLowerCase()] ||
              indexes[base.toLowerCase()].number < number
            ) {
              indexes[base.toLowerCase()] = { number: number, part: part };
            } else if (indexes[base.toLowerCase()].number === number) {
              indexes[base.toLowerCase()].part = Math.max(
                indexes[base.toLowerCase()].part,
                part,
              );
            }
          }
        }
      }
    }

    // Now re-number the symbols on this sheet
    for (let i = 0; i < drawing.sheets.length; ++i) {
      if (options.all_sheets || i === selected_sheet) {
        let sheet = drawing.sheets[i];
        let items = sheet.items.slice();
        for (let j = 0; j < sheet.items.length; ++j) {
          let s = sheet.items[j];
          if (s.NodeName === DocItemTypes.Symbol) {
            // What do we do with this symbol?
            let ref_index = s.text.findIndex((r) => r.description === 'Ref');
            let ref = s.text[ref_index];
            let matching = false;
            switch (options.which_references) {
              case 0: // All
                matching = true;
                break;
              case 1: // Un-numbered
                matching = ref.value.indexOf('?') !== -1;
                break;
              case 2: // Matching
                matching = ref.value.toLowerCase().indexOf(match) === 0;
                break;
            }
            let value = ref.value;
            let part = s.part;
            if (options.add_references) {
              let base = ref.value.replace(/\d/g, '');
              base = base.replace('?', '');
              value = base + indexes[base.toLowerCase()].number;
              part = indexes[base.toLowerCase()].part;

              ++indexes[base.toLowerCase()].part;
              const update_symbol_s = new updateSymbol(s);
              if (indexes[base.toLowerCase()].part >= update_symbol_s.parts()) {
                ++indexes[base.toLowerCase()].number;
                indexes[base.toLowerCase()].part = 0;
              }
            } else {
              // Remove the reference
              value = ref.value.replace(/\d+/g, '?');
            }
            if (value !== ref.value || part !== s.part) {
              const symbol = update(s, {
                text: {
                  [ref_index]: {
                    value: { $set: value },
                  },
                },
                part: { $set: part },
              });
              const updater = new updateSymbol(symbol);
              items[j] = updater.post_construction();
            }
          }
        }

        sheets[i] = update(sheets[i], { items: { $set: items } });
      }
    }

    return update(drawing, {
      annotate: { $set: options },
      sheets: { $set: sheets },
    });
  }
}
