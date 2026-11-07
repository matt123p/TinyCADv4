export function activate(api) {
  api.commands.registerHandler('net.tinycad.inspector.report', async () => {
    const document = await api.documents.getSnapshot();
    return api.views.open('net.tinycad.inspector.report-view', document.id);
  });
  api.libraries.registerProvider('net.tinycad.inspector.components', {
    search: ({ query }) => 'two pin component'.includes(query.toLowerCase()) ? [{ id: 'two-pin', name: 'Two pin component', description: 'A portable example component embedded when placed.' }] : [],
    resolve: ({ id }) => {
      if (id !== 'two-pin') throw new Error('Unknown example component.');
      return { name: 'Example', reference: 'U?', uid: 'tinycad-example-two-pin-v1', description: 'Example plugin library component',
        pins: [{ name: 'IN', number: '1', point: [0, 20], rotation: 0 }, { name: 'OUT', number: '2', point: [80, 20], rotation: 2 }],
        graphics: [{ type: 'rectangle', a: [20, 0], b: [60, 40] }] };
    },
  });
}
