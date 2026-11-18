import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';
import * as validation from '../../shared/bundledLibraries.js';

export async function checkSpiceComponents(library) {
  const model = loadComponent('src/model/tclib.ts', {});
  const libraryActions = loadComponent(
    'src/state/actions/libraryActions.ts',
    {},
  );
  const managerModule = loadComponent('src/io/bundledLibraries.ts', {
    '../model/tclib': model,
    '../../shared/bundledLibraries': validation,
  });
  const setup = (options = {}) => {
    const calls = [];
    let saved = [];
    const loads = [];
    const manager = new managerModule.BundledLibraryManager({
      catalog: async () => ({
        version: 1,
        libraries: options.missing
          ? []
          : [
              { id: 'spice', name: 'SPICE essentials', path: 'spice.tclib' },
              { id: 'other', name: 'Other library', path: 'other.tclib' },
            ],
      }),
      selection: async () => saved,
      saveSelection: async (ids) => {
        saved = [...ids];
      },
      load: async (entry) => {
        loads.push(entry.id);
        return options.load ? options.load(entry) : library;
      },
    });
    const commands = loadComponent('src/io/spiceComponents.ts', {
      './bundledLibraries': { ...managerModule, bundledLibraries: manager },
      '../model/tclib': model,
      '../state/actions/libraryActions': libraryActions,
      './librarySymbols': {
        librarySymbolSelection: (library, name, beginPlacement) => ({
          type: 'place',
          library,
          name,
          beginPlacement,
        }),
      },
      '../state/dispatcher/AppDispatcher': {
        actionSelectDialog: (dialog, props) => ({
          type: 'dialog',
          dialog,
          props,
        }),
        actionSheetSelect: (index) => ({ type: 'sheet', index }),
      },
    });
    const state = {
      docStore: {
        present: {
          drawing: { documentId: 'one', sheets: [{}] },
          view: { selected_sheet: 0 },
          editLibrary: null,
        },
      },
    };
    const dispatch = (action) => {
      calls.push(action);
      if (action.type === 'sheet')
        state.docStore.present.view.selected_sheet = action.index;
    };
    return {
      commands,
      calls,
      manager,
      state,
      loads,
      saved: () => saved,
      run: (command) => command(dispatch, () => state),
    };
  };

  const normal = setup();
  for (const component of normal.commands.SPICE_COMPONENTS) {
    await normal.run(normal.commands.insertSpiceComponent(component.id));
    const placed = normal.calls.at(-1);
    assert.equal(placed.type, 'place');
    assert.equal(placed.beginPlacement, true);
    assert.equal(
      placed.name,
      library.names.find((name) => name.Name === component.name),
      'shortcut must use the actual bundled name and attributes',
    );
    assert.equal(placed.library.readOnly, true);
  }
  assert.deepEqual(
    normal.loads,
    ['spice'],
    'successive shortcuts share the loaded SPICE library',
  );
  assert.deepEqual(normal.saved(), ['spice']);

  const more = setup();
  await more.manager.initialize();
  await more.manager.select(['other']);
  await more.run(more.commands.showSpiceLibrary());
  assert.equal(
    more.calls[0].type,
    libraryActions.LibraryActionTypes.ShowStandardLibrary,
  );
  assert.equal(more.calls[0].libraryId, 'spice');
  assert.deepEqual(more.saved(), ['spice']);
  assert.equal(more.manager.getSnapshot().libraries.length, 1);

  const chart = setup();
  chart.state.docStore.present.drawing.sheets = [{ kind: 'simulation' }, {}];
  await chart.run(chart.commands.insertSpiceComponent('resistor'));
  assert.equal(chart.state.docStore.present.view.selected_sheet, 1);
  assert.ok(
    chart.calls.findIndex((action) => action.type === 'sheet') <
      chart.calls.findIndex((action) => action.type === 'place'),
  );

  let release;
  const concurrent = setup({
    load: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = concurrent.run(
    concurrent.commands.insertSpiceComponent('resistor'),
  );
  const latest = concurrent.run(
    concurrent.commands.insertSpiceComponent('capacitor'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  release(library);
  await Promise.all([first, latest]);
  assert.deepEqual(concurrent.loads, ['spice']);
  assert.deepEqual(
    concurrent.calls
      .filter((action) => action.type === 'place')
      .map((action) => action.name.Name),
    ['Capacitor'],
    'only the last shortcut enters placement after a shared load',
  );

  const changed = setup({
    load: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const waiting = changed.run(
    changed.commands.insertSpiceComponent('resistor'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  changed.state.docStore.present.drawing.documentId = 'new document';
  release(library);
  await waiting;
  assert.equal(
    changed.calls.some((action) => action.type === 'place'),
    false,
    'an old request cannot insert into a newly opened document',
  );

  const failed = setup({
    load: async () => {
      throw new Error('fixture missing');
    },
  });
  await failed.run(failed.commands.insertSpiceComponent('diode'));
  assert.equal(failed.calls.at(-1).dialog, 'io_failure');
  assert.match(failed.calls.at(-1).props.message, /fixture missing/);
  const missing = setup({ missing: true });
  await missing.run(missing.commands.showSpiceLibrary());
  assert.match(missing.calls.at(-1).props.message, /not configured/);
  console.log(
    'SPICE component shortcuts passed: exact symbols, shared load, More navigation, schematic selection, races, document changes, and failures.',
  );
}
