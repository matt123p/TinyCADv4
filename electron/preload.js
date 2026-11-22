const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    licenseIndex: () => ipcRenderer.invoke('licenses-index'),
    readLicense: (file) => ipcRenderer.invoke('licenses-read', file),
    openChromiumLicenses: () => ipcRenderer.invoke('licenses-open-chromium'),
    onlineLibraryRequest: (resource) => ipcRenderer.invoke('online-library-request', resource),
    chatSecret: (operation, value) => ipcRenderer.invoke('chat-secret', { operation, value }),
    chatgptAccount: (operation, args) => ipcRenderer.invoke('chatgpt-account', { operation, args }),
    chatgptRequest: (request) => ipcRenderer.invoke('chatgpt-request', request),
    cancelChatGPTRequest: (id) => ipcRenderer.send('chatgpt-cancel', id),
    onChatGPTStream: (callback) => {
        const listener = (_, event) => callback(event);
        ipcRenderer.on('chatgpt-stream', listener);
        return () => ipcRenderer.removeListener('chatgpt-stream', listener);
    },
    onMenuCommand: (callback) => {
        const listener = (_, command) => callback(command);
        ipcRenderer.on('menu-command', listener);
        return () => ipcRenderer.removeListener('menu-command', listener);
    },
    onMenuCommandWithData: (callback) => {
        const listener = (_, command, data) => callback(command, data);
        ipcRenderer.on('menu-command-with-data', listener);
        return () => ipcRenderer.removeListener('menu-command-with-data', listener);
    },
    showContextMenu: (menuItems) => ipcRenderer.send('show-context-menu', menuItems),
    onContextMenuCommand: (callback) => {
        const listener = (_, command) => callback(command);
        ipcRenderer.on('context-menu-command', listener);
        return () => ipcRenderer.removeListener('context-menu-command', listener);
    },
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    setTitle: (title) => ipcRenderer.send('window-set-title', title),
    projectFiles: (request) => ipcRenderer.invoke('project-files', request),
    onProjectFoldersChanged: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('project-folders-changed', listener);
        return () => ipcRenderer.removeListener('project-folders-changed', listener);
    },
    loadFile: (file) => ipcRenderer.send('load-file', file),
    saveFile: (data) => ipcRenderer.send('save-file', data),
    exampleCatalog: () => ipcRenderer.invoke('bundled-example-catalog'),
    readExampleResource: (path) => ipcRenderer.invoke('bundled-example-read', path),
    bundledLibraryCatalog: () => ipcRenderer.invoke('bundled-library-catalog'),
    readBundledLibrary: (id) => ipcRenderer.invoke('bundled-library-read', id),
    bundledLibrarySelection: (ids) => ipcRenderer.invoke('bundled-library-selection', ids),
    loadLibrary: (file) => ipcRenderer.send('load-library', file),
    saveLibrary: (data) => ipcRenderer.send('save-library', data),
    removeLibrary: (data) => ipcRenderer.send('remove-library', data),
    saveLibraryConfig: (config) => ipcRenderer.send('save-library-config', config),
    setViewMenuState: (state) => ipcRenderer.send('set-view-menu-state', state),
    setBoardMenus: (menus) => ipcRenderer.send('set-board-menus', menus),
    setMenuMode: (mode) => ipcRenderer.send('set-menu-mode', mode),
    setMenuTranslations: (translations) => ipcRenderer.send('set-menu-translations', translations),

    fileLoaded: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };
        ipcRenderer.on('file-loaded', listener);
        return () => {
            ipcRenderer.removeListener('file-loaded', listener);
        };
    },

    fileSaved: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };

        ipcRenderer.on('file-saved', listener);
        return () => {
            ipcRenderer.removeListener('file-saved', listener); // Unsubscribe function
        };
    },

    recentFiles: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };
        ipcRenderer.on('recent-files', listener);
        return () => {
            ipcRenderer.removeListener('recent-files', listener);
        };
    },

    libraryLoaded: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };
        ipcRenderer.on('library-loaded', listener);
        return () => {
            ipcRenderer.removeListener('library-loaded', listener); // Unsubscribe function
        };
    },

    libraryLoadFailed: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };
        ipcRenderer.on('library-load-failed', listener);
        return () => {
            ipcRenderer.removeListener('library-load-failed', listener);
        };
    },

    librarySaved: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };

        ipcRenderer.on('library-saved', listener);
        return () => {
            ipcRenderer.removeListener('library-saved', listener); // Unsubscribe function
        };
    },

    libraries: (callback) => {
        const listener = (event, data) => {
            callback(data);
        };
        ipcRenderer.on('libraries', listener);
        return () => {
            ipcRenderer.removeListener('libraries', listener);
        };
    },

    refreshLibraries: () => ipcRenderer.send('refresh-libraries'),

    onAppClosing: (callback) => {
        const listener = (event) => {
            callback();
        };
        ipcRenderer.on('app-closing', listener);
        return () => {
            ipcRenderer.removeListener('app-closing', listener);
        };
    },

    sendAppClosingResponse: (response) => ipcRenderer.send('app-closing-response', response),

    startSimulation: request => ipcRenderer.invoke('simulation-start', request),
    stopSimulation: runId => ipcRenderer.send('simulation-stop', runId),
    onSimulation: callback => {
        const listener = (_, id, event) => callback(id, event);
        ipcRenderer.on('simulation-event', listener);
        return () => ipcRenderer.removeListener('simulation-event', listener);
    },
    // Print a PDF using native print dialog (fallback - prints main window)
    printPdf: (pdfBase64) => ipcRenderer.send('print-pdf', pdfBase64),
    
    // Get list of available printers
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    
    // Print HTML content to a specific printer (uses our custom preview dialog)
    printDocument: (options) => ipcRenderer.send('print-document', options),

    openNewWindow: (arg) => ipcRenderer.send('open-new-window', arg),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    openContainingFolder: (filePath) => ipcRenderer.send('open-containing-folder', filePath),
    
    onPrintComplete: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('print-complete', listener);
        return () => ipcRenderer.removeListener('print-complete', listener);
    },

    // Save a PDF file using native save dialog
    savePdf: (data) => ipcRenderer.send('save-pdf', data),
    saveSvg: (data) => ipcRenderer.send('save-svg', data),
    openKicadImport: () => ipcRenderer.invoke('import-kicad-file'),
    openImageImport: () => ipcRenderer.invoke('import-image-file'),
    
    onPdfSaved: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('pdf-saved', listener);
        return () => ipcRenderer.removeListener('pdf-saved', listener);
    },
});

