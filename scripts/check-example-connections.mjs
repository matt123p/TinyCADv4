// Independently check the exact XML returned by the public service. Older
// services may report preserved connectivity while missing implicit T contacts.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { layoutRuntime } from './lib/layout-runtime.mjs';

const id = process.argv[2];
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
const api = await layoutRuntime();
const drawing = await api.decodeDrawing(bytes);
const sources = JSON.parse(
  await fs.readFile('build/library-examples/sources.json', 'utf8'),
);
const expected = sources.examples.find((e) => e.id === id)?.expectedNets;
assert.ok(expected, 'Expected example connection map is required');
function nets(native) {
  const generator = new api.NetlistGenerator();
  api.makeNetForDrawing(
    native
      ? { ...drawing, sheets: drawing.sheets.map(api.withNativeJunctions) }
      : drawing,
    generator,
  );
  return Object.values(generator.nets)
    .map((net) =>
      [
        ...new Set(
          net
            .filter((n) => n.reference && n.pin)
            .map((n) => n.reference + ':' + n.pin),
        ),
      ].sort(),
    )
    .filter((n) => n.length > 1)
    .sort((a, b) => a.join().localeCompare(b.join()));
}
assert.deepEqual(
  nets(false),
  expected,
  id + ': literal netlist must match the intended connections',
);
assert.deepEqual(
  nets(true),
  expected,
  id + ': endpoint and terminal contacts must not join unrelated nets',
);
process.stdout.write(
  JSON.stringify({
    electricalConnectivityPreserved: true,
    nativeContactsPreserved: true,
  }) + '\n',
);
