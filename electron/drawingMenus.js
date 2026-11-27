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

export function drawingViewMenu(getLabel, state, libraryMode, send) {
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
