import { isProjectFile } from '../shared/projectFiles.js';
import { recentProjectFolders, registerProjectFiles } from './projectFiles.js';
import { isDrawingFile } from '../shared/drawingFiles.js';
import { registerSimulation } from './simulation.js';
import { chartWindowOptions, configureChartWindow } from './chartWindows.js';
import { drawingOpenMenu, drawingViewMenu } from './drawingMenus.js';
import { registerChatGPTHandlers } from '../chatgpt/bridge.js';
import { registerChatSecretHandlers } from './chat-secrets.js';
import { fileURLToPath } from 'url';
import path from 'path';
import Store from 'electron-store';
import { registerBundledLibraries } from './bundledLibraries.js';
import { unpackedResource } from './tclibReader.js';
import { registerBundledExamples } from './bundledExamples.js';
import { registerOnlineLibrary } from './onlineLibrary.js';
import { registerLicenseHandlers } from './licenses.js';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import { loadFile, saveFile, sendRecentFiles } from './io.js';
import { loadLibrary, loadLibraryToWebContents, saveLibrary, sendLibraries, removeLibrary, saveLibraryConfig } from './libraries.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { app, ipcMain, BrowserWindow, Menu, dialog, shell, safeStorage, net } = await import('electron');
const isDev = (await import('electron-is-dev')).default;
const isMac = process.platform === 'darwin'
const appDisplayName = 'TinyCAD';

const store = new Store(); // Create store instance
let mainWindow;
let fileToOpen = null;
let projectToOpen = null;

function queueProjectOpen(filename) {
  projectToOpen = path.resolve(filename);
  const contents = mainWindow.webContents;
  const open = () => contents.send('menu-command', 'file-open-project-launch');
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', open);
  else open();
}
let isLibraryMode = false;
let editorMenuState = { project: false, editor: 'design' };
let viewMenuState = { hasExampleExplanation: false, exampleExplanationVisible: false, simulationPanelVisible: false };
let menuTranslations = {};
let refreshMenu = () => {};
let ipcHandlersRegistered = false;

const spawnNewWindow = (filePath) => {
  const args = [];
  if (!app.isPackaged) {
    if (process.argv.includes('--no-sandbox')) args.push('--no-sandbox');
    args.push(app.getAppPath());
  }
  const profile = process.argv.find(arg => arg.startsWith('--user-data-dir='));
  if (profile) args.push(profile);
  args.push(filePath);
  const subprocess = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore'
  });
  subprocess.unref();
};

function showAbout() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow({ openAbout: true });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  const contents = mainWindow.webContents;
  const show = () => contents.send('menu-command', 'help-about');
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', show);
  else show();
}

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

function createWindow({ openAbout = false } = {}) {

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

  mainWindow.webContents.on('context-menu', (_event, { isEditable, editFlags }) => {
    if (!isEditable) return;
    Menu.buildFromTemplate([
      { label: getMenuLabel('undo', 'Undo'), click: () => mainWindow.webContents.send('menu-command', 'edit-undo') },
      { label: getMenuLabel('redo', 'Redo'), click: () => mainWindow.webContents.send('menu-command', 'edit-redo') },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { role: 'delete', enabled: editFlags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ]).popup({ window: mainWindow });
  });

  function updateMenu() {
    const { project, editor } = editorMenuState;
    const design = editor === 'design' && !isLibraryMode;
    const canvas = editor === 'design';
    const editable = canvas || editor === 'text';
    const canSave = editable || editor === 'bom';
    const canSaveAs = canvas || editor === 'bom';
    const recentFiles = store.get('recentFiles') || [];
    const recentMenu = recentFiles.map(file => ({
      label: path.basename(file),
      click: () => mainWindow.webContents.send('menu-command-with-data', 'file-open-recent', { name: path.basename(file), id: file })
    }));

    const recentProjects = recentProjectFolders(store).map(id => ({
      label: isMac ? id : id.replaceAll('&', '&&'),
      click: () => mainWindow.webContents.send('menu-command-with-data', 'file-open-recent-project', { id }),
    }));
    const menuTemplate = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { label: getMenuLabel('aboutTinyCAD', 'About TinyCAD'), click: showAbout },
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
          { label: 'Open Project Folder…', click: () => mainWindow.webContents.send('menu-command', 'file-open-project-folder') },
          { label: 'Recent Projects', submenu: recentProjects.length ? recentProjects : [{ label: 'No Recent Projects', enabled: false }] },
          { label: 'Close Project', enabled: project, click: () => mainWindow.webContents.send('menu-command', 'file-close-project') },
          ...drawingOpenMenu(getMenuLabel, recentMenu, command => mainWindow.webContents.send('menu-command', command)),
          { label: getMenuLabel('save', 'Save'), accelerator: 'CmdOrCtrl+S', enabled: canSave, click: () => mainWindow.webContents.send('menu-command', 'file-save') },
          ...(project ? [{ label: 'Save All', click: () => mainWindow.webContents.send('menu-command', 'file-save-all') }] : []),
          { label: getMenuLabel('saveAs', 'Save As...'), accelerator: 'CmdOrCtrl+Shift+S', enabled: canSaveAs, click: () => mainWindow.webContents.send('menu-command', 'file-save-as') },
          { label: getMenuLabel('saveWithoutResults', 'Save without results...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'file-save-without-results') },
          { type: 'separator' },
          {
            label: getMenuLabel('import', 'Import'),
            submenu: [
              { label: getMenuLabel('importImage', 'Image...'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'import-image') },
              { label: getMenuLabel('importKicadSymbols', 'KiCad Symbols...'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'import-kicad-symbols') },
            ],
          },
          {
            label: getMenuLabel('export', 'Export'),
            submenu: [
              { label: getMenuLabel('exportSvg', 'Export to SVG'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'file-export-svg') },
              { label: getMenuLabel('exportPdf', 'Export to PDF'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'file-export-pdf') },
            ],
          },
          { type: 'separator' },
          { label: getMenuLabel('print', 'Print'), accelerator: 'CmdOrCtrl+P', enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'file-print') },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' }
        ]
      },
      {
        label: getMenuLabel('edit', 'Edit'),
        submenu: [
          { label: getMenuLabel('undo', 'Undo'), accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu-command', 'edit-undo') },
          { label: getMenuLabel('redo', 'Redo'), accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => mainWindow.webContents.send('menu-command', 'edit-redo') },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          { label: getMenuLabel('rotateLeft', 'Rotate Left'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'edit-rotate-left') },
          { label: getMenuLabel('rotateRight', 'Rotate Right'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'edit-rotate-right') },
          { label: getMenuLabel('flipHorizontal', 'Flip Horizontal'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'edit-flip-h') },
          { label: getMenuLabel('flipVertical', 'Flip Vertical'), enabled: canvas, click: () => mainWindow.webContents.send('menu-command', 'edit-flip-v') }
        ]
      },
      {
        label: getMenuLabel('view', 'View'),
        submenu: drawingViewMenu(getMenuLabel, { ...viewMenuState, canvas }, isLibraryMode,
          command => mainWindow.webContents.send('menu-command', command))
      },
      ...(isLibraryMode ? [] : [{
        label: getMenuLabel('tools', 'Tools'),
        submenu: [
          { label: getMenuLabel('autoLayout', 'Auto-layout'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-auto-layout') },
          { label: getMenuLabel('annotateSymbols', 'Annotate Symbols...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-annotate') },
          { label: getMenuLabel('billOfMaterials', 'Bill of Materials...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-bom') },
          { type: 'separator' },
          { label: getMenuLabel('checkDesignRules', 'Check Design Rules'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-drc') },
          { type: 'separator' },
          { label: getMenuLabel('generateNetlist', 'Generate Netlist...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-netlist') },
          { label: getMenuLabel('generateSpiceNetlist', 'Generate Spice NetList'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-spice') },
          { label: getMenuLabel('createVhdlFile', 'Create VHDL file'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'tools-vhdl') },
        ]
      }]),
      ...(isLibraryMode ? [] : [{
        label: getMenuLabel('settings', 'Settings'),
        submenu: [
          { label: getMenuLabel('designDetails', 'Design Details...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'settings-design-details') },
          { label: getMenuLabel('pageSize', 'Page Size...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'settings-page-size') },
          { label: getMenuLabel('settingsDialog', 'Settings...'), click: () => mainWindow.webContents.send('menu-command', 'settings-settings') },
          { label: getMenuLabel('symbolPropertyFontDefaults', 'Default Symbol Attribute Fonts...'), enabled: design, click: () => mainWindow.webContents.send('menu-command', 'settings-symbol-property-fonts') },
          { label: getMenuLabel('colours', 'Colours...'), click: () => mainWindow.webContents.send('menu-command', 'settings-colours') },
        ]
      }]),
      {
        role: 'help',
        submenu: [
          { label: getMenuLabel('discord', 'Discord'), click: () => shell.openExternal('https://discord.gg/bdXnjhrSYQ') },
          { label: getMenuLabel('manual', 'Manual'), click: () => shell.openExternal('https://docs.tinycad.net/v4/') },
          ...(isMac ? [] : [
            { type: 'separator' },
            { label: getMenuLabel('aboutTinyCAD', 'About TinyCAD'), click: showAbout },
          ]),
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
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const chart = chartWindowOptions(details, mainWindow, windowIcon);
    if (chart) return chart;
    const { url } = details;
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

  mainWindow.webContents.on('did-create-window', (child, details) => {
    configureChartWindow(child, details, mainWindow);
  });

  // Check for command line arguments
  const qp = new URLSearchParams();
  if (openAbout) qp.set('about', '1');
  for (const arg of process.argv) {
    if (arg === '--new-library') {
      qp.set('action', 'new-library');
    } else if (arg.toLowerCase().endsWith('.tclib')) {
      qp.set('library', arg);
    } else if (isProjectFile(arg)) {
      projectToOpen = path.resolve(arg);
      qp.set('project', '1');
    } else if (isDrawingFile(arg)) {
      qp.set('file', arg);
    }
  }

  // Check for MacOS file open
  if (fileToOpen) {
    if (fileToOpen.toLowerCase().endsWith('.tclib')) {
      qp.set('library', fileToOpen);
    } else if (isProjectFile(fileToOpen)) {
      projectToOpen = path.resolve(fileToOpen);
      qp.set('project', '1');
    } else if (isDrawingFile(fileToOpen)) {
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
  let pendingAppQuit = false;

  const beforeQuitHandler = () => {
    pendingAppQuit = true;
  };

  app.on('before-quit', beforeQuitHandler);

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
    if (!shouldClose) {
      pendingAppQuit = false;
      return;
    }

    if (shouldClose) {
      isQuitting = true;

      if (pendingAppQuit) {
        app.quit();
        return;
      }

      mainWindow.close();
    }
  };

  ipcMain.on('app-closing-response', appClosingResponseHandler);
  mainWindow.on('closed', () => {
    app.removeListener('before-quit', beforeQuitHandler);
    ipcMain.removeListener('app-closing-response', appClosingResponseHandler);
  });

  // Open the DevTools.
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;
    registerSimulation();
    registerProjectFiles({
      ipcMain, getWindow: () => mainWindow, dialog, shell, store,
      documents: app.getPath('documents'), onRecentProjectsChanged: () => refreshMenu(),
      openLibrary: spawnNewWindow,
      takeProjectOpen: () => {
        const filename = projectToOpen;
        projectToOpen = null;
        return filename;
      },
    });
    registerLicenseHandlers({ ipcMain, app, shell, getWindow: () => mainWindow });
    registerBundledExamples({ ipcMain, getWindow: () => mainWindow,
      directory: path.join(__dirname, '../dist/bundled-examples') });
    registerBundledLibraries({ ipcMain, getWindow: () => mainWindow, store,
      directory: unpackedResource(path.join(__dirname, isDev ? '../bundled-libraries' : '../dist/bundled-libraries')) });
    registerChatSecretHandlers(ipcMain, { app, safeStorage });
    registerOnlineLibrary({ ipcMain, app, getWindow: () => mainWindow,
      send: (url, options) => net.fetch(url, options) });
    registerChatGPTHandlers(ipcMain, { app, shell, safeStorage });

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

      loadFile(mainWindow, file, isLibraryMode, spawnNewWindow, queueProjectOpen);
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

    ipcMain.on('set-editor-menu-state', (event, state) => {
      if (!mainWindow || event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame ||
          !['design', 'text', 'image', 'pdf', 'bom', 'web', 'empty'].includes(state?.editor)) return;
      const project = state.project === true;
      if (project === editorMenuState.project && state.editor === editorMenuState.editor) return;
      editorMenuState = { project, editor: state.editor };
      refreshMenu();
    });

    ipcMain.on('set-view-menu-state', (event, state) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || !state || typeof state !== 'object') return;
      const next = {
        hasExampleExplanation: state.hasExampleExplanation === true,
        exampleExplanationVisible: state.exampleExplanationVisible === true,
        simulationPanelVisible: state.simulationPanelVisible === true,
      };
      if (Object.keys(next).some(key => next[key] !== viewMenuState[key])) {
        viewMenuState = next;
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

    ipcMain.handle('import-image-file', async () => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'apng'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const selectedPath = result.filePaths[0];
      const extension = path.extname(selectedPath).toLowerCase();
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
        '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
        '.apng': 'image/apng' })[extension] || 'application/octet-stream';
      const content = await fs.promises.readFile(selectedPath);
      return { fileName: path.basename(selectedPath), mime, content: content.toString('base64') };
    });

    ipcMain.handle('import-kicad-file', async () => {
      if (!mainWindow) {
        return null;
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'KiCad Symbols and SPICE files', extensions: [
          'kicad_sym', 'lib', 'cir', 'sub', 'mod', 'model', 'spice', 'sp', 'spi', 'inc', 'txt',
        ] }],
        properties: ['openFile', 'multiSelections'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const libraries = result.filePaths.filter((file) => /\.kicad_sym$/i.test(file));
      if (libraries.length !== 1)
        throw new Error('Select one KiCad symbol library and any accompanying SPICE files.');
      const [selectedPath] = libraries;
      const modelFiles = await Promise.all(result.filePaths.filter((file) => file !== selectedPath).map(async (file) => {
        if ((await fs.promises.stat(file)).size > 8 * 1024 * 1024)
          throw new Error('An accompanying SPICE file exceeds 8 MiB.');
        return { fileName: path.basename(file), content: await fs.promises.readFile(file, 'utf8') };
      }));
      const content = await fs.promises.readFile(selectedPath, 'utf8');
      return {
        fileName: path.basename(selectedPath),
        content,
        modelFiles,
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
      }));
    });

    ipcMain.handle('print-document', async (event, options) => {
      if (!mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Print requests must come from the TinyCAD window');
      }

      if (options.printerName) {
        const printers = await event.sender.getPrintersAsync();
        if (!printers.some(printer => printer.name === options.printerName)) {
          return { success: false, printerUnavailable: true };
        }
      }

      const printWindow = new BrowserWindow({
        show: false,
        parent: mainWindow,
        title: 'TinyCAD',
        icon: getWindowIconPath(),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      try {
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(options.html)}`);
        if (process.platform === 'linux') {
          // The loaded document has its images. Flush layout to start any font
          // loads without waiting for animation frames from the hidden window.
          await printWindow.webContents.executeJavaScript(`
            (async () => {
              document.body.getBoundingClientRect();
              await document.fonts.ready;
            })()
          `);
        } else {
          const waitForPrintLayout = () => printWindow.webContents.executeJavaScript(`
            new Promise((resolve) => {
              const waitForImages = Promise.all(
                Array.from(document.images || []).map((image) => {
                  if (image.complete) {
                    return Promise.resolve();
                  }

                  return new Promise((imageResolve) => {
                    image.addEventListener('load', imageResolve, { once: true });
                    image.addEventListener('error', imageResolve, { once: true });
                  });
                })
              );

              const waitForFonts = document.fonts?.ready ?? Promise.resolve();

              Promise.all([waitForImages, waitForFonts]).then(() => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(resolve);
                });
              });
            });
          `);
          await waitForPrintLayout();
        }

        const printOptions = {
          silent: true,
          copies: options.copies,
          landscape: options.landscape,
          printBackground: true,
          ...(options.printerName && { deviceName: options.printerName }),
          ...(options.pageSize ? { pageSize: options.pageSize } : { usePrinterDefaultPageSize: true }),
          ...(options.color !== undefined && { color: options.color }),
          ...(options.duplexMode && { duplexMode: options.duplexMode }),
        };

        return await new Promise(resolve => {
          printWindow.webContents.print(printOptions, (success, failureReason) => {
            resolve({ success, failureReason });
          });
        });
      } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy();
      }
    });

    ipcMain.handle('open-print-pdf', async (event, content) => {
      if (!mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Print requests must come from the TinyCAD window');
      }

      const pdf = Buffer.from(content, 'base64');
      if (pdf.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('The print document is not a PDF');
      }
      const directory = path.join(app.getPath('temp'), 'TinyCAD-Print');
      await fs.promises.mkdir(directory, { recursive: true });

      // Keep recent files available to PDF viewers and prune older previews.
      const expiresBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const files = await fs.promises.readdir(directory);
      await Promise.allSettled(files.filter(name => /^TinyCAD-[\da-f-]{36}\.pdf$/.test(name)).map(async name => {
        const file = path.join(directory, name);
        const info = await fs.promises.lstat(file);
        if (info.isFile() && info.mtimeMs < expiresBefore) await fs.promises.unlink(file);
      }));

      const file = path.join(directory, `TinyCAD-${randomUUID()}.pdf`);
      await fs.promises.writeFile(file, pdf, { flag: 'wx', mode: 0o600 });
      try {
        if (process.platform === 'linux') {
          const { openPdfPrintWindow } = await import('./printPdf.js');
          await openPdfPrintWindow(mainWindow, file);
          return true;
        }

        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      } catch (error) {
        await fs.promises.unlink(file).catch(() => {});
        throw error;
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

    if (isProjectFile(filePath)) {
      queueProjectOpen(filePath);
    } else if (isDrawingFile(filePath)) {
      loadFile(mainWindow, filePath, isLibraryMode, spawnNewWindow);
    } else if (filePath.toLowerCase().endsWith('.tclib')) {
      loadLibrary(mainWindow, filePath);
    }
  } else {
    fileToOpen = filePath;
  }
});

app.whenReady().then(() => {
  app.setName(appDisplayName);

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

