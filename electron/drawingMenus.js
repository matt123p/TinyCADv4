export function drawingOpenMenu(getLabel, recentMenu, send) {
  return [
    {
      label: getLabel('openRecent', 'Open Recent'),
      submenu: recentMenu.length
        ? recentMenu
        : [
            {
              label: getLabel('noRecentFiles', 'No Recent Files'),
              enabled: false,
            },
          ],
    },
    { type: 'separator' },
    {
      label: getLabel('openExample', 'Open Example'),
      click: () => send('file-open-example'),
    },
    { type: 'separator' },
  ];
}

export function drawingViewMenu(getLabel, state, libraryMode, send, pcbMode = false) {
  if (pcbMode) {
    return [
      { label: getLabel('zoomIn', 'Zoom In'), accelerator: 'CmdOrCtrl+Plus', click: () => send('view-zoom-in') },
      { label: getLabel('zoomOut', 'Zoom Out'), accelerator: 'CmdOrCtrl+-', click: () => send('view-zoom-out') },
    ];
  }
  return [
    {
      label: getLabel('viewExplanation', 'View Explanation'),
      type: 'checkbox',
      enabled: !libraryMode && state.canvas !== false && state.hasExampleExplanation,
      checked: state.hasExampleExplanation && state.exampleExplanationVisible,
      click: () => send('view-explanation'),
    },
    {
      label: getLabel('showCharts', 'Show Charts'),
      type: 'checkbox',
      enabled: !libraryMode && state.canvas !== false,
      checked: state.simulationPanelVisible,
      click: () => send('view-show-charts'),
    },
    { type: 'separator' },
    {
      label: getLabel('zoomIn', 'Zoom In'),
      accelerator: 'CmdOrCtrl+Plus',
      enabled: state.canvas !== false,
      click: () => send('view-zoom-in'),
    },
    {
      label: getLabel('zoomOut', 'Zoom Out'),
      accelerator: 'CmdOrCtrl+-',
      enabled: state.canvas !== false,
      click: () => send('view-zoom-out'),
    },
  ];
}

export function boardWorkspaceMenus(menus, send) {
  const literalLabel = (label) => process.platform === 'darwin' ? label : label.replaceAll('&', '&&');
  return menus.map(({ title, items }) => ({
    label: literalLabel(title),
    submenu: items.map((item) => item ? {
      label: literalLabel(item.label),
      enabled: !item.disabled,
      click: () => send('pcb-menu:' + item.id),
    } : { type: 'separator' }),
  }));
}


export function drawingNewMenu(getLabel, send) {
  return [
    {
      label: getLabel('newDesign', 'New Design'),
      accelerator: 'CmdOrCtrl+N',
      click: () => send('file-new'),
    },
    { label: getLabel('newSymbolLibrary', 'New Custom Symbol Library'), click: () => send('tools-new-lib') },
    { type: 'separator' },
    { label: getLabel('newPcb', 'New PCB'), click: () => send('file-new-pcb') },
    { label: getLabel('newPcbFootprintLibrary', 'New PCB Footprint Library'), click: () => send('file-new-footprint-library') },
  ];
}
