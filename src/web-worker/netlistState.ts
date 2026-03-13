import {
  EProp,
  NetList,
  NetlistData,
  NetlistGenerator,
  NetListNode,
  SymbolRef,
} from '../io/netlists/netlistGenerator';
import { updateSymbol } from '../manipulators/updateSymbol';
import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { makeNetForSheet } from './netlist';

interface SheetSnapshot {
  nets: { [key: string]: NetList };
  eprops: { [key: string]: EProp };
  labels: { [key: string]: string };
  symbols: SymbolRef[];
}

class UnionFind {
  private parent = new Map<string, string>();

  add(key: string) {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
    }
  }

  find(key: string): string {
    this.add(key);
    const p = this.parent.get(key)!;
    if (p === key) {
      return key;
    }
    const root = this.find(p);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) {
      this.parent.set(ra, rb);
    }
  }
}

function buildEmptyEprop(): EProp {
  return {
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

function findMaxHintFromSheet(sheet: dsnSheet): number {
  let maxHint = 0;
  for (let i = 0; i < sheet.items.length; ++i) {
    const item = sheet.items[i];
    if (
      (item.NodeName === DocItemTypes.Symbol ||
        item.NodeName === DocItemTypes.Label ||
        item.NodeName === DocItemTypes.Power) &&
      !!item.hints
    ) {
      maxHint = item.hints
        .map((hint) => Number(hint.net))
        .filter((n) => !isNaN(n))
        .reduce((acc, cur) => Math.max(acc, Number(cur)), maxHint);
    }
  }
  return maxHint;
}

function createSheetSnapshot(sheet: dsnSheet): SheetSnapshot {
  const builder = new NetlistGenerator();
  builder.sheet = sheet.name;
  builder.SetNewNet(findMaxHintFromSheet(sheet));
  makeNetForSheet(sheet, builder);
  builder.complete();

  return {
    nets: builder.nets,
    eprops: builder.eprops,
    labels: builder.labels,
    symbols: builder.symbols,
  };
}

function mergeSheetSnapshots(sheets: SheetSnapshot[]): NetlistData {
  const uf = new UnionFind();
  const labelsToKeys = new Map<string, Set<string>>();
  const flatNets = new Map<string, NetListNode[]>();
  const flatEprops = new Map<string, EProp>();
  const symbols: SymbolRef[] = [];

  for (let index = 0; index < sheets.length; ++index) {
    const snapshot = sheets[index];
    symbols.push(...snapshot.symbols);

    for (const net in snapshot.nets) {
      if (!snapshot.nets.hasOwnProperty(net)) {
        continue;
      }
      const scopedNet = `${index}:${net}`;
      uf.add(scopedNet);
      flatNets.set(scopedNet, snapshot.nets[net]);
      flatEprops.set(scopedNet, snapshot.eprops[net] || buildEmptyEprop());
    }

    for (const label in snapshot.labels) {
      if (!snapshot.labels.hasOwnProperty(label)) {
        continue;
      }
      const scopedNet = `${index}:${snapshot.labels[label]}`;
      uf.add(scopedNet);
      if (!labelsToKeys.has(label)) {
        labelsToKeys.set(label, new Set<string>());
      }
      labelsToKeys.get(label)!.add(scopedNet);
    }
  }

  for (const [, nets] of labelsToKeys) {
    const arr = Array.from(nets);
    for (let i = 1; i < arr.length; ++i) {
      uf.union(arr[0], arr[i]);
    }
  }

  const groupedNets = new Map<string, NetListNode[]>();
  const groupedEprops = new Map<string, EProp>();
  const groupedCandidates = new Map<string, Set<string>>();
  for (const [scopedNet, nodes] of flatNets) {
    const root = uf.find(scopedNet);
    if (!groupedNets.has(root)) {
      groupedNets.set(root, []);
      groupedEprops.set(root, buildEmptyEprop());
      groupedCandidates.set(root, new Set<string>());
    }

    const unscoped = scopedNet.substring(scopedNet.indexOf(':') + 1);
    groupedCandidates.get(root)!.add(unscoped);

    const toNodes = groupedNets.get(root)!;
    for (let i = 0; i < nodes.length; ++i) {
      toNodes.push({ ...nodes[i] });
    }

    const fromEprop = flatEprops.get(scopedNet) || buildEmptyEprop();
    const toEprop = groupedEprops.get(root)!;
    toEprop.inputs += fromEprop.inputs;
    toEprop.outputs += fromEprop.outputs;
    toEprop.tristates += fromEprop.tristates;
    toEprop.open_collectors += fromEprop.open_collectors;
    toEprop.passives += fromEprop.passives;
    toEprop.input_outputs += fromEprop.input_outputs;
    toEprop.not_connecteds += fromEprop.not_connecteds;
    toEprop.powers += fromEprop.powers;
    toEprop.free += fromEprop.free;
    toEprop.unspecified += fromEprop.unspecified;
    toEprop.power_inputs += fromEprop.power_inputs;
    toEprop.power_outputs += fromEprop.power_outputs;
    toEprop.open_emitters += fromEprop.open_emitters;
  }

  const rootKeys = Array.from(groupedNets.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const sortCandidate = (a: string, b: string) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = !isNaN(aNum);
    const bIsNum = !isNaN(bNum);
    if (aIsNum && bIsNum) {
      return aNum - bNum;
    }
    if (aIsNum !== bIsNum) {
      return aIsNum ? -1 : 1;
    }
    return a.localeCompare(b);
  };

  const rootToFinal = new Map<string, string>();
  const usedNetNames = new Set<string>();

  for (let i = 0; i < rootKeys.length; ++i) {
    const root = rootKeys[i];
    const candidates = Array.from(groupedCandidates.get(root) || []).sort(
      sortCandidate,
    );
    const preferred = candidates.find((candidate) => !usedNetNames.has(candidate));
    if (preferred) {
      rootToFinal.set(root, preferred);
      usedNetNames.add(preferred);
    }
  }

  let nextNumeric = 1;
  for (const used of usedNetNames) {
    const usedNum = Number(used);
    if (!isNaN(usedNum) && usedNum >= nextNumeric) {
      nextNumeric = usedNum + 1;
    }
  }

  for (let i = 0; i < rootKeys.length; ++i) {
    const root = rootKeys[i];
    if (rootToFinal.has(root)) {
      continue;
    }

    while (usedNetNames.has(String(nextNumeric))) {
      nextNumeric++;
    }

    const generated = String(nextNumeric);
    rootToFinal.set(root, generated);
    usedNetNames.add(generated);
    nextNumeric++;
  }

  const nets: { [key: string]: NetList } = {};
  const eprops: { [key: string]: EProp } = {};
  for (const root of rootKeys) {
    const finalNet = rootToFinal.get(root)!;
    const nodes = groupedNets.get(root)!;
    for (let i = 0; i < nodes.length; ++i) {
      nodes[i].netlist = finalNet;
    }
    nets[finalNet] = nodes;
    eprops[finalNet] = groupedEprops.get(root)!;
  }

  const labels: { [key: string]: string } = {};
  for (const [label, scoped] of labelsToKeys) {
    const first = Array.from(scoped)[0];
    const root = uf.find(first);
    labels[label] = rootToFinal.get(root)!;
  }

  symbols.sort((ax, bx) => {
    let a = ax[1];
    let b = bx[1];
    let refA = a.text.find((r) => r.description === 'Ref').value;
    const updaterA = new updateSymbol(a);
    const updaterB = new updateSymbol(b);
    if (updaterA.parts() > 1) {
      refA += String.fromCharCode(65 + a.part);
    }
    let refB = b.text.find((r) => r.description === 'Ref').value;
    if (updaterB.parts() > 1) {
      refB += String.fromCharCode(65 + b.part);
    }
    return refA.localeCompare(refB);
  });

  return {
    nets,
    eprops,
    labels,
    nodes: {},
    symbols,
  };
}

export class NetlistWorkerState {
  private sheets = new Map<string, dsnSheet>();
  private snapshots = new Map<string, SheetSnapshot>();
  private netlist: NetlistData = {
    nets: {},
    eprops: {},
    labels: {},
    nodes: {},
    symbols: [],
  };

  init(drawing: dsnDrawing): NetlistData {
    this.sheets.clear();
    this.snapshots.clear();

    for (let i = 0; i < drawing.sheets.length; ++i) {
      const sheet = drawing.sheets[i];
      this.sheets.set(sheet.name, sheet);
      this.snapshots.set(sheet.name, createSheetSnapshot(sheet));
    }

    this.rebuildGlobal();
    return this.netlist;
  }

  update(sheets: dsnSheet[], removedSheets: string[]): NetlistData {
    for (let i = 0; i < removedSheets.length; ++i) {
      const name = removedSheets[i];
      this.sheets.delete(name);
      this.snapshots.delete(name);
    }

    for (let i = 0; i < sheets.length; ++i) {
      const sheet = sheets[i];
      this.sheets.set(sheet.name, sheet);
      this.snapshots.set(sheet.name, createSheetSnapshot(sheet));
    }

    this.rebuildGlobal();
    return this.netlist;
  }

  get(): NetlistData {
    return this.netlist;
  }

  private rebuildGlobal() {
    const snapshots = Array.from(this.sheets.keys())
      .filter((name) => this.snapshots.has(name))
      .map((name) => this.snapshots.get(name)!);

    this.netlist = mergeSheetSnapshots(snapshots);
  }
}
