export async function mount(root, api) {
  const heading = document.createElement('h2'); heading.textContent = 'Project files'; root.append(heading);
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const output = document.createElement('div'); const status = document.createElement('p'); status.setAttribute('role', 'status');
  const button = (label, callback) => { const node = document.createElement('button'); node.textContent = label; node.onclick = async () => { try { await callback(); await refresh(); } catch (error) { status.textContent = error.message; } }; return node; };
  actions.append(button('New design', async () => api.documents.create('Untitled.dsn')), button('Open design', () => api.documents.open()), button('Refresh files', async () => {}));
  root.append(actions, status, output);
  const refresh = async () => {
    const documents = await api.documents.list(); output.replaceChildren();
    for (const entry of documents) {
      const row = document.createElement('div'); row.style.cssText = 'padding:12px 0;border-bottom:1px solid #ddd;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const label = document.createElement('strong'); label.textContent = entry.name + (entry.dirty ? ' *' : '');
      row.append(label, button('Open', () => api.documents.activate(entry.id)), button('Save', () => api.documents.save(entry.id)));
      if (documents.length > 1) row.append(button('Close', () => api.documents.close(entry.id)));
      output.append(row);
    }
  };
  await refresh(); api.events.on('documentChanged', () => refresh().catch(error => { status.textContent = error.message; }));
  api.events.on('documentOpened', () => refresh().catch(error => { status.textContent = error.message; }));
  api.events.on('documentSaved', () => refresh().catch(error => { status.textContent = error.message; }));
}
