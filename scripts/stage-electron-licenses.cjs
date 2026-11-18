const { copyFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

// Retain the notices from the exact Electron archive being packaged, including
// on macOS, where Electron Builder removes the original top-level files.
module.exports = async ({ appOutDir, electronPlatformName, packager }) => {
  const mac = electronPlatformName === 'darwin' || electronPlatformName === 'mas';
  const resources = mac
    ? path.join(appOutDir, packager.info.framework.distMacOsAppName, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const destination = path.join(resources, 'electron-licenses');
  await mkdir(destination, { recursive: true });
  await Promise.all([
    copyFile(path.join(appOutDir, mac ? 'LICENSE' : 'LICENSE.electron.txt'), path.join(destination, 'LICENSE')),
    copyFile(path.join(appOutDir, 'LICENSES.chromium.html'), path.join(destination, 'LICENSES.chromium.html')),
  ]);
};
