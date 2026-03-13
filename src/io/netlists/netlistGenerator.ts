//
// A class for holding a netlist
//

import {
  Coordinate,
  dsnSymbol,
  dsnPin,
  dsnPower,
  dsnWire,
  dsnLabel,
  dsnJunction,
  dsnNoConnect,
  DocItemTypes,
  SymbolTextItem,
  dsnSymbolHint,
} from '../../model/dsnItem';
import { updateSymbol } from '../../manipulators/updateSymbol';

export interface EProp {
  inputs: number;
  outputs: number;
  tristates: number;
  open_collectors: number;
  passives: number;
  input_outputs: number;
  not_connecteds: number;
  powers: number;
  free: number;
  unspecified: number;
  power_inputs: number;
  power_outputs: number;
  open_emitters: number;
}

export interface NetListSymbol {
  NodeName: DocItemTypes.Symbol;
  _id: number;
  show_power: boolean;
  part: number;
  rotation: number;
  text: SymbolTextItem[];
  point: Coordinate;
}

export interface NetListNode {
  a: Coordinate;
  sheet: string;
  eprop: number;
  netlist: string;
  label?: string;
  symbol?: NetListSymbol;
  reference?: string;
  pin?: string;
  parent?: dsnPin | dsnPower | dsnWire | dsnLabel | dsnJunction | dsnNoConnect;
  hints: dsnSymbolHint[];
}

export interface NetlistData {
  nets: { [key: string]: NetList };
  nodes: { [key: string]: string };
  eprops: { [key: string]: EProp };
  labels: { [key: string]: string };
  symbols: SymbolRef[];
}

export type SymbolRef = [string, dsnSymbol];

export type NetList = NetListNode[];

export class NetlistGenerator implements NetlistData {
  public nets: { [key: string]: NetList } = {};
  public nodes: { [key: string]: string } = {};
  public eprops: { [key: string]: EProp } = {};
  public labels: { [key: string]: string } = {};
  public symbols: SymbolRef[] = [];
  public current_netlist = 1;
  public sheet = '';

  constructor() {}

  GetNewNet(ins: NetListNode) {
    const hint = ins.hints.find((h) => h.pin === ins.pin);
    if (hint) {
      return hint.net;
    }
    return '' + this.current_netlist++;
  }

  SetNewNet(netlist: number) {
    this.current_netlist = netlist + 1;
  }

  // Complete the netlist generation and remove any temporary data
  complete() {
    // Sort the symbols in to reference order to make
    // it easy to spot reference problems
    this.symbols.sort((ax, bx) => {
      let a = ax[1];
      let b = bx[1];
      let ref_a = a.text.find((r) => r.description === 'Ref').value;
      const updater_a = new updateSymbol(a);
      const updater_b = new updateSymbol(b);
      if (updater_a.parts() > 1) {
        ref_a += String.fromCharCode(65 + a.part);
      }
      let ref_b = b.text.find((r) => r.description === 'Ref').value;
      if (updater_b.parts() > 1) {
        ref_b += String.fromCharCode(65 + b.part);
      }

      return ref_a.localeCompare(ref_b);
    });

    // This is no longer required
    delete this.nodes;
  }

  Find(a: Coordinate) {
    return this.nodes[a[0] + ',' + a[1]];
  }

  addSymbol(symbol: dsnSymbol) {
    this.symbols.push([this.sheet, symbol]);
  }

  //
  // Add a new node to the array of netlists
  //
  updateNet(netlist: string, ins: NetListNode) {
    ins.sheet = this.sheet;
    if (!this.nets[netlist]) {
      this.nets[netlist] = [];
    }
    this.nets[netlist].push(ins);

    // Keep track of the electrical properties
    if (!this.eprops[netlist]) {
      this.eprops[netlist] = {
        inputs: 0,
        outputs: 0,
        tristates: 0,
        open_collectors: 0,
        passives: 0,
        input_outputs: 0,
        not_connecteds: 0,
        powers: 0,
        free: 0,
        unspecified: 0,
        power_inputs: 0,
        power_outputs: 0,
        open_emitters: 0,
      };
    }
    if (ins.eprop !== null) {
      switch (ins.eprop) {
        case 0: // Input
          this.eprops[netlist].inputs++;
          break;
        case 1: // Output
          this.eprops[netlist].outputs++;
          break;
        case 2: // Tristate
          this.eprops[netlist].tristates++;
          break;
        case 3: // Open Collector
          this.eprops[netlist].open_collectors++;
          break;
        case 4: // Passive
          this.eprops[netlist].passives++;
          break;
        case 5: // Input/Output
          this.eprops[netlist].input_outputs++;
          break;
        case 6: // Not Connected
          this.eprops[netlist].not_connecteds++;
          break;
        case 7: // Power
          this.eprops[netlist].powers++;
          break;
        case 8: // Free
          this.eprops[netlist].free++;
          break;
        case 9: // Unspecified
          this.eprops[netlist].unspecified++;
          break;
        case 10: // Power Input
          this.eprops[netlist].power_inputs++;
          break;
        case 11: // Power Output
          this.eprops[netlist].power_outputs++;
          break;
        case 12: // Open Emitter
          this.eprops[netlist].open_emitters++;
          break;
      }
    }
  }

  //
  // Add a new point to the list of nodes
  //
  updateNode(a: Coordinate, netlist: string) {
    this.nodes[a[0] + ',' + a[1]] = netlist;
  }

  //
  // Join two netlists together
  //
  joinNetlists(FromList: string, ToList: string) {
    // Don't join a netlist to itself
    if (FromList === ToList) {
      return;
    }

    /// Make the new list's net-list index the same as the old netlistlist
    let FromNetList = this.nets[FromList];
    let ToNetList = this.nets[ToList];

    if (!FromNetList) {
      FromNetList = [];
    }
    if (!ToNetList) {
      ToNetList = [];
      this.nets[ToList] = ToNetList;
    }
    if (!this.eprops[ToList]) {
      this.eprops[ToList] = {
        inputs: 0,
        outputs: 0,
        tristates: 0,
        open_collectors: 0,
        passives: 0,
        input_outputs: 0,
        not_connecteds: 0,
        powers: 0,
        free: 0,
        unspecified: 0,
        power_inputs: 0,
        power_outputs: 0,
        open_emitters: 0,
      };
    }

    // Update the "nodes" & "nets" collections
    for (let i = 0; i < FromNetList.length; ++i) {
      FromNetList[i].netlist = ToList;
      if (FromNetList[i].a) {
        this.updateNode(FromNetList[i].a, FromNetList[i].netlist);
      }
      ToNetList.push(FromNetList[i]);
    }

    // Update the counters ("eprops" collection)
    if (this.eprops[FromList]) {
      this.eprops[ToList].inputs += this.eprops[FromList].inputs;
      this.eprops[ToList].outputs += this.eprops[FromList].outputs;
      this.eprops[ToList].tristates += this.eprops[FromList].tristates;
      this.eprops[ToList].open_collectors +=
        this.eprops[FromList].open_collectors;
      this.eprops[ToList].passives += this.eprops[FromList].passives;
      this.eprops[ToList].input_outputs += this.eprops[FromList].input_outputs;
      this.eprops[ToList].not_connecteds +=
        this.eprops[FromList].not_connecteds;
      this.eprops[ToList].powers += this.eprops[FromList].powers;
      this.eprops[ToList].free += this.eprops[FromList].free;
      this.eprops[ToList].unspecified += this.eprops[FromList].unspecified;
      this.eprops[ToList].power_inputs += this.eprops[FromList].power_inputs;
      this.eprops[ToList].power_outputs += this.eprops[FromList].power_outputs;
      this.eprops[ToList].open_emitters += this.eprops[FromList].open_emitters;
    }

    // Update the "labels" collection
    for (let l in this.labels) {
      if (this.labels[l] === FromList) {
        this.labels[l] = ToList;
      }
    }

    // Remove the FromList from the array
    delete this.nets[FromList];
    delete this.eprops[FromList];
  }

  /*
   * Add a node to the netlist and nodes, return value of the netlist.
   *
   */
  Add(ins: NetListNode): string {
    // Deal with labels
    if (ins.label) {
      let label_netlist;
      let lc_label = ins.label;
      if (lc_label in this.labels) {
        label_netlist = this.labels[lc_label];
      } else {
        label_netlist = this.GetNewNet(ins);
        this.labels[lc_label] = label_netlist;
      }

      // Does this insert already have a netlist associated with it?
      if (!ins.netlist) {
        // No, so we can just use this netlist
        ins.netlist = label_netlist;
      } else {
        // Yes, so we must join the netlists together
        this.joinNetlists(label_netlist, ins.netlist);
      }
    }

    /// Is this a node without connection point?
    if (!ins.a) {
      /// Always assign a new net-list index
      if (!ins.label) {
        ins.netlist = this.GetNewNet(ins);
      }
      this.updateNet(ins.netlist, ins);
      return ins.netlist;
    } else if (!ins.netlist) {
      /// Has this node already been assigned a net-list index?
      /// Is this node already in the tree?
      let found = this.Find(ins.a);
      if (found) {
        ins.netlist = found;
      } else {
        /// No, so we can add without checking for prior connections...
        ins.netlist = this.GetNewNet(ins);
        this.updateNode(ins.a, ins.netlist);
      }
      this.updateNet(ins.netlist, ins);
      return ins.netlist;
    } else {
      /// Is this node already in the tree?
      let found = this.Find(ins.a);

      /// If this node was already found, but with a different netlist
      /// number, then first we must join the two netlists together
      if (found && found !== ins.netlist) {
        /// The two nets must be joined
        /// Note: We merge the found (old/existing) netlist INTO the incoming netlist
        /// This matches the C++ behavior where NewList = ins.m_NetList and OldList = found
        let NewList = ins.netlist;
        let OldList = found;
        this.joinNetlists(OldList, NewList);
        // ins.netlist remains unchanged (it's already NewList)
      }

      /// Add this node to the netlist
      this.updateNode(ins.a, ins.netlist);
      this.updateNet(ins.netlist, ins);

      return ins.netlist;
    }
  }
}
