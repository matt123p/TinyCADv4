const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    loadFile: (file) => ipcRenderer.send('load-file', file),
    saveFile: (data) => ipcRenderer.send('save-file', data),
    loadLibrary: (file) => ipcRenderer.send('load-library', file),
    saveLibrary: (data) => ipcRenderer.send('save-library', data),
    removeLibrary: (data) => ipcRenderer.send('remove-library', data),
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
    
    onPdfSaved: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('pdf-saved', listener);
        return () => ipcRenderer.removeListener('pdf-saved', listener);
    },
});

