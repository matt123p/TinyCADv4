import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readComponentDump, componentInventory } from './lib/mysql-dump.mjs';
import {
  buildLibraryModel,
  serializeLibrary,
} from './lib/library-from-sql.mjs';

export async function buildLibraryFromSql({ sql, recipe, output }) {
  const source = await fs.readFile(sql, 'utf8');
  const selection = JSON.parse(await fs.readFile(recipe, 'utf8'));
  const destination = path.resolve(
    output ||
      selection.output ||
      'bundled-libraries/' + selection.id + '.tclib',
  );
  if (!destination.toLowerCase().endsWith('.tclib'))
    throw new Error('Output must be a .tclib file.');
  const model = buildLibraryModel(
    readComponentDump(source),
    selection,
    createHash('sha256').update(source).digest('hex'),
  );
  const bytes = await serializeLibrary(model.library, model.provenance);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  const report = destination.replace(/\.tclib$/i, '.provenance.json');
  await fs.writeFile(report, JSON.stringify(model.provenance, null, 2) + '\n');
  return { destination, report, ...model };
}

async function main(args) {
  const command = args.shift();
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (
      ![
        '--sql',
        '--recipe',
        '--output',
        '--author',
        '--search',
        '--json',
      ].includes(key) ||
      !args.length
    )
      throw new Error(`Unknown or incomplete argument: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  if (command === '--help' || !command) {
    console.log(
      'Inspect: node scripts/build-library-from-sql.mjs inspect --sql DUMP.sql [--author NAME] [--search TEXT] [--json inventory.json]\nBuild:   node scripts/build-library-from-sql.mjs build --sql DUMP.sql --recipe recipes/library.json [--output library.tclib]',
    );
    return;
  }
  if (!options.sql) throw new Error('--sql is required.');
  if (command === 'inspect') {
    let inventory = componentInventory(
      readComponentDump(await fs.readFile(options.sql, 'utf8')),
      options.author,
    );
    if (options.search) {
      const search = options.search.toLowerCase();
      inventory = inventory.filter((entry) =>
        `${entry.name} ${entry.description}`.toLowerCase().includes(search),
      );
    }
    if (options.json)
      await fs.writeFile(
        options.json,
        JSON.stringify(inventory, null, 2) + '\n',
      );
    else
      for (const entry of inventory)
        console.log(
          `${entry.nameId}\t${entry.symbolId}\t${entry.author}\t${entry.name}\t${entry.description}`,
        );
    console.log(`${inventory.length} components selected.`);
  } else if (command === 'build') {
    if (!options.recipe) throw new Error('--recipe is required.');
    const result = await buildLibraryFromSql(options);
    console.log(
      `Built ${result.library.names.length} components, ${result.library.symbols.length} definitions: ${result.destination}\nProvenance: ${result.report}`,
    );
  } else throw new Error(`Unknown command: ${command}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
