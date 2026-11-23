import { BrowserWindow, dialog } from 'electron';

export async function openPdfPrintWindow(parent, file) {
  const window = new BrowserWindow({
    parent,
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      plugins: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());

  try {
    await window.loadFile(file);
    window.show();
    window.webContents.print({ silent: false }, (success, failureReason) => {
      if (!success && failureReason && failureReason !== 'Print job canceled' && !window.isDestroyed()) {
        void dialog.showMessageBox(window, {
          type: 'error',
          message: 'Could not print the PDF',
          detail: failureReason,
        });
      }
    });
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}
