import { dialog } from "electron";
import fs from "fs";
import path from "path";
import Store from 'electron-store';
import { error } from "./io.js";


const store = new Store();

function normalizeFolderId(folderId) {
    return typeof folderId === 'string' && folderId.trim().length > 0
        ? folderId.trim()
        : null;
}

function normalizeLibraryFolder(folder) {
    if (!folder || typeof folder !== 'object') {
        return null;
    }

    const id = typeof folder.id === 'string' ? folder.id.trim() : '';
    if (id.length === 0) {
        return null;
    }

    const name = typeof folder.name === 'string' && folder.name.trim().length > 0
        ? folder.name.trim()
        : id;

    return { id, name };
}

function normalizeLibraryEntry(entry) {
    if (typeof entry === 'string') {
        return {
            id: entry,
            name: path.basename(entry),
            folderId: null,
        };
    }

    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id.length === 0) {
        return null;
    }

    return {
        id,
        name: typeof entry.name === 'string' && entry.name.trim().length > 0
            ? entry.name.trim()
            : path.basename(id),
        folderId: normalizeFolderId(entry.folderId),
    };
}

function getNormalizedLibraryConfig() {
    const rawLibraries = store.get('libraries') || [];
    const rawFolders = store.get('libraryFolders') || [];

    const seenFolders = new Set();
    const libraryFolders = [];
    for (const folder of rawFolders) {
        const normalized = normalizeLibraryFolder(folder);
        if (!normalized || seenFolders.has(normalized.id)) {
            continue;
        }

        seenFolders.add(normalized.id);
        libraryFolders.push(normalized);
    }

    const seenLibraries = new Set();
    const libraries = [];
    for (const entry of rawLibraries) {
        const normalized = normalizeLibraryEntry(entry);
        if (!normalized || seenLibraries.has(normalized.id)) {
            continue;
        }

        seenLibraries.add(normalized.id);
        libraries.push({
            ...normalized,
            folderId: normalized.folderId && seenFolders.has(normalized.folderId)
                ? normalized.folderId
                : null,
        });
    }

    const needsMigration =
        libraryFolders.length !== rawFolders.length ||
        libraries.length !== rawLibraries.length ||
        rawLibraries.some((entry, index) => {
            const normalized = libraries[index];
            if (!normalized) {
                return true;
            }

            if (typeof entry === 'string') {
                return true;
            }

            return entry.id !== normalized.id ||
                entry.name !== normalized.name ||
                normalizeFolderId(entry.folderId) !== normalized.folderId;
        });

    if (needsMigration) {
        store.set('libraries', libraries);
        store.set('libraryFolders', libraryFolders);
    }

    return {
        libraries,
        libraryFolders,
    };
}

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

export function loadLibrary(mainWindow, file) {
    if (typeof file === 'string') {
        readFileInternal(mainWindow, file);
    }
    else if (file?.id) {
        readFileInternal(mainWindow, file.id, {
            silent: !!file.silent,
            name: file.name,
            folderId: file.folderId,
        });
    }
    else {
        dialog.showOpenDialog({
            filters: [
                { name: 'TinyCAD libraries', extensions: ['tclib'] },
            ],
            properties: ['openFile', 'multiSelections']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                for (const currentFilePath of result.filePaths) {
                    readFileInternal(mainWindow, currentFilePath, {
                        folderId: file?.folderId,
                    });
                }
            }
        });
    }
}

function readFileInternal(mainWindow, currentFilePath, options = {}) {
    fs.readFile(currentFilePath, null, (err, data) => {
        if (!err) {
            const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const stats = fs.statSync(currentFilePath);
            addLibrary(mainWindow, currentFilePath, options.folderId);
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
                addLibrary(mainWindow, file.id, file.folderId);
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

function addLibrary(mainWindow, filePath, folderId = null) {
    const config = getNormalizedLibraryConfig();
    const normalizedFolderId = normalizeFolderId(folderId);
    const existingIndex = config.libraries.findIndex((library) => library.id === filePath);

    if (existingIndex >= 0) {
        const existing = config.libraries[existingIndex];
        const updated = {
            ...existing,
            name: path.basename(filePath),
            folderId: normalizedFolderId != null ? normalizedFolderId : existing.folderId,
        };

        const changed =
            existing.name !== updated.name ||
            existing.folderId !== updated.folderId;

        if (changed) {
            const libraries = [...config.libraries];
            libraries.splice(existingIndex, 1, updated);
            store.set('libraries', libraries);
            sendLibraries(mainWindow);
        }
        return;
    }

    const libraries = [
        {
            id: filePath,
            name: path.basename(filePath),
            folderId: normalizedFolderId,
        },
        ...config.libraries,
    ];
    store.set('libraries', libraries);
    sendLibraries(mainWindow);
}

export function removeLibrary(mainWindow, filePath) {
    const config = getNormalizedLibraryConfig();
    store.set('libraries', config.libraries.filter((file) => file.id !== filePath));
    sendLibraries(mainWindow);
}

export function saveLibraryConfig(mainWindow, config) {
    const normalized = {
        ...getNormalizedLibraryConfig(),
        ...config,
    };

    const parsed = getNormalizedLibraryConfigFromPayload(normalized);
    store.set('libraries', parsed.libraries);
    store.set('libraryFolders', parsed.libraryFolders);
    sendLibraries(mainWindow);
}

function getNormalizedLibraryConfigFromPayload(config) {
    const rawLibraries = Array.isArray(config?.libraries) ? config.libraries : [];
    const rawFolders = Array.isArray(config?.libraryFolders) ? config.libraryFolders : [];

    const seenFolders = new Set();
    const libraryFolders = [];
    for (const folder of rawFolders) {
        const normalized = normalizeLibraryFolder(folder);
        if (!normalized || seenFolders.has(normalized.id)) {
            continue;
        }

        seenFolders.add(normalized.id);
        libraryFolders.push(normalized);
    }

    const seenLibraries = new Set();
    const libraries = [];
    for (const entry of rawLibraries) {
        const normalized = normalizeLibraryEntry(entry);
        if (!normalized || seenLibraries.has(normalized.id)) {
            continue;
        }

        seenLibraries.add(normalized.id);
        libraries.push({
            ...normalized,
            folderId: normalized.folderId && seenFolders.has(normalized.folderId)
                ? normalized.folderId
                : null,
        });
    }

    return {
        libraries,
        libraryFolders,
    };
}

export function sendLibraries(mainWindow) {
    const config = getNormalizedLibraryConfig();
    if (!!config.libraries) {
        mainWindow.webContents.send('libraries', {
            libraryFolders: config.libraryFolders,
            libraries: config.libraries.map(file => {
                try {
                    const stats = fs.statSync(file.id);
                    return {
                        name: file.name,
                        id: file.id,
                        folderId: file.folderId,
                        lastModified: stats.mtime,
                        bad: false,
                    };
                } catch (err) {
                    // If metadata cannot be read (e.g. file missing), mark as bad.
                    return {
                        name: file.name,
                        id: file.id,
                        folderId: file.folderId,
                        bad: true,
                        error: serializeLibraryError(err, 'Unable to access library file.'),
                    };
                }
            }),
        });
    }
}
