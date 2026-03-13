import { dialog } from "electron";
import fs from "fs";
import path from "path";
import Store from 'electron-store';
import { error } from "./io.js";


const store = new Store();

function serializeLibraryError(error, fallbackSummary = 'Unable to load library.') {
    const summary = error?.message || fallbackSummary;
    const details = [
        error?.code ? `Code: ${error.code}` : null,
        error?.syscall ? `Operation: ${error.syscall}` : null,
        error?.path ? `Path: ${error.path}` : null,
        error?.stack || null,
    ].filter((part) => typeof part === 'string' && part.trim().length > 0);

    return {
        summary,
        details: details.length > 0 ? details.join('\n\n') : undefined,
    };
}

function getDeduplicatedLibraries() {
    const libraries = store.get('libraries') || [];
    const seen = new Set();
    const deduplicated = [];

    for (const file of libraries) {
        if (typeof file !== 'string') {
            continue;
        }
        if (!seen.has(file)) {
            seen.add(file);
            deduplicated.push(file);
        }
    }

    if (deduplicated.length !== libraries.length) {
        store.set('libraries', deduplicated);
    }

    return deduplicated;
}

export function loadLibrary(mainWindow, file) {
    if (typeof file === 'string') {
        readFileInternal(mainWindow, file);
    }
    else if (file?.id) {
        readFileInternal(mainWindow, file.id, {
            silent: !!file.silent,
            name: file.name,
        });
    }
    else {
        dialog.showOpenDialog({
            filters: [
                { name: 'TinyCAD libraries', extensions: ['tclib'] },
            ],
            properties: ['openFile']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                const currentFilePath = result.filePaths[0];
                readFileInternal(mainWindow, currentFilePath);
            }
        });
    }
}

function readFileInternal(mainWindow, currentFilePath, options = {}) {
    fs.readFile(currentFilePath, null, (err, data) => {
        if (!err) {
            const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const stats = fs.statSync(currentFilePath);
            addLibrary(mainWindow, currentFilePath);
            mainWindow.webContents.send('library-loaded', { name: path.basename(currentFilePath), id: currentFilePath, content: arrayBuffer, lastModified: stats.mtime });
        }
        else {
            if (options.silent) {
                mainWindow.webContents.send('library-load-failed', {
                    name: options.name || path.basename(currentFilePath),
                    id: currentFilePath,
                    error: serializeLibraryError(err),
                });
            } else {
                error(mainWindow, err);
            }
        }
    });
}

// Load library and send to a specific webContents (for popup windows)
export function loadLibraryToWebContents(webContents, mainWindow, file) {
    if (file?.id) {
        fs.readFile(file.id, null, (err, data) => {
            if (!err) {
                const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                const stats = fs.statSync(file.id);
                addLibrary(mainWindow, file.id);
                webContents.send('library-loaded', { name: path.basename(file.id), id: file.id, content: arrayBuffer, lastModified: stats.mtime });
            }
        });
    }
}

export function saveLibrary(mainWindow, data) {
    if (data.id) {
        saveFileInternal(mainWindow, data.id, data.content);
    }
    else {
        dialog.showSaveDialog({
            filters: [{ name: 'TinyCAD libraries', extensions: ['tclib'] }],
            defaultPath: !!data.folderId ? data.folderId : undefined,
        }).then(result => {
            if (!result.canceled && result.filePath) {
                saveFileInternal(mainWindow, result.filePath, data.content);
            }
            else {
                mainWindow.webContents.send('library-saved', { success: false });
            }
        });
    }
}

function saveFileInternal(mainWindow, currentFilePath, content) {
    // Check for double extension
    if (currentFilePath.toLowerCase().endsWith('.tclib.tclib')) {
        currentFilePath = currentFilePath.slice(0, -6);
    }

    const buffer = Buffer.from(content);
    fs.writeFile(currentFilePath, buffer, null, err => {
        if (err) {
            mainWindow.webContents.send('library-saved', { success: false });
            error(mainWindow, err);
        } else {
            addLibrary(mainWindow, currentFilePath);
            mainWindow.webContents.send('library-saved', { success: true, name: path.basename(currentFilePath), id: currentFilePath });
        }
    });
}

function addLibrary(mainWindow, filePath) {
    let libraries = getDeduplicatedLibraries();
    if (!libraries.includes(filePath)) {
        libraries.unshift(filePath);
        store.set('libraries', libraries);
        sendLibraries(mainWindow);
    }
}

export function removeLibrary(mainWindow, filePath) {
    let libraries = getDeduplicatedLibraries();
    libraries = libraries.filter(file => file !== filePath);
    store.set('libraries', libraries);
    sendLibraries(mainWindow);
}

export function sendLibraries(mainWindow) {
    const libraries = getDeduplicatedLibraries();
    if (!!libraries) {
        mainWindow.webContents.send('libraries',
            libraries.map(file => {
                try {
                    const stats = fs.statSync(file);
                    return {
                        name: path.basename(file),
                        id: file,
                        lastModified: stats.mtime,
                        bad: false,
                    };
                } catch (err) {
                    // If metadata cannot be read (e.g. file missing), mark as bad.
                    return {
                        name: path.basename(file),
                        id: file,
                        bad: true,
                        error: serializeLibraryError(err, 'Unable to access library file.'),
                    };
                }
            }));
    }
}
