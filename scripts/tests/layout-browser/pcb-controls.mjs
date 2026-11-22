const menus = {
  Board: [
    'PCB Size & Shape…', 'Add cutout…', 'Hole or slot…', 'Add dimension…',
    'Set measurement datum…', 'Pick overlapping objects', 'Update PCB from Schematic…',
    'Edit PCB references…', 'Update Schematic from PCB…', 'Board connections…',
    'Import schematic or netlist…', 'View board tools',
  ],
  Copper: [
    'Net rules…', 'Inspect board rules…', 'Run design checks…', 'Add placement area…',
    'Add routing region…', 'Add copper zone…', 'Add wire jumper…',
  ],
  Fabrication: [
    'Fabrication settings…', 'CAM read-back preview…', 'Inspect in 3D…', 'Manufacturing revisions…',
    'Review KiCad board…', 'Export KiCad board…',
  ],
};

export function pcbMenuName(label) {
  const entry = Object.entries(menus).find(([, actions]) => actions.includes(label));
  if (!entry) throw new Error('Unknown PCB menu action ' + label);
  return entry[0];
}

export async function pcbMenuItem(workspace, label) {
  await workspace.getByRole('button', { name: pcbMenuName(label), exact: true }).click();
  return workspace.page().getByRole('menuitem', { name: label, exact: true });
}

export async function clickPcbCommand(workspace, label) {
  if (label === 'View components' || label === 'View netlist') {
    const target = label === 'View components' ? 'Components' : 'Netlist';
    const current = target === 'Components' ? 'Netlist' : 'Components';
    const back = workspace.getByRole('button', { name: /^Back to (Components|Netlist)$/ });
    if (await back.isVisible()) await back.click();
    const panel = workspace.getByRole('region', { name: 'Board properties' });
    const switcher = panel.getByRole('button', { name: current, exact: true });
    if (await switcher.isVisible()) {
      await switcher.click();
      await workspace.page().getByRole('menuitem', { name: target, exact: true }).click();
    }
    return;
  }
  await (await pcbMenuItem(workspace, label)).click();
}

export async function pcbNetRow(workspace, net) {
  const table = workspace.getByRole('grid', { name: 'Board netlist' });
  if (!(await table.isVisible())) {
    const back = workspace.getByRole('button', { name: /^Back to (Components|Netlist)$/ });
    if (await back.isVisible()) await back.click();
    const mode = workspace.getByRole('region', { name: 'Board properties' })
      .getByRole('button', { name: 'Components', exact: true });
    if (await mode.isVisible()) {
      await mode.click();
      await workspace.page().getByRole('menuitem', { name: 'Netlist', exact: true }).click();
    } else if (!(await table.isVisible())) {
      await clickPcbCommand(workspace, 'View netlist');
    }
  }
  return typeof net === 'string'
    ? table.locator(`[data-rowid="${net}"]`)
    : table.getByRole('row').filter({ has: workspace.page().getByText(net.label, { exact: true }) });
}

export async function selectPcbNet(workspace, net) {
  await (await pcbNetRow(workspace, net)).click();
}
