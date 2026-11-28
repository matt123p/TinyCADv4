import { powerMarkerElectricalType } from '../io/netlists/netlistGenerator';
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
import { Coordinate, DocItemTypes, dsnSymbolHint, dsnWire } from '../model/dsnItem';
import {
  dsnSheet,
  dsnDrawing,
  DrcError,
  DrcOptions,
  AnnotateOptions,
  NetlistTypes,
  ensureNetlistTypes,
  DEFAULT_NETLIST_TYPE_NAME,
} from '../model/dsnDrawing';
import { updateView } from './updateView';
import { dsnView, FindResult } from '../model/dsnView';
import { updateSymbol } from './updateSymbol';
import { dsnBomEntry } from '../model/dsnBomEntry';
import { readControl } from '../simulation/controls';

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
    const findTable = panel === Panels.DrcPanel ? drawing.drcTable : [];

    for (let i = 0; i < findTable.length; ++i) {
      const search_marker = findTable[i];
      if (search_marker.source?.fileId || search_marker.sheet !== drawing.sheets[selected_sheet]?.name) continue;
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
    const pending = [{ drawing, prefix: '' }];
    for (const context of pending) {
      for (const sheet of context.drawing.sheets) {
        if (sheet.hierarchicalSymbol) continue;
        bom = update_sheet.makeBomForSheet(sheet, bom, context.prefix);
        for (const item of sheet.items) {
          if (item.NodeName !== DocItemTypes.Symbol || !item._hierarchicalDrawing) continue;
          const ref = item.text.find((field) => field.description === 'Ref')?.value;
          pending.push({
            drawing: item._hierarchicalDrawing,
            prefix: context.prefix + (ref || `H${pending.length}`) + '_',
          });
        }
      }
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
    netlist: NetlistData | null,
    netlistTypes: NetlistTypes,
    netTypeAssignments: { [net: string]: string },
  ) {
    const resolvedTypes = ensureNetlistTypes(netlistTypes);
    const resolvedAssignments: { [net: string]: string } = {
      ...(netTypeAssignments || {}),
    };
    const updatedDrawing = {
      ...drawing,
      netlistTypes: resolvedTypes,
      netTypeAssignments: resolvedAssignments,
    };
    return netlist
      ? this.stampWireNetTypes(updatedDrawing, netlist, resolvedTypes, resolvedAssignments)
      : updatedDrawing;
  }

  /**
   * Stamp each wire in the drawing with the net_type name of its net.
   * Priority: explicit non-default assignment > non-default wire type already present
   * > default / none.  Does NOT increment drawingVersion.
   */
  stampWireNetTypes(
    drawing: dsnDrawing,
    netlist: NetlistData,
    netlistTypes: NetlistTypes,
    netTypeAssignments: { [net: string]: string },
  ): dsnDrawing {
    const DEFAULT = DEFAULT_NETLIST_TYPE_NAME;

    // Build map of wire _id → winning net_type
    const wireNetTypeMap = new Map<number, string | undefined>();

    for (const netName in netlist.nets) {
      if (!Object.prototype.hasOwnProperty.call(netlist.nets, netName)) continue;
      const nodes = netlist.nets[netName];

      // Collect wires in this net
      const wireIds: number[] = [];
      const existingNonDefaultTypes = new Set<string>();

      for (const node of nodes) {
        if (node.parent?.NodeName === DocItemTypes.Wire) {
          const wire = node.parent as dsnWire;
          wireIds.push(wire._id);
          if (wire.net_type && wire.net_type !== DEFAULT) {
            existingNonDefaultTypes.add(wire.net_type);
          }
        }
      }

      if (wireIds.length === 0) continue;

      // Determine winning type name
      let winningType: string | undefined;
      const explicit = netTypeAssignments?.[netName];
      if (explicit && explicit !== DEFAULT && netlistTypes[explicit]) {
        // Explicit non-default user assignment wins
        winningType = explicit;
      } else if (explicit === DEFAULT) {
        // Explicit reset to default — clears even if wires carry a stale type
        winningType = undefined;
      } else if (existingNonDefaultTypes.size > 0) {
        // No explicit assignment: infer from wires, but only types that still exist
        const validNonDefault = Array.from(existingNonDefaultTypes)
          .filter((t) => !!netlistTypes[t])
          .sort();
        winningType = validNonDefault.length > 0 ? validNonDefault[0] : undefined;
      }
      // else: no type → winningType stays undefined

      for (const id of wireIds) {
        wireNetTypeMap.set(id, winningType);
      }
    }

    // Apply the map, creating new arrays only when something actually changed
    let newSheets = drawing.sheets;
    for (let si = 0; si < drawing.sheets.length; ++si) {
      const sheet = drawing.sheets[si];
      let newItems = sheet.items;
      for (let ii = 0; ii < sheet.items.length; ++ii) {
        const item = sheet.items[ii];
        if (item.NodeName === DocItemTypes.Wire) {
          const wire = item as dsnWire;
          const targetType = wireNetTypeMap.get(wire._id);
          if (wire.net_type !== targetType) {
            if (newItems === sheet.items) {
              newItems = sheet.items.slice();
            }
            newItems[ii] = { ...wire, net_type: targetType };
          }
        }
      }
      if (newItems !== sheet.items) {
        if (newSheets === drawing.sheets) {
          newSheets = drawing.sheets.slice();
        }
        newSheets[si] = { ...sheet, items: newItems };
      }
    }

    if (newSheets === drawing.sheets) {
      return drawing; // nothing changed
    }
    return { ...drawing, sheets: newSheets };
  }

  private addDrcNetError(
    errors: DrcError[],
    message: string,
    net: NetListNode[],
    pinTypes?: number[],
  ) {
    const reported = new Set<number>();
    for (const node of net) {
      if (node.hierarchicalPort || (pinTypes && !pinTypes.includes(node.eprop))) continue;
      if (!node.symbol && (node.eprop === null || !node.parent)) continue;
      const instance = node.drcSource?.instance ?? 0;
      if (reported.has(instance)) continue;
      reported.add(instance);
      errors.push({
        symbol: node.reference ?? node.label,
        pin: node.pin,
        text: message,
        a: [...(node.a ?? node.symbol.point)],
        id: node.symbol?._id ?? node.parent._id,
        sheet: node.drcSource?.sheet ?? node.sheet,
        source: node.drcSource,
      });
    }
  }

  designRulesCheck(_drawing: dsnDrawing, drcOptions: DrcOptions, netlist: NetlistData) {
    const hierarchy = netlist.drcHierarchy;
    const errors: DrcError[] = [...(hierarchy?.errors ?? [])];
    if (drcOptions.UnConnected) errors.push(...(hierarchy?.unmatchedPorts ?? []));

    const references = new Set<string>();
    const packages = new Map<string, { parts: number; seen: Set<number>; location: Omit<DrcError, 'text'> }>();
    const placements = new Set(hierarchy?.placements);
    for (const entry of [...netlist.symbols, ...placements]) {
      const [sheet, symbol, source] = entry;
      const ref = symbol.text.find((field) => field.description === 'Ref')?.value ?? '';
      const parts = new updateSymbol(symbol).parts();
      const designator = parts > 1 ? ref + String.fromCharCode(65 + symbol.part) : ref;
      const location = {
        symbol: designator || 'Unnamed symbol', pin: '', a: [...symbol.point],
        id: symbol._id, sheet: source?.sheet ?? sheet, source,
      };
      if (drcOptions.MissingSpice && !placements.has(entry) &&
          !symbol.text.find((field) => field.description === '$$SPICE')?.value?.trim()) {
        errors.push({ ...location, text: 'No SPICE information' });
      }
      if (!ref || designator.includes('?')) {
        if (drcOptions.UnAssignedRefDes)
          errors.push({ ...location, text: 'Unassigned reference designators (i.e., U?)' });
        continue;
      }

      const key = designator.toLowerCase();
      if (drcOptions.DupRef && references.has(key))
        errors.push({ ...location, text: 'Duplicated references: ' + designator });
      references.add(key);

      if (drcOptions.UnConnect && parts > 1) {
        const packageKey = JSON.stringify([source?.instance ?? 0, ref.toLowerCase()]);
        if (!packages.has(packageKey))
          packages.set(packageKey, { parts, seen: new Set(), location: { ...location, symbol: ref } });
        packages.get(packageKey)!.seen.add(symbol.part);
      }
    }
    for (const { parts, seen, location } of packages.values()) {
      if (seen.size < parts)
        errors.push({ ...location, text: 'Not all parts in package are in use: ' + location.symbol });
    }

    const instrumentSymbols = new Set(netlist.symbols
      .filter(([, symbol]) => readControl(symbol)?.kind === 'instrument')
      .map(([sheet, symbol]) => `${sheet}:${symbol._id}`));

    // Now check each net for problems
    for (let net in netlist.nets) {
      if (netlist.nets.hasOwnProperty(net)) {
        const nodes = netlist.nets[net];
        const eprop = netlist.eprops[net];
        const rails = drcOptions.Power && eprop.powers > 1
          ? nodes.filter(({ eprop }) => eprop === powerMarkerElectricalType)
          : [];
        const conflictingRail = rails.find(({ label }) => label !== rails[0].label);

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

        if (drcOptions.NoConnect && eprop.not_connecteds > 0 && total > 2) {
          this.addDrcNetError(
            errors,
            'More than one item on a no-connect net',
            netlist.nets[net],
          );
        } else if (conflictingRail) {
          this.addDrcNetError(
            errors,
            'Power connected to power',
            [conflictingRail],
          );
        } else if (
          drcOptions.PowerOutputConflict &&
          eprop.power_outputs > 1
        ) {
          this.addDrcNetError(
            errors,
            'Multiple power outputs on same net',
            netlist.nets[net],
            [10],
          );
        } else if (
          drcOptions.PowerInputConflict &&
          eprop.power_inputs > 1 &&
          eprop.power_outputs === 0 &&
          eprop.outputs === 0 &&
          eprop.passives === 0
        ) {
          this.addDrcNetError(
            errors,
            'Multiple power inputs with no driver',
            netlist.nets[net],
            [9],
          );
        } else if (
          drcOptions.OutputPwr &&
          eprop.outputs > 0 &&
          (eprop.powers > 0 || eprop.power_inputs > 0 || eprop.power_outputs > 0)
        ) {
          this.addDrcNetError(
            errors,
            'Power connected to an output',
            netlist.nets[net],
            [powerMarkerElectricalType, 9, 1, 10],
          );
        } else if (drcOptions.Output && eprop.outputs > 1) {
          this.addDrcNetError(
            errors,
            'Output connected to an output',
            netlist.nets[net],
            [1],
          );
        } else if (
          drcOptions.NoOutput &&
          eprop.outputs === 0 &&
          eprop.passives === 0 &&
          eprop.power_outputs === 0 &&
          eprop.free === 0 &&
          eprop.inputs > 0 &&
          eprop.not_connecteds === 0
        ) {
          this.addDrcNetError(
            errors,
            'No outputs driving inputs',
            netlist.nets[net],
            [0],
          );
        } else if (
          drcOptions.UnConnected &&
          total === 1 &&
          eprop.not_connecteds === 0 &&
          !netlist.nets[net].every(node => node.symbol &&
            instrumentSymbols.has(`${node.sheet}:${node.symbol._id}`))
        ) {
          this.addDrcNetError(errors, 'Unconnected nets', netlist.nets[net]);
        }

        // Port labels are local names for the same connection in different instances.
        const localLabels = new Map<number, Map<string, NetListNode>>();
        for (const node of netlist.nets[net]) {
          if (!node.label) continue;
          const instance = node.drcSource?.instance ?? 0;
          if (!localLabels.has(instance)) localLabels.set(instance, new Map());
          localLabels.get(instance)!.set(node.label, node);
        }
        for (const labels of localLabels.values()) {
          if (labels.size < 2) continue;
          const caseDistinct = new Set([...labels.keys()].map((label) => label.toLowerCase())).size > 1;
          const message = !caseDistinct && drcOptions.NonCaseDistinctNetNames
            ? 'Non-case distinct net names (i.e., Vcc and VCC)'
            : caseDistinct && drcOptions.MultipleNetNames ? 'Multiple names on same net' : null;
          if (!message) continue;
          for (const [label, node] of labels) {
            errors.push({
              symbol: label, pin: '', text: message, a: [...(node.a ?? node.symbol.point)],
              id: node.symbol?._id ?? node.parent?._id ?? 0,
              sheet: node.drcSource?.sheet ?? node.sheet, source: node.drcSource,
            });
          }
        }
      }
    }

    return errors;
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
