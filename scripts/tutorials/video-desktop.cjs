// Isolated capture entry point: the application, preload and native solver are real.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', process.env.TUTORIAL_PROFILE);
app.disableHardwareAcceleration();
const originalLoadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = function (url, ...rest) {
  if (url.startsWith('http://localhost:1234'))
    url = url.replace('http://localhost:1234', process.env.TUTORIAL_APP_URL);
  return originalLoadURL.call(this, url, ...rest);
};
app.on('browser-window-created', (_, win) => {
  win.setBounds({ x: 0, y: 0, width: 1600, height: 900 });
  win.webContents.openDevTools = () => {};
});
import(
  require('node:url').pathToFileURL(path.resolve('electron/electron.js')).href
).catch((error) => {
  console.error(error);
  app.exit(1);
});
