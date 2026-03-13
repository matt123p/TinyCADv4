import { dialog } from "electron";
import fs from "fs";
import path from "path";
import Store from 'electron-store';


const store = new Store();

export function loadFile(mainWindow, file, isLibraryMode, openNewWindow) {
    if (typeof file === 'string') {
        processLoadFile(mainWindow, file, isLibraryMode, openNewWindow);
    }
    else if (file?.id) {
        processLoadFile(mainWindow, file.id, isLibraryMode, openNewWindow);
    }
    else {
        dialog.showOpenDialog({
            filters: [
                { name: 'TinyCAD Drawings', extensions: ['dsn'] },
                { name: 'TinyCAD Libraries', extensions: ['tclib'] }
            ],
            properties: ['openFile']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const currentFilePath = result.filePaths[0];
                processLoadFile(mainWindow, currentFilePath, isLibraryMode, openNewWindow);
            }
        });
    }
}

function processLoadFile(mainWindow, filePath, isLibraryMode, openNewWindow) {
    const isLib = filePath.toLowerCase().endsWith('.tclib');
    const isDsn = filePath.toLowerCase().endsWith('.dsn');

    if (isLib) {
        // Libraries always open in new instance
        openNewWindow(filePath);
        return;
    }

    if (isDsn && isLibraryMode) {
        // DSN files in library mode open in new instance
        openNewWindow(filePath);
        return;
    }

    // Otherwise load normally
    readFileInternal(mainWindow, filePath);
}

function readFileInternal(mainWindow, currentFilePath) {
    fs.readFile(currentFilePath, 'utf8', (err, data) => {
        if (!err) {
            addRecentFile(mainWindow, currentFilePath);
            mainWindow.webContents.send('file-loaded', { name: path.basename(currentFilePath), id: currentFilePath, content: data });
        }
        else {
            removeRecentFile(mainWindow, currentFilePath);
            error(mainWindow, err);
        }
    });
}

export function saveFile(mainWindow, data) {
    if (data.id) {
        saveFileInternal(mainWindow, data.id, data.content);
    }
    else {
        dialog.showSaveDialog({
            filters: [{ name: 'TinyCAD drawings', extensions: ['dsn'] }],
            defaultPath: !!data.folderId ? data.folderId : undefined,
        }).then(result => {
            if (!result.canceled && result.filePath) {
                saveFileInternal(mainWindow, result.filePath, data.content);
            }
            else {
                mainWindow.webContents.send('file-saved', { success: false });
            }
        });
    }
}

function saveFileInternal(mainWindow, currentFilePath, content) {
    // Check for double extension
    if (currentFilePath.toLowerCase().endsWith('.dsn.dsn')) {
        currentFilePath = currentFilePath.slice(0, -4);
    }

    fs.writeFile(currentFilePath, content, 'utf8', err => {
        if (err) {
            mainWindow.webContents.send('file-saved', { success: false });
            error(mainWindow, err);
        } else {
            addRecentFile(mainWindow, currentFilePath);
            mainWindow.webContents.send('file-saved', { success: true, name: path.basename(currentFilePath), id: currentFilePath });
        }
    });
}

function addRecentFile(mainWindow, filePath) {
    let recentFiles = store.get('recentFiles') || [];
    
    // Remove if already exists (so we can move to top)
    recentFiles = recentFiles.filter(file => file !== filePath);
    
    recentFiles.unshift(filePath);
    if (recentFiles.length > 10) {
        recentFiles.pop();
    }
    store.set('recentFiles', recentFiles);
    sendRecentFiles(mainWindow);
}

function removeRecentFile(mainWindow, filePath) {
    let recentFiles = store.get('recentFiles') || [];
    recentFiles = recentFiles.filter(file => file !== filePath);
    store.set('recentFiles', recentFiles);
    sendRecentFiles(mainWindow);
}

export function sendRecentFiles(mainWindow) {
    const recent_files = store.get('recentFiles');
    if (!!recent_files) {
        mainWindow.webContents.send('recent-files',
            recent_files.map(file => ({ name: path.basename(file), id: file })));
    }
}

export function error(mainWindow, error) {
    dialog.showErrorBox('Error', JSON.stringify(error));

}
