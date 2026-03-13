/*
 * Connections between nets (the nodes) are at:
 * .. the end of wires
 * .. the point of pins
 * .. the point of power
 * .. the point of labels
 * .. the point of no-connects
 *
 * To generate a netlist:
 * 1. Search design for nodes.
 * - Insert nodes into node tree and either assign net list to node or generate a new net list
 * - If wire joins two different netlists, then join the two netlists together
 * 2. Find Junctions
 * - Find which wires junctions lie on and connect their netlists
 * 3. Find Labels
 * - Find which wire each label lies on and connect their netlists
 * Perform the work of making a netlist from this design...
 */

import { NetlistGenerator, NetListNode } from '../io/netlists/netlistGenerator';
import { updatePower } from '../manipulators/updatePower';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updateWire } from '../manipulators/updateWire';
import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { Coordinate, DocItemTypes } from '../model/dsnItem';

/*
 * Perform the work of making a netlist from a single sheet in this design...
 *
 * @param context -- used to identify the current this.
 * @param netlist_builder -- the object we are building the netlist in to
 */
export function makeNetForSheet(
  sheet: dsnSheet,
  netlist_builder: NetlistGenerator,
) {
  // Here is some temporary data for this function
  let Powers: { [key: string]: any } = {};
  let Connected: { [key: string]: any } = {};

  let netlist = null;

  // Search for nodes, and build the node tree
  for (let i = 0; i < sheet.items.length; ++i) {
    let ObjPtr = sheet.items[i];

    switch (ObjPtr.NodeName) {
      case DocItemTypes.Symbol:
        {
          netlist_builder.addSymbol(ObjPtr);

          let myRefDes = ObjPtr.text.find((a) => a.description === 'Ref').value;
          const update_ap = new updateSymbol(ObjPtr);
          let active_points = update_ap.active_points();
          for (let j = 0; j < active_points.length; ++j) {
            let pointer = active_points[j];
            let pin = pointer[2];

            // Only process pins that are shown here.  Hidden (Power pins) are handled later.
            netlist_builder.Add({
              reference: myRefDes,
              parent: pointer[2],
              pin: pointer[2].number,
              symbol: {
                NodeName: DocItemTypes.Symbol,
                _id: ObjPtr._id,
                point: ObjPtr.point,
                show_power: ObjPtr.show_power,
                part: ObjPtr.part,
                rotation: ObjPtr.rotation,
                text: ObjPtr.text,
              },
              a: [pointer[0], pointer[1]],
              eprop: pin.elec,
              sheet: null,
              netlist: null,
              hints: ObjPtr.hints,
            });
          }

          /// Has this symbol had it's power connected?
          if (!(myRefDes in Connected)) {
            Connected[myRefDes] = true;

            let power_pins = update_ap.power_pins();
            for (let k = 0; k < power_pins.length; ++k) {
              let pointer = power_pins[k];
              let pin = pointer[2];

              // Hidden power pins will get an uninitialized node point.
              // The Add method will never connect to any other uninitialized node point
              // and thus hidden power pins will correctly never connect to anything by their node coordinate.

              // Look up the netlist this power pin belongs to
              netlist = null;
              if (pointer[2].name in Powers) {
                netlist = Powers[pointer[2].name];
              }
              netlist = netlist_builder.Add({
                reference: myRefDes,
                parent: pointer[2],
                label: pin.name,
                pin: pointer[2].number,
                symbol: {
                  NodeName: DocItemTypes.Symbol,
                  _id: ObjPtr._id,
                  point: ObjPtr.point,
                  show_power: ObjPtr.show_power,
                  part: ObjPtr.part,
                  rotation: ObjPtr.rotation,
                  text: ObjPtr.text,
                },
                netlist: netlist,
                eprop: pin.elec,
                a: null,
                sheet: null,
                hints: [],
              });
            }
          }
        }
        break;
      case DocItemTypes.NoConnect:
        netlist_builder.Add({
          parent: ObjPtr,
          a: ObjPtr.point,
          eprop: 6, // No-connect,
          sheet: null,
          netlist: null,
          hints: [],
        });
        break;
      case DocItemTypes.Junction:
        netlist_builder.Add({
          parent: ObjPtr,
          a: ObjPtr.point,
          eprop: null,
          sheet: null,
          netlist: null,
          hints: [],
        });
        break;
      case DocItemTypes.Power:
        const update_power = new updatePower(ObjPtr);
        let n: NetListNode = {
          parent: ObjPtr,
          a: ObjPtr.point,
          label: update_power.get_power_label(),
          eprop: 7, // Power
          netlist: null,
          sheet: null,
          hints: ObjPtr.hints || [],
        };
        if (n.label in Powers) {
          n.netlist = Powers[n.label];
        }
        netlist = netlist_builder.Add(n);
        if (!(n.label in Powers)) {
          Powers[n.label] = netlist;
        }
        break;
      case DocItemTypes.Wire:
        netlist = null;
        for (let k = 0; k < ObjPtr.d_points.length; ++k) {
          let p = ObjPtr.d_points[k];
          netlist = netlist_builder.Add({
            parent: ObjPtr,
            a: p,
            netlist: netlist,
            sheet: null,
            eprop: null,
            hints: [],
          });
        }
        break;
    }
  }

  /// Search for junctions and connect together
  for (let j = 0; j < sheet.items.length; ++j) {
    const item = sheet.items[j];

    /// Search for junctions
    if (item.NodeName === DocItemTypes.Junction) {
      /// Find out which netlist was assigned to this point
      const a = item.point.slice(0);

      /// Look for wires which cross this junction
      for (let k = 0; k < sheet.items.length; ++k) {
        const search = sheet.items[k];

        /// Find the wires
        /// If the wire has an end at this junction then it is already connected
        if (search.NodeName === DocItemTypes.Wire) {
          let perform_add = true;
          for (let l in search.d_points) {
            if (
              search.d_points[l][0] === a[0] &&
              search.d_points[l][1] === a[1]
            ) {
              perform_add = false;
              break;
            }
          }

          if (perform_add) {
            /// Is this point on this wire?
            const update_wire = new updateWire(search);
            const distance_along_a = update_wire.distanceFromPoint(a, a);
            if (distance_along_a.distance <= 1) {
              netlist = netlist_builder.Add({
                parent: search,
                a: search.d_points[0].slice(0),
                netlist: netlist_builder.Find(a),
                sheet: null,
                eprop: null,
                hints: [],
              });
            }
          }
        }
      }
    }
  }

  /// Search for labels and connect to their respective lines
  for (let i = 0; i < sheet.items.length; ++i) {
    let ObjPtr = sheet.items[i];

    /// Search for labels
    if (ObjPtr.NodeName === DocItemTypes.Label) {
      let a = ObjPtr.point;

      /// Search for a wire this label is connect to
      /// Only attempt to connect to a single wire
      for (let j = 0; j < sheet.items.length; ++j) {
        let search = sheet.items[j];

        /// Find the wires
        /// If the wire has an end at this junction then it is already connected
        if (search.NodeName === DocItemTypes.Wire) {
          const update_wire = new updateWire(search);
          let d = update_wire.distanceFromPoint(a, a);
          if (d.distance <= 1) {
            const p: Coordinate = search.d_points[0];
            a = p.slice(0); // Overwrite label point "a" with first point on newly found wire
            break;
          }
        }
      }

      // Insert this label - let netlist_builder handle cross-sheet label linking
      netlist_builder.Add({
        parent: ObjPtr,
        label: ObjPtr.text,
        a: a,
        sheet: null,
        eprop: null,
        netlist: null,
        hints: ObjPtr.hints || [],
      });
    }
  }
}

export function makeNetForDrawing(
  drawing: dsnDrawing,
  netlist_builder: NetlistGenerator,
) {

  // Determine the maximum hint number from the drawing
  let max_hint = 0;
  for (let i = 0; i < drawing.sheets.length; ++i) {
    const sheet = drawing.sheets[i];
    for (let j = 0; j < sheet.items.length; ++j) {
      const item = sheet.items[j];
      if (
        (item.NodeName === DocItemTypes.Symbol ||
          item.NodeName === DocItemTypes.Label ||
          item.NodeName === DocItemTypes.Power) &&
        !!item.hints
      ) {
        max_hint = item.hints
          .map((hint) => Number(hint.net))
          .filter((n) => !isNaN(n))
          .reduce((acc, cur) => Math.max(acc, Number(cur)), max_hint);
      }
    }
  }
  netlist_builder.SetNewNet(max_hint);

  // Generate the netlist
  for (var i = 0; i < drawing.sheets.length; ++i) {
    netlist_builder.sheet = drawing.sheets[i].name;
    makeNetForSheet(drawing.sheets[i], netlist_builder);
  }
  netlist_builder.complete();
}
