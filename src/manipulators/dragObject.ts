//
// This object deals with moving objects that are attached
// to wires.  This can be symbols, other wires and power
// objects.
//

import update from 'immutability-helper';
import { DocItemTypes, DocItem, Coordinate, dsnWire } from '../model/dsnItem';
import { updateAPFactory } from './updateFactory';

export class dragObject {
  public wire_type: DocItemTypes = DocItemTypes.Wire;
  public _wires: [number, number][] = [];
  public _junctions: number[] = [];

  constructor() {}

  move_objects(items: DocItem[], moving_objects: (DocItem | number)[]) {
    // From this list we need to construct a list of wires
    // of interest that are affected by these objects
    this._wires = [];
    this._junctions = [];
    let in_use_indexes: { [key: string]: boolean } = {};
    for (let mobj = 0; mobj < moving_objects.length; ++mobj) {
      let m = moving_objects[mobj];

      // This can be an array of objects or an array of ids
      if (typeof m === 'number') {
        m = items.find((e) => {
          return e._id === m;
        });
      }

      switch (m.NodeName) {
        case DocItemTypes.Symbol:
        case DocItemTypes.Power:
          const updater_m = updateAPFactory(m);
          let aps = updater_m.active_points();

          for (let obj = 0; obj < items.length; ++obj) {
            let o = items[obj];
            if (
              o.NodeName === this.wire_type &&
              moving_objects.indexOf(o) === -1 &&
              moving_objects.indexOf(o._id) === -1
            ) {
              // This is a wire that needs moving...
              const updater_o = updateAPFactory(o);
              let handles = updater_o.handles();
              for (let ap = 0; ap < aps.length; ++ap) {
                let handle = aps[ap];

                for (let h = 0; h < handles.length; ++h) {
                  if (
                    Math.abs(handles[h][0] - handle[0]) < 0.1 &&
                    Math.abs(handles[h][1] - handle[1]) < 0.1
                  ) {
                    // This is a wire of interest
                    if (!in_use_indexes[obj + ':' + h]) {
                      this._wires.push([obj, h]);
                      in_use_indexes[obj + ':' + h] = true;
                    }
                  }
                }
              }
            } else if (
              o.NodeName === DocItemTypes.Junction &&
              this._junctions.indexOf(obj) === -1
            ) {
              for (let ap = 0; ap < aps.length; ++ap) {
                let handle = aps[ap];
                if (
                  Math.abs(o.point[0] - handle[0]) < 0.1 &&
                  Math.abs(o.point[1] - handle[1]) < 0.1
                ) {
                  if (!in_use_indexes[obj]) {
                    this._junctions.push(obj);
                    in_use_indexes[obj] = true;
                  }
                  // This is a junction of interest
                }
              }
            }
          }
          break;
      }
    }
  }

  move_object(items: DocItem[], moving_object: DocItem, handle: Coordinate) {
    // From this list we need to construct a list of wires (and
    // which end) that are affected by these objects
    this._wires = [];
    this._junctions = [];

    for (let obj = 0; obj < items.length; ++obj) {
      let o = items[obj];

      if (o !== moving_object && o.NodeName === this.wire_type) {
        // This is a wire that needs moving...
        const updater_o = updateAPFactory(o);
        let handles = updater_o.handles();
        // Check all handles, not just the first two (bus wires can have more than 2 points)
        for (let h = 0; h < handles.length; ++h) {
          if (
            Math.abs(handles[h][0] - handle[0]) < 0.1 &&
            Math.abs(handles[h][1] - handle[1]) < 0.1
          ) {
            // This is a wire of interest
            this._wires.push([obj, h]);
          }
        }
      } else if (
        o.NodeName === DocItemTypes.Junction &&
        this._junctions.indexOf(obj) === -1
      ) {
        if (
          Math.abs(o.point[0] - handle[0]) < 0.1 &&
          Math.abs(o.point[1] - handle[1]) < 0.1
        ) {
          // This is a junction of interest
          this._junctions.push(obj);
        }
      }
    }
  }

  drag(items: DocItem[], r: Coordinate) {
    // Is there any work to do?
    if (r[0] === 0 && r[1] === 0) {
      return items;
    }

    // move the wires they are connected to
    for (let w = 0; w < this._wires.length; ++w) {
      const iwire = this._wires[w][0];
      const wire = items[iwire];
      const handle = this._wires[w][1];

      if (
        wire.NodeName === DocItemTypes.Wire ||
        wire.NodeName === DocItemTypes.BusWire
      ) {
        const np = [
          wire.d_points[handle][0] - r[0],
          wire.d_points[handle][1] - r[1],
        ];

        const newData = update(wire, {
          d_points: { $splice: [[handle, 1, np]] },
        });

        items = update(items, {
          [iwire]: { $set: newData },
        });
      }
    }

    // move any junctions in the drawing
    for (let j = 0; j < this._junctions.length; ++j) {
      const ijunction = this._junctions[j];
      const junction = items[ijunction];

      if (junction.NodeName === DocItemTypes.Junction) {
        const np = [junction.point[0] - r[0], junction.point[1] - r[1]];

        const newData = update(junction, {
          point: { $set: np },
        });

        items = update(items, {
          [ijunction]: { $set: newData },
        });
      }
    }

    return items;
  }

  drag_handle(items: DocItem[], p: Coordinate) {
    // move the wires they are connected to
    for (let w = 0; w < this._wires.length; ++w) {
      const iwire = this._wires[w][0];
      const wire = items[iwire];
      const handle = this._wires[w][1];

      if (
        wire.NodeName === DocItemTypes.Wire ||
        wire.NodeName === DocItemTypes.BusWire
      ) {
        const np = p.slice();
        if (
          wire.d_points[handle][0] !== np[0] ||
          wire.d_points[handle][1] !== np[1]
        ) {
          const newData = update(wire, {
            d_points: { $splice: [[handle, 1, np]] },
          });

          items = update(items, {
            [iwire]: { $set: newData },
          });
        }
      }
    }

    // move any junctions in the drawing
    for (let j = 0; j < this._junctions.length; ++j) {
      const ijunction = this._junctions[j];
      const junction = items[ijunction];

      if (junction.NodeName === DocItemTypes.Junction) {
        const np = p.slice();
        if (junction.point[0] !== np[0] || junction.point[1] !== np[1]) {
          const newData = update(junction, {
            point: { $set: np },
          });

          items = update(items, {
            [ijunction]: { $set: newData },
          });
        }
      }
    }

    return items;
  }

  is_attached() {
    return this._wires && this._wires.length > 0;
  }

  end() {
    // Complete the drag
  }
}
