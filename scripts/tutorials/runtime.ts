import { blank, ioXML } from '../../src/io/ioXml';
import { XMLBuilder } from '../../src/util/xmlbuilder';
import { updateView } from '../../src/manipulators/updateView';
import { updateSymbol } from '../../src/manipulators/updateSymbol';
import { updateLabel } from '../../src/manipulators/updateLabel';
import { get_global_id } from '../../src/util/global_id';
import {
  createControl,
  updateControl,
} from '../../src/simulation/controlSymbols';
import { defaultSource } from '../../src/simulation/controls';
import { createSimulationSheet } from '../../src/simulation/document';
import { NetlistWorkerState } from '../../src/web-worker/netlistState';
import { buildDeck } from '../../src/simulation/deck';
import { checkSpiceComponents } from '../../src/simulation/diagnostics';
import { autoPlaceSymbolText, sameConnectivity } from '../../src/layout';
export * from '../layout/runtime';
export {
  putResult,
  getResult,
  vectorUnit,
} from '../../src/simulation/resultStore';
export { digest } from '../../src/io/dsnContainer';
export { buildDeck, NetlistWorkerState };
const font = {
  font_name: 'Arial',
  font_size: 10,
  font_colour: '#132d46',
  font_bold: false,
  font_italic: false,
};
export class TutorialCircuit {
  drawing: any = blank();
  sheet: any = this.drawing.sheets[0];
  constructor(public title: string, public library: any[]) {
    this.sheet.name = 'Circuit';
    this.sheet.details = {
      ...this.sheet.details,
      title,
      author: 'TinyCAD tutorials',
      date: '',
      page_size: [1400, 900],
      grid: 5,
    };
  }
  sync() {
    this.drawing.sheets[0] = this.sheet;
  }
  ports(s: any) {
    return Object.fromEntries(
      new updateSymbol(s)
        .active_points()
        .map((p) => [p[2].number, [p[0], p[1]]]),
    );
  }
  wire(...ps: number[][]) {
    for (let i = 1; i < ps.length; i++) {
      if (ps[i][0] === ps[i - 1][0] && ps[i][1] === ps[i - 1][1]) continue;
      if (ps[i][0] !== ps[i - 1][0] && ps[i][1] !== ps[i - 1][1])
        throw Error('Diagonal ' + this.title);
      this.sheet.items.push({
        NodeName: 'wire',
        _id: get_global_id(),
        d_points: [ps[i - 1], ps[i]],
        _magnetic: null,
      });
    }
  }
  label(p: number[], text: string, rotation = 0) {
    this.sheet.items.push(
      new updateLabel({
        ...font,
        NodeName: 'label',
        _id: get_global_id(),
        point: p,
        rotation,
        which: 0,
        text,
        textData: null,
      } as any).post_construction(),
    );
  }
  ground(p: number[]) {
    this.sheet.items.push({
      ...font,
      NodeName: 'power',
      _id: get_global_id(),
      point: p,
      rotation: 0,
      which: 4,
      text: '0',
      hints: [],
    });
  }
  place(s: any, ref: string, anchor: number[], pin = '1') {
    s.text.find((f) => f.description === 'Ref').value = ref;
    const p = this.ports(s)[pin];
    s = {
      ...s,
      point: [s.point[0] + anchor[0] - p[0], s.point[1] + anchor[1] - p[1]],
      _active_points: null,
    };
    s.text = s.text.map((f) => ({
      ...f,
      show: ['Ref', 'Value'].includes(f.description),
      position: f.description === 'Ref' ? [12, -25] : [12, -12],
    }));
    s = new updateSymbol(s).post_construction();
    this.sheet.items.push(s);
    this.sheet.symbols[s._symbol.id] = s._symbol;
    this.sync();
    return { symbol: s, p: this.ports(s), ref };
  }
  part(
    name: string,
    ref: string,
    value: string,
    anchor: number[],
    orientation = 'h',
    fields: any = {},
  ) {
    const e = this.library.find((e) => e.name.Name === name);
    if (!e) throw Error('Missing ' + name);
    const xml = new XMLBuilder();
    xml.fromText(e.xml);
    const parsed = new ioXML().from_dsn(xml);
    this.sheet = new updateView().handleSelectLibrarySymbol(
      {},
      this.sheet,
      e.name,
      parsed.sheets.map((s) => s.items),
      anchor as any,
    ).sheet;
    let s = this.sheet.items.pop();
    for (const [key, v] of Object.entries({ Value: value, ...fields })) {
      let f = s.text.find((f) => f.description === key);
      if (f) f.value = String(v);
      else
        s.text.push({
          description: key,
          value: String(v),
          show: false,
          display: 2,
          position: [0, 0],
        });
    }
    if (['h', 'v'].includes(orientation)) {
      for (let rotation = 0; rotation < 8; rotation++) {
        const c = { ...s, rotation, _active_points: null },
          p = this.ports(c),
          a = p['1'],
          b = p['2'];
        if (
          orientation === 'h'
            ? Math.abs(a[1] - b[1]) < 0.01 && b[0] > a[0]
            : Math.abs(a[0] - b[0]) < 0.01 &&
              b[1] > a[1] &&
              (name !== 'Potentiometer' || p['3'][0] > a[0])
        ) {
          s = c;
          break;
        }
      }
    }
    if (orientation === 'npn') {
      for (let rotation = 0; rotation < 8; rotation++) {
        const c = { ...s, rotation, _active_points: null },
          p = this.ports(c);
        if (p['3'][1] < p['2'][1] && p['1'][0] < p['2'][0]) {
          s = c;
          break;
        }
      }
    }
    return this.place(s, ref, anchor);
  }
  source(ref: string, p: number[], config: any = {}) {
    this.sync();
    const c = createControl('source', this.sheet, this.drawing);
    this.sheet.symbols = c.sheet.symbols;
    return this.place(
      updateControl(
        c.symbol,
        { ...defaultSource(), dc: '0', acMagnitude: '0', ...config },
        this.drawing,
      ),
      ref,
      p,
    );
  }
  controlled(
    ref: string,
    p: number[],
    config: any = { kind: 'controlled', type: 'voltage', gain: '2' },
  ) {
    this.sync();
    const c = createControl('controlled', this.sheet, this.drawing);
    this.sheet.symbols = c.sheet.symbols;
    return this.place(updateControl(c.symbol, config, this.drawing), ref, p);
  }
  stub(c: any, pin: string, net: string, length = 40) {
    const point = c.p[pin],
      s = c.symbol;
    const active = new updateSymbol(s)
      .active_points()
      .find((p) => p[2].number === pin);
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]; // use geometry-derived direction below
    const ps = Object.values(c.p) as number[][];
    const cx = ps.reduce((n, p) => n + p[0], 0) / ps.length,
      cy = ps.reduce((n, p) => n + p[1], 0) / ps.length;
    const dx = point[0] - cx,
      dy = point[1] - cy;
    const d =
      Math.abs(dx) > Math.abs(dy)
        ? [Math.sign(dx) || 1, 0]
        : [0, Math.sign(dy) || 1];
    const end = [point[0] + d[0] * length, point[1] + d[1] * length];
    this.wire(point, end);
    if (net === '0') this.ground(end);
    else this.label(end, net, d[1] ? 1 : 0);
    return end;
  }
  finish(
    name: string,
    analysis: any,
    signals: string[],
    instructions: string,
    extras: any = {},
  ) {
    this.sheet = new updateView().tidy_wires(this.sheet);
    const placed = autoPlaceSymbolText(this.sheet, { maxEvaluations: 4000 });
    this.sheet = placed.sheet;
    this.sync();
    const sim = createSimulationSheet(this.sheet, name);
    Object.assign(sim.simulation, { instructions, signals, ...extras });
    Object.assign(sim.simulation.analysis, analysis);
    this.drawing.sheets.push(sim);
    const net = new NetlistWorkerState().init(this.drawing);
    const errors = checkSpiceComponents(net, sim.simulation);
    if (errors.length) throw Error(JSON.stringify(errors));
    return { drawing: this.drawing, deck: buildDeck(net, sim.simulation) };
  }
}
