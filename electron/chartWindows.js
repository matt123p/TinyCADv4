// Only chart portals may open a scriptable blank window. They inherit the
// application's isolated, Node-disabled preferences and never load app startup.
export function chartWindowOptions({ url, frameName }, owner, icon) {
  if (
    url !== 'about:blank' ||
    !/^tinycad-chart-[a-f0-9-]{36}$/.test(frameName || '')
  )
    return;
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      title: 'TinyCAD — Simulation chart',
      parent: owner,
      icon,
      width: 900,
      height: 620,
      minWidth: 420,
      minHeight: 300,
      autoHideMenuBar: true,
    },
  };
}
export function configureChartWindow(child, details, owner) {
  if (!chartWindowOptions(details, owner)) return;
  child.removeMenu();
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on('will-navigate', (event) => event.preventDefault());
  const close = () => {
    if (!child.isDestroyed()) child.destroy();
  };
  owner.once('closed', close);
  child.once('closed', () => owner.removeListener('closed', close));
}
