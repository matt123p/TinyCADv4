//
// This object deals with moving objects that are attached
// to wires.  This can be symbols, other wires and power
// objects.
//

import update from 'immutability-helper';
import { DocItemTypes, DocItem, Coordinate, dsnWire } from '../model/dsnItem';
import { updateAPFactory } from './updateFactory';
import { UtilityLine } from '../util/utilityLine';

export class dragObject {
  public wire_type: DocItemTypes = DocItemTypes.Wire;
  public _wires: [number, number][] = [];
  public _junctions: number[] = [];

  constructor() {}

  private samePoint(a: Coordinate, b: Coordinate) {
    return Math.abs(a[0] - b[0]) < 0.1 && Math.abs(a[1] - b[1]) < 0.1;
  }

  private isSelectedMovingObject(
    moving_objects: (DocItem | number)[],
    item: DocItem,
  ) {
    return (
      moving_objects.indexOf(item) !== -1 || moving_objects.indexOf(item._id) !== -1
    );
  }

  private addTrackedWireHandle(
    wireIndex: number,
    handleIndex: number,
    in_use_indexes: { [key: string]: boolean },
  ) {
    const key = wireIndex + ':' + handleIndex;
    if (!in_use_indexes[key]) {
      this._wires.push([wireIndex, handleIndex]);
      in_use_indexes[key] = true;
    }
  }

  private addTrackedJunction(
    junctionIndex: number,
    in_use_indexes: { [key: string]: boolean },
  ) {
    const key = junctionIndex.toString();
    if (!in_use_indexes[key]) {
      this._junctions.push(junctionIndex);
      in_use_indexes[key] = true;
    }
  }

  private isPointOnWire(item: DocItem, point: Coordinate) {
    if (
      item.NodeName !== DocItemTypes.Wire &&
      item.NodeName !== DocItemTypes.BusWire
    ) {
      return false;
    }

    const wire = item as dsnWire;
    for (let index = 0; index < wire.d_points.length - 1; ++index) {
      const nearest = UtilityLine.nearestPointOnLine(
        point,
        wire.d_points[index],
        wire.d_points[index + 1],
      );
      if (this.samePoint(nearest, point)) {
        return true;
      }
    }

    return false;
  }

  private collectAttachedItemsForWire(
    items: DocItem[],
    movingWire: DocItem,
    moving_objects: (DocItem | number)[],
    in_use_indexes: { [key: string]: boolean },
  ) {
    for (let obj = 0; obj < items.length; ++obj) {
      const item = items[obj];

      if (this.isSelectedMovingObject(moving_objects, item)) {
        continue;
      }

      if (item.NodeName === movingWire.NodeName) {
        const updater_item = updateAPFactory(item);
        const handles = updater_item ? updater_item.handles() : [];
        for (let handleIndex = 0; handleIndex < handles.length; ++handleIndex) {
          if (this.isPointOnWire(movingWire, handles[handleIndex])) {
            this.addTrackedWireHandle(obj, handleIndex, in_use_indexes);
          }
        }
      } else if (
        movingWire.NodeName === DocItemTypes.Wire &&
        item.NodeName === DocItemTypes.Junction
      ) {
        if (this.isPointOnWire(movingWire, item.point)) {
          this.addTrackedJunction(obj, in_use_indexes);
        }
      }
    }
  }

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
        case DocItemTypes.Wire:
        case DocItemTypes.BusWire:
          this.collectAttachedItemsForWire(
            items,
            m,
            moving_objects,
            in_use_indexes,
          );
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
