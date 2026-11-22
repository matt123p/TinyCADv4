const { app, BrowserWindow } = require('electron');

app.setPath('userData', process.env.TINYCAD_PCB_G0_PROFILE);
app.commandLine.appendSwitch('enable-precise-memory-info');
app.commandLine.appendSwitch(
  'enable-blink-features',
  'ForceEagerMeasureMemory',
);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.env.TINYCAD_PCB_G0_REFERENCE === '1',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadURL(process.env.TINYCAD_PCB_G0_URL);
});
