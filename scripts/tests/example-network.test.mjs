import test from 'node:test';
import { runRegression } from './run-regression.mjs';

test('bundled office network embeds stackable panels and connects only the intended sockets', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { decodeDrawing, encodeDrawing } from './src/io/dsnCodec';
    import { initialiseLayoutRuntime } from './scripts/layout/headless';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { NetlistGenerator } from './src/io/netlists/netlistGenerator';
    import { makeNetForDrawing } from './src/web-worker/netlist';
    initialiseLayoutRuntime();
    module.exports = (async () => {
      const catalog = JSON.parse(fs.readFileSync('bundled-examples/config.json', 'utf8'));
      const example = catalog.groups.find(g => g.id === 'examples').examples.find(e => e.id === 'network-layout');
      assert.ok(example, 'Network drawing is registered in Open Example');
      assert.ok(fs.statSync('bundled-examples/' + example.preview).size > 0);
      const drawing = await decodeDrawing(fs.readFileSync('bundled-examples/' + example.path));
      assert.equal(drawing.sheets.length, 1);
      const sheet = drawing.sheets[0];
      const symbols = sheet.items.filter(i => i.NodeName === 'symbol');
      const reference = s => s.text.find(t => t.description === 'Ref').value;
      const devices = Object.fromEntries(symbols.map(s => [reference(s), s]));
      assert.deepEqual(Object.keys(devices).sort(), ['AP1', 'DS1', 'ONT1', 'PP1', 'RK1', 'RTR1', 'SW1']);
      for (const s of symbols) {
        assert.ok(s._symbol.outlines[0].items.length > 0, 'Symbol artwork is embedded');
        assert.equal(s.scale_x, 1);
        assert.equal(s.scale_y, 1);
        for (const [x,y] of new updateSymbol(s).active_points())
          assert.ok([x,y].every(n => Number.isInteger(n / 5)), 'Socket remains on the fine grid');
      }
      const rack = ['RTR1', 'SW1', 'PP1', 'RK1'].map(ref => devices[ref]);
      for (const [i, s] of rack.entries()) {
        assert.deepEqual(new updateSymbol(s).outline().size, [1320, 120]);
        assert.equal(s.point[0], rack[0].point[0]);
        assert.equal(s.point[1], rack[0].point[1] + i * 120, 'Rack faces stack without gaps');
      }
      const connections = doc => {
        const netlist = new NetlistGenerator();
        makeNetForDrawing(doc, netlist);
        return Object.values(netlist.nets).map(net => [...new Set(net
          .filter(n => n.reference && n.pin)
          .map(n => n.reference + ':' + n.pin))].sort())
          .filter(net => net.length > 1).sort((a,b) => a.join().localeCompare(b.join()));
      };
      const expected = [
        ['ONT1:1', 'RTR1:1'],
        ['RTR1:5', 'SW1:25'],
        ['AP1:1', 'PP1:1', 'SW1:4'],
        ['DS1:1', 'PP1:3', 'SW1:6'],
      ].map(net => net.sort()).sort((a,b) => a.join().localeCompare(b.join()));
      assert.deepEqual(connections(drawing), expected, 'Patch leads and office runs join the exact intended sockets');
      for (const wire of sheet.items.filter(i => i.NodeName === 'wire'))
        for (let i = 1; i < wire.d_points.length; i++) {
          const a = wire.d_points[i-1], b = wire.d_points[i];
          assert.ok(a[0] === b[0] || a[1] === b[1], 'Cables use orthogonal segments');
        }
      const reopened = await decodeDrawing(await encodeDrawing(drawing, 'xml'));
      assert.deepEqual(connections(reopened), expected, 'Editing and saving preserve the cable map');
    })();
  `);
});
