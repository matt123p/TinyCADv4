import { fileURLToPath } from 'url';
import path from 'path';
import Store from 'electron-store';
import fs from 'fs';
import { spawn } from 'child_process';
import { loadFile, saveFile, sendRecentFiles } from './io.js';
import { loadLibrary, loadLibraryToWebContents, saveLibrary, sendLibraries, removeLibrary, saveLibraryConfig } from './libraries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { app, ipcMain, BrowserWindow, Menu, dialog, shell } = await import('electron');
const isDev = (await import('electron-is-dev')).default;
const isMac = process.platform === 'darwin'

const store = new Store(); // Create store instance
let mainWindow;
let fileToOpen = null;
let isLibraryMode = false;
let menuTranslations = {};
let refreshMenu = () => {};
let ipcHandlersRegistered = false;

const spawnNewWindow = (filePath) => {
  const args = [];
  if (isDev) {
    args.push('.');
  }
  args.push(filePath);
  const subprocess = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore'
  });
  subprocess.unref();
};

function forceFileExtension(fileName, extension) {
  const parsed = path.parse(fileName || 'drawing');
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function getWindowIconPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, '../assets/TinyCAD.ico');
  }

  return path.join(__dirname, '../assets/TinyCAD.png');
}

function createWindow() {

  const getMenuLabel = (key, fallback) => {
    const value = menuTranslations[key];
    if (typeof value !== 'string') {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed === '' ? fallback : trimmed;
  };

  // Load saved window size & position
  const windowState = store.get('windowState') || { width: 1200, height: 800 };
  const windowIcon = getWindowIconPath();
  const appWindowUrl = isDev
    ? 'http://localhost:1234/'
    : `file://${path.join(__dirname, '../dist/index-electron.html')}`;

  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: 'TinyCAD',
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    icon: windowIcon,
    // frame: false,
    // titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false, // Important for security
      contextIsolation: true, // Prevents direct access to Node APIs
      preload: path.join(__dirname, './preload.js')
    },
  });

  function updateMenu() {
    const recentFiles = store.get('recentFiles') || [];
    const recentMenu = recentFiles.map(file => ({
      label: path.basename(file),
      click: () => mainWindow.webContents.send('menu-command-with-data', 'file-open-recent', { name: path.basename(file), id: file })
    }));

    const menuTemplate = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }] : []),
      {
        label: getMenuLabel('file', 'File'),
        submenu: [
          {
            label: getMenuLabel('new', 'New'),
            submenu: [
              { label: getMenuLabel('newDesign', 'New Design'), accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu-command', 'file-new') },
              { label: getMenuLabel('newLibrary', 'New Library'), click: () => mainWindow.webContents.send('menu-command', 'tools-new-lib') }
            ]
          },
          { label: getMenuLabel('open', 'Open'), accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu-command', 'file-open') },
          {
            label: getMenuLabel('openRecent', 'Open Recent'),
            submenu: recentMenu.length > 0 ? recentMenu : [{ label: getMenuLabel('noRecentFiles', 'No Recent Files'), enabled: false }]
          },
          { type: 'separator' },
          { label: getMenuLabel('save', 'Save'), accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu-command', 'file-save') },
          { label: getMenuLabel('saveAs', 'Save As...'), accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('menu-command', 'file-save-as') },
          { type: 'separator' },
          {
            label: getMenuLabel('import', 'Import'),
            submenu: [{ label: getMenuLabel('importKicadSymbols', 'KiCad Symbols...'), click: () => mainWindow.webContents.send('menu-command', 'import-kicad-symbols') }],
          },
          {
            label: getMenuLabel('export', 'Export'),
            submenu: [
              { label: getMenuLabel('exportSvg', 'Export to SVG'), click: () => mainWindow.webContents.send('menu-command', 'file-export-svg') },
              { label: getMenuLabel('exportPdf', 'Export to PDF'), click: () => mainWindow.webContents.send('menu-command', 'file-export-pdf') },
            ],
          },
          { type: 'separator' },
          { label: getMenuLabel('print', 'Print'), accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu-command', 'file-print') },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' }
        ]
      },
      {
        label: getMenuLabel('edit', 'Edit'),
        submenu: [
          { label: getMenuLabel('undo', 'Undo'), accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu-command', 'edit-undo') },
          { label: getMenuLabel('redo', 'Redo'), accelerator: 'CmdOrCtrl+Y', click: () => mainWindow.webContents.send('menu-command', 'edit-redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          { label: getMenuLabel('rotateLeft', 'Rotate Left'), click: () => mainWindow.webContents.send('menu-command', 'edit-rotate-left') },
          { label: getMenuLabel('rotateRight', 'Rotate Right'), click: () => mainWindow.webContents.send('menu-command', 'edit-rotate-right') },
          { label: getMenuLabel('flipHorizontal', 'Flip Horizontal'), click: () => mainWindow.webContents.send('menu-command', 'edit-flip-h') },
          { label: getMenuLabel('flipVertical', 'Flip Vertical'), click: () => mainWindow.webContents.send('menu-command', 'edit-flip-v') }
        ]
      },
      {
        label: getMenuLabel('view', 'View'),
        submenu: [
          { label: getMenuLabel('zoomIn', 'Zoom In'), accelerator: 'CmdOrCtrl+Plus', click: () => mainWindow.webContents.send('menu-command', 'view-zoom-in') },
          { label: getMenuLabel('zoomOut', 'Zoom Out'), accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.send('menu-command', 'view-zoom-out') },
        ]
      },
      ...(isLibraryMode ? [] : [{
        label: getMenuLabel('tools', 'Tools'),
        submenu: [
          { label: getMenuLabel('annotateSymbols', 'Annotate Symbols...'), click: () => mainWindow.webContents.send('menu-command', 'tools-annotate') },
          { label: getMenuLabel('billOfMaterials', 'Bill of Materials...'), click: () => mainWindow.webContents.send('menu-command', 'tools-bom') },
          { type: 'separator' },
          { label: getMenuLabel('checkDesignRules', 'Check Design Rules'), click: () => mainWindow.webContents.send('menu-command', 'tools-drc') },
          { type: 'separator' },
          { label: getMenuLabel('generateNetlist', 'Generate Netlist...'), click: () => mainWindow.webContents.send('menu-command', 'tools-netlist') },
          { label: getMenuLabel('generateSpiceNetlist', 'Generate Spice NetList'), click: () => mainWindow.webContents.send('menu-command', 'tools-spice') },
          { label: getMenuLabel('createVhdlFile', 'Create VHDL file'), click: () => mainWindow.webContents.send('menu-command', 'tools-vhdl') },
        ]
      }]),
      ...(isLibraryMode ? [] : [{
        label: getMenuLabel('settings', 'Settings'),
        submenu: [
          { label: getMenuLabel('designDetails', 'Design Details...'), click: () => mainWindow.webContents.send('menu-command', 'settings-design-details') },
          { label: getMenuLabel('pageSize', 'Page Size...'), click: () => mainWindow.webContents.send('menu-command', 'settings-page-size') },
          { label: getMenuLabel('settingsDialog', 'Settings...'), click: () => mainWindow.webContents.send('menu-command', 'settings-settings') },
          { label: getMenuLabel('colours', 'Colours...'), click: () => mainWindow.webContents.send('menu-command', 'settings-colours') },
        ]
      }]),
      {
        role: 'help',
        submenu: [
          { label: getMenuLabel('discord', 'Discord'), click: () => shell.openExternal('https://discord.gg/bdXnjhrSYQ') },
          { label: getMenuLabel('manual', 'Manual'), click: () => shell.openExternal('https://docs.tinycad.net/v4/') },
          { type: 'separator' },
          { label: getMenuLabel('aboutTinyCAD', 'About TinyCAD'), click: () => mainWindow.webContents.send('menu-command', 'help-about') },
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
  }

  refreshMenu = updateMenu;
  updateMenu();
  const unsubscribe = store.onDidChange('recentFiles', () => refreshMenu());
  mainWindow.on('closed', () => {
    unsubscribe();
    if (mainWindow && mainWindow.isDestroyed()) {
      mainWindow = null;
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize(); // Restore maximized state
  }

  // Allow TinyCAD to open another app window, but send true external links to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && url.startsWith(appWindowUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: 'TinyCAD',
          icon: windowIcon,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, './preload.js')
          }
        }
      };
    }

    if (typeof url === 'string' && url.trim() !== '' && url !== 'about:blank') {
      shell.openExternal(url);
    }

    return {
      action: 'deny'
    };
  });

  // Check for command line arguments
  const qp = new URLSearchParams();
  for (const arg of process.argv) {
    if (arg === '--new-library') {
      qp.set('action', 'new-library');
    } else if (arg.toLowerCase().endsWith('.tclib')) {
      qp.set('library', arg);
    } else if (arg.toLowerCase().endsWith('.dsn')) {
      qp.set('file', arg);
    }
  }

  // Check for MacOS file open
  if (fileToOpen) {
    if (fileToOpen.toLowerCase().endsWith('.tclib')) {
      qp.set('library', fileToOpen);
    } else if (fileToOpen.toLowerCase().endsWith('.dsn')) {
      qp.set('file', fileToOpen);
    }
    fileToOpen = null;
  }

  // and load the index.html of the app.
  let url = isDev
    ? 'http://localhost:1234'
    : `file://${path.join(__dirname, '../dist/index-electron.html')}`;

  if (qp.toString() !== '') {
    if (url.includes('?')) {
      url += '&' + qp.toString();
    } else {
      url += '?' + qp.toString();
    }
  }

  mainWindow.loadURL(url);

  // Call a function after the main renderer has started
  mainWindow.webContents.on('did-finish-load', () => {
    // Send the list of recent files
    sendRecentFiles(mainWindow);

    // Send the list of libraries
    sendLibraries(mainWindow);
  });


  // Save window size & position when closing
  let isQuitting = false;
  mainWindow.on('close', (e) => {
    if (isQuitting) {
      let bounds;
      try {
        if (mainWindow.isMaximized()) {
          bounds = mainWindow.getNormalBounds();
        } else {
          bounds = mainWindow.getBounds();
        }
        store.set('windowState', { ...bounds, isMaximized: mainWindow.isMaximized() });
      } catch (err) {
        // Ignore error if window is destroyed
      }
      return;
    }

    e.preventDefault();
    mainWindow.webContents.send('app-closing');
  });

  const appClosingResponseHandler = (event, shouldClose) => {
    if (shouldClose) {
      isQuitting = true;
      mainWindow.close();
    }
  };

  ipcMain.on('app-closing-response', appClosingResponseHandler);
  mainWindow.on('closed', () => {
    ipcMain.removeListener('app-closing-response', appClosingResponseHandler);
  });

  // Open the DevTools.
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;

    ipcMain.on('window-minimize', () => {
      mainWindow?.minimize();
    });

    ipcMain.on('window-maximize', () => {
      if (!mainWindow) {
        return;
      }

      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    });

    ipcMain.on('window-close', () => {
      mainWindow?.close();
    });

    ipcMain.on('window-set-title', (event, title) => {
      mainWindow?.setTitle(title);
    });

    ipcMain.on('open-external', (event, url) => {
      if (typeof url === 'string' && url.trim() !== '') {
        shell.openExternal(url);
      }
    });

    ipcMain.on('open-containing-folder', (event, filePath) => {
      if (typeof filePath === 'string' && filePath.trim() !== '') {
        shell.showItemInFolder(filePath);
      }
    });

    ipcMain.on('load-file', (event, file) => {
      if (!mainWindow) {
        return;
      }

      loadFile(mainWindow, file, isLibraryMode, spawnNewWindow);
    });

    ipcMain.on('save-file', (event, data) => {
      if (!mainWindow) {
        return;
      }

      saveFile(mainWindow, data);
    });

    ipcMain.on('load-library', (event, filePath) => {
      if (!mainWindow) {
        return;
      }

      // Use event.sender to send response to the requesting window (supports popup windows)
      if (event.sender !== mainWindow.webContents) {
        loadLibraryToWebContents(event.sender, mainWindow, filePath);
      } else {
        loadLibrary(mainWindow, filePath);
      }
    });

    ipcMain.on('save-library', (event, filePath) => {
      if (!mainWindow) {
        return;
      }

      saveLibrary(mainWindow, filePath);
    });

    ipcMain.on('refresh-libraries', () => {
      if (!mainWindow) {
        return;
      }

      sendLibraries(mainWindow);
    });

    ipcMain.on('open-new-window', (event, arg) => {
      const args = [];

      // In dev mode, we need to point to the main script
      if (isDev) {
        args.push('.');
      }

      // Use simple switch for new libraries, or pass the file path directly
      if (arg === 'new') {
        args.push('--new-library');
      } else if (arg) {
        args.push(arg);
      }

      const subprocess = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore'
      });

      subprocess.unref();
    });

    ipcMain.on('remove-library', (event, filePath) => {
      if (!mainWindow) {
        return;
      }

      removeLibrary(mainWindow, filePath);
    });

    ipcMain.on('save-library-config', (event, config) => {
      if (!mainWindow) {
        return;
      }

      saveLibraryConfig(mainWindow, config);
    });

    ipcMain.on('set-menu-mode', (event, mode) => {
      if (isLibraryMode !== mode) {
        isLibraryMode = mode;
        refreshMenu();
      }
    });

    ipcMain.on('set-menu-translations', (event, translations) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        return;
      }

      if (!translations || typeof translations !== 'object') {
        return;
      }

      menuTranslations = translations;
      refreshMenu();
    });

    ipcMain.handle('import-kicad-file', async () => {
      if (!mainWindow) {
        return null;
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'KiCad Symbols', extensions: ['kicad_sym'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const selectedPath = result.filePaths[0];
      const content = await fs.promises.readFile(selectedPath, 'utf8');
      return {
        fileName: path.basename(selectedPath),
        content,
      };
    });

    ipcMain.on('show-context-menu', (event, menuItems) => {
      if (!mainWindow) {
        return;
      }

      const toNativeMenuTemplate = (items) => {
        return items.map((item) => {
          if (item.itemType === 1) {
            return { type: 'separator' };
          }

          if (item.subMenuProps?.items?.length) {
            return {
              label: item.text,
              enabled: !item.disabled,
              submenu: toNativeMenuTemplate(item.subMenuProps.items),
            };
          }

          return {
            label: item.text,
            enabled: !item.disabled,
            click: () => {
              mainWindow.webContents.send('context-menu-command', item.key);
            }
          };
        });
      };

      const template = toNativeMenuTemplate(menuItems);
      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow });
    });

    ipcMain.handle('get-printers', async () => {
      if (!mainWindow) {
        return [];
      }

      const printers = await mainWindow.webContents.getPrintersAsync();
      return printers.map(p => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault,
      }));
    });

    ipcMain.on('print-document', async (event, options) => {
      if (!mainWindow) {
        return;
      }

      const printWindow = new BrowserWindow({
        show: false,
        title: 'TinyCAD',
        icon: getWindowIconPath(),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      try {
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`);
        await new Promise(resolve => setTimeout(resolve, 200));

        const printOptions = {
          silent: true,
          deviceName: options.printerName,
          copies: options.copies || 1,
          landscape: options.landscape || false,
          printBackground: true,
        };

        printWindow.webContents.print(printOptions, (success, failureReason) => {
          printWindow.close();
          mainWindow?.webContents.send('print-complete', {
            success,
            failureReason: failureReason || undefined
          });
        });
      } catch (err) {
        printWindow.close();
        mainWindow?.webContents.send('print-complete', {
          success: false,
          failureReason: err.message
        });
      }
    });

    ipcMain.on('save-pdf', (event, data) => {
      if (!mainWindow) {
        return;
      }

      const pdfBuffer = Buffer.from(data.content, 'base64');
      const defaultPath = forceFileExtension(data.name || 'drawing.pdf', '.pdf');

      dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'PDF files', extensions: ['pdf'] }],
        defaultPath,
      }).then(result => {
        if (!mainWindow) {
          return;
        }

        if (!result.canceled && result.filePath) {
          const outputPath = forceFileExtension(result.filePath, '.pdf');
          fs.writeFile(outputPath, pdfBuffer, err => {
            if (err) {
              mainWindow?.webContents.send('pdf-saved', { success: false, error: err.message });
            } else {
              mainWindow?.webContents.send('pdf-saved', { success: true, path: outputPath });
            }
          });
        } else {
          mainWindow.webContents.send('pdf-saved', { success: false, cancelled: true });
        }
      });
    });

    ipcMain.on('save-svg', (event, data) => {
      if (!mainWindow) {
        return;
      }

      const defaultPath = forceFileExtension(data.name || 'drawing.svg', '.svg');

      dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'SVG files', extensions: ['svg'] }],
        defaultPath,
      }).then(result => {
        if (!mainWindow) {
          return;
        }

        if (!result.canceled && result.filePath) {
          const outputPath = forceFileExtension(result.filePath, '.svg');
          fs.writeFile(outputPath, data.content, 'utf8', err => {
            if (err) {
              mainWindow?.webContents.send('svg-saved', { success: false, error: err.message });
            } else {
              mainWindow?.webContents.send('svg-saved', { success: true, path: outputPath });
            }
          });
        } else {
          mainWindow.webContents.send('svg-saved', { success: false, cancelled: true });
        }
      });
    });
  }

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();

    if (filePath.toLowerCase().endsWith('.dsn')) {
      loadFile(mainWindow, filePath);
    } else if (filePath.toLowerCase().endsWith('.tclib')) {
      loadLibrary(mainWindow, filePath);
    }
  } else {
    fileToOpen = filePath;
  }
});

app.whenReady().then(() => {
  app.setName('TinyCAD');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.tinycad.app');
  }
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

