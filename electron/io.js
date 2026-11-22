import { createHash } from 'node:crypto';
import { isBoardFile, boardFileName, isDrawingFile, drawingFileName, isCompressedDrawing } from '../shared/drawingFiles.js';
import { isProjectFile } from '../shared/projectFiles.js';
import { dialog } from "electron";
import fs from "fs";
import path from "path";
import Store from 'electron-store';


const store = new Store();

export function loadFile(mainWindow, file, isLibraryMode, openNewWindow, openProject) {
    if (typeof file === 'string') {
        processLoadFile(mainWindow, file, isLibraryMode, openNewWindow);
    }
    else if (file?.id) {
        processLoadFile(mainWindow, file.id, isLibraryMode, openNewWindow);
    }
    else {
        dialog.showOpenDialog({
            filters: [
                { name: 'TinyCAD Design Files', extensions: ['dsn', 'dzn', 'dpn'] },
                { name: 'TinyCAD projects', extensions: ['tcproject'] },
                { name: 'TinyCAD Libraries', extensions: ['tclib'] }
            ],
            properties: ['openFile']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const currentFilePath = result.filePaths[0];
                if (isProjectFile(currentFilePath)) openProject(currentFilePath);
                else processLoadFile(mainWindow, currentFilePath, isLibraryMode, openNewWindow);
            }
        });
    }
}

function processLoadFile(mainWindow, filePath, isLibraryMode, openNewWindow) {
    const isLib = filePath.toLowerCase().endsWith('.tclib');
    const isDesign = isDrawingFile(filePath) || isBoardFile(filePath);

    if (isLib) {
        // Libraries always open in new instance
        openNewWindow(filePath);
        return;
    }

    if (isDesign && isLibraryMode) {
        // DSN files in library mode open in new instance
        openNewWindow(filePath);
        return;
    }

    // Otherwise load normally
    readFileInternal(mainWindow, filePath);
}

function readFileInternal(mainWindow, currentFilePath) {
    fs.readFile(currentFilePath, (err, data) => {
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
    const pcb = isBoardFile(data.name);
    const compressed = !pcb && isCompressedDrawing(data.content);
    const normalizePath = pcb ? boardFileName : (filename) => drawingFileName(filename, compressed);
    const name = normalizePath(data.name);
    const folder = data.id ? path.dirname(data.id) : typeof data.folderId === 'string' ? ((isDrawingFile(data.folderId) || isBoardFile(data.folderId)) ? path.dirname(data.folderId) : data.folderId) : '';
    if (data.id && path.basename(data.id) === name) {
        saveFileInternal(mainWindow, data.id, data.content, normalizePath, pcb ? data.expectedVersion : undefined);
    }
    else {
        dialog.showSaveDialog({
            filters: [{ name: pcb ? 'TinyCAD PCB boards' : compressed ? 'TinyCAD compressed drawings' : 'TinyCAD drawings', extensions: [pcb ? 'dpn' : compressed ? 'dzn' : 'dsn'] }],
            defaultPath: path.join(folder, name),
        }).then(result => {
            if (!result.canceled && result.filePath) {
                saveFileInternal(mainWindow, result.filePath, data.content, normalizePath);
            }
            else {
                mainWindow.webContents.send('file-saved', { success: false });
            }
        });
    }
}

function saveFileInternal(mainWindow, currentFilePath, content, normalizePath, expectedVersion) {
    const normalizedPath = normalizePath(currentFilePath);
    if (normalizedPath !== currentFilePath && fs.existsSync(normalizedPath)) {
        mainWindow.webContents.send('file-saved', { success: false });
        dialog.showErrorBox('Drawing already exists', `Save again using ${normalizedPath} to confirm replacing that file.`);
        return;
    }
    currentFilePath = normalizedPath;

    const temporary = `${currentFilePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFile(temporary, content, { flag: 'wx', flush: true }, err => {
        if (!err) {
            try {
                if (expectedVersion) {
                    const current = fs.readFileSync(currentFilePath);
                    if (createHash('sha256').update(current).digest('hex') !== expectedVersion)
                        throw new Error('This PCB changed on disk. Reopen it or use Save As.');
                }
                fs.renameSync(temporary, currentFilePath);
            } catch (failure) { err = failure; }
        }
        if (err) { try { fs.unlinkSync(temporary); } catch {} }
        if (err) {
            mainWindow.webContents.send('file-saved', { success: false, error: err.message });
            if (!expectedVersion) error(mainWindow, err);
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
