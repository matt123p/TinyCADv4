import {
  EProp,
  NetList,
  NetlistData,
  NetlistGenerator,
  NetListNode,
  SymbolRef,
} from '../io/netlists/netlistGenerator';
import { updateSymbol } from '../manipulators/updateSymbol';
import { DrcSource, dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { DocItemTypes } from '../model/dsnItem';
import { makeNetForSheet } from './netlist';

interface SheetSnapshot {
  nets: { [key: string]: NetList };
  eprops: { [key: string]: EProp };
  labels: { [key: string]: string };
  symbols: SymbolRef[];
}

interface HierarchyContext {
  index: number;
  prefix: string;
  path: string[];
  fileId?: string;
  sheets: dsnSheet[];
  children: Map<number, HierarchyContext>;
  modelPacks?: dsnDrawing['spiceModelPacks'];
}

function hierarchyContexts(sheets: dsnSheet[]): HierarchyContext[] {
  const contexts: HierarchyContext[] = [
    { index: 0, prefix: '', path: [], sheets, children: new Map() },
  ];
  // Breadth-first numbering follows v3. Reused drawings share data, not context.
  for (const context of contexts) {
    for (const sheet of context.sheets) {
      if (sheet.hierarchicalSymbol) continue;
      for (const item of sheet.items) {
        if (item.NodeName !== DocItemTypes.Symbol || !item._hierarchicalDrawing) continue;
        const ref = item.text.find((field) => field.description === 'Ref')?.value || `H${contexts.length}`;
        const child = {
          index: contexts.length,
          prefix: context.prefix + ref + '_',
          path: [...context.path, ref],
          fileId: item._hierarchicalTarget,
          sheets: item._hierarchicalDrawing.sheets,
          children: new Map<number, HierarchyContext>(),
          modelPacks: item._hierarchicalDrawing.spiceModelPacks,
        };
        context.children.set(item._id, child);
        contexts.push(child);
      }
    }
  }
  return contexts;
}

function scopedLabel(index: number, label: string) {
  return JSON.stringify([index, label]);
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

type ScopedSnapshot = { context: HierarchyContext; sheet: dsnSheet; snapshot: SheetSnapshot };

function mergeSheetSnapshots(sheets: ScopedSnapshot[]): NetlistData {
  const uf = new UnionFind();
  const labelsToKeys = new Map<string, Set<string>>();
  const exportedLabels = new Map<string, string>();
  const flatNets = new Map<string, NetListNode[]>();
  const flatEprops = new Map<string, EProp>();
  const symbols: SymbolRef[] = [];
  const drcHierarchy: NetlistData['drcHierarchy'] = { errors: [], unmatchedPorts: [], placements: [] };
  const childLabels = new Set(sheets.flatMap(({ context, snapshot }) =>
    context.index ? Object.keys(snapshot.labels).map((label) => scopedLabel(context.index, label)) : [],
  ));
  const symbolIds = new Map<string, number>();
  const localId = (context: HierarchyContext, id: number) => {
    if (!context.index) return id;
    const key = `${context.index}:${id}`;
    if (!symbolIds.has(key)) symbolIds.set(key, -1 - symbolIds.size);
    return symbolIds.get(key)!;
  };
  const addLabel = (label: string, net: string) => {
    if (!labelsToKeys.has(label)) labelsToKeys.set(label, new Set());
    labelsToKeys.get(label)!.add(net);
  };

  for (let index = 0; index < sheets.length; ++index) {
    const { snapshot, context, sheet } = sheets[index];
    const source: DrcSource = { fileId: context.fileId, sheet: sheet.name,
      instance: context.index, instancePath: context.path };
    const drcSource = context.index ? source : undefined;
    const scopeFields = <T extends { _id: number; text: SymbolRef[1]['text'] }>(symbol: T): T => ({
      ...symbol,
      _id: localId(context, symbol._id),
      _hierarchicalReference: {
        local: symbol.text.find((field) => field.description === 'Ref')?.value || '',
        parents: context.path,
      },
      text: symbol.text.map((field) => field.description === 'Ref'
        ? { ...field, value: context.prefix + field.value }
        : field),
    });
    if (context.index) {
      for (const [sheet, symbol] of snapshot.symbols)
        symbols.push([context.prefix + sheet, scopeFields(symbol), source]);
    } else {
      symbols.push(...snapshot.symbols);
    }
    const ports = new Map<number, SymbolRef[1]>();
    for (const item of sheet.items) {
      if (item.NodeName !== DocItemTypes.Symbol || item.hierarchicalFile === undefined) continue;
      const { _hierarchicalDrawing, ...link } = item;
      const placement = context.index ? scopeFields(link) : link;
      ports.set(item._id, placement);
      drcHierarchy.placements.push([sheet.name, placement, source]);
      if (!_hierarchicalDrawing) drcHierarchy.errors.push({
        symbol: placement.text.find((field) => field.description === 'Ref')?.value,
        id: placement._id, a: item.point, sheet: sheet.name, source,
        text: `${item.hierarchicalFile}: ${item._hierarchicalError ?? 'Linked schematic unavailable'}`,
      });
    }

    for (const net in snapshot.nets) {
      if (!Object.hasOwn(snapshot.nets, net)) {
        continue;
      }
      const scopedNet = `${index}:${net}`;
      uf.add(scopedNet);
      const nodes = snapshot.nets[net];
      for (const { hierarchicalPort, a } of nodes) {
        const child = hierarchicalPort && context.children.get(hierarchicalPort.symbolId);
        if (!child) continue;
        const label = scopedLabel(child.index, hierarchicalPort.name);
        if (hierarchicalPort.name) addLabel(label, scopedNet);
        if (!hierarchicalPort.name || !childLabels.has(label)) {
          const placement = ports.get(hierarchicalPort.symbolId)!;
          drcHierarchy.unmatchedPorts.push({
            symbol: placement.text.find((field) => field.description === 'Ref')?.value,
            pin: hierarchicalPort.name, a, id: placement._id, sheet: sheet.name, source,
            text: 'Hierarchical pin has no matching label in the linked schematic',
          });
        }
      }
      flatNets.set(scopedNet, context.index ? nodes.map((node) => ({
        ...node,
        sheet: context.prefix + node.sheet,
        reference: node.reference && context.prefix + node.reference,
        symbol: node.symbol && scopeFields(node.symbol),
        drcSource,
      })) : nodes);
      flatEprops.set(scopedNet, snapshot.eprops[net] || buildEmptyEprop());
    }

    for (const label in snapshot.labels) {
      if (!Object.hasOwn(snapshot.labels, label)) {
        continue;
      }
      const scopedNet = `${index}:${snapshot.labels[label]}`;
      uf.add(scopedNet);
      addLabel(scopedLabel(context.index, label), scopedNet);
      const exported = context.prefix + label;
      if (!exportedLabels.has(exported)) exportedLabels.set(exported, scopedNet);
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
  for (const [label, scopedNet] of exportedLabels) {
    const root = uf.find(scopedNet);
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
    ...(drcHierarchy.placements.length ? { drcHierarchy } : {}),
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
    const cache = new Map<dsnSheet, SheetSnapshot>();
    const contexts = hierarchyContexts([...this.sheets.values()]);
    const snapshots = contexts.flatMap(
      (context) => context.sheets.filter((sheet) => !sheet.hierarchicalSymbol).map((sheet) => {
        let snapshot = context.index ? cache.get(sheet) : this.snapshots.get(sheet.name);
        if (!snapshot) {
          snapshot = createSheetSnapshot(sheet);
          cache.set(sheet, snapshot);
        }
        return { context, sheet, snapshot };
      }),
    );

    this.netlist = mergeSheetSnapshots(snapshots);
    const packs = new Set(contexts.flatMap((context) => context.modelPacks ?? []));
    if (packs.size) this.netlist.hierarchyModelPacks = [...packs];
    const errors = this.netlist.drcHierarchy?.errors;
    if (errors?.length) this.netlist.hierarchyErrors = errors.map(({ sheet, symbol, text }) =>
      `${sheet}${symbol ? ` (${symbol})` : ''}: ${text}`,
    );
  }
}
