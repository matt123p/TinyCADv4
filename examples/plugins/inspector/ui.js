export async function mount(root, api, context) {
  const title = document.createElement('h2');
  title.textContent = context.surface === 'model' ? 'Symbol metadata' : context.surface === 'notes' ? 'Design notes' : 'Circuit Inspector';
  root.append(title);
  if (context.surface === 'notes' || context.surface === 'model') {
    const target = context.surface === 'model' ? { scope: 'symbolDefinition', targetId: context.symbolId } : { scope: 'document' };
    const label = document.createElement('label'); label.textContent = 'Notes saved with this ' + (context.surface === 'model' ? 'symbol' : 'design');
    const input = document.createElement('textarea'); input.rows = 5; input.style.width = '95%'; label.append(input);
    const save = document.createElement('button'); save.textContent = 'Save notes';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    let revision;
    const refresh = async () => { const value = await api.extensionData.get(target); input.value = value.data?.notes || ''; revision = value.revision; };
    input.oninput = () => { void api.ui.setDirty(true); };
    save.onclick = async () => { try { const result = await api.extensionData.set({ ...target, expectedRevision: revision }, { notes: input.value }); revision = result.revision; await api.ui.setDirty(false); status.textContent = 'Notes updated. Use TinyCAD Save to write the file.'; } catch (error) { status.textContent = error.message; } };
    root.append(label, save, status); await refresh();
    api.events.on('documentChanged', () => { status.textContent = 'The document changed. Reload notes before saving if another editor changed them.'; });
    return;
  }
  const output = document.createElement('pre'); output.style.whiteSpace = 'pre-wrap';
  const refresh = async () => {
    const snapshot = await api.documents.getSnapshot(context.documentId);
    const items = snapshot.sheets.flatMap(sheet => sheet.items);
    output.textContent = `${snapshot.name}\nRevision ${snapshot.revision}\n${snapshot.sheets.length} sheet(s)\n${items.length} item(s)\n${items.filter(item => item.type === 'symbol').length} component(s)`;
    if (context.surface === 'report') {
      const netlist = await api.netlists.generate('connectivity', snapshot.id);
      output.textContent += '\n\nConnectivity\n' + JSON.stringify(netlist.nets, null, 2);
    }
  };
  const button = document.createElement('button'); button.textContent = 'Refresh'; button.onclick = () => refresh().catch(error => { output.textContent = error.message; });
  root.append(button, output); await refresh();
  api.events.on('documentChanged', () => refresh().catch(error => { output.textContent = error.message; }));
}
