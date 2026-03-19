export { };

interface ElectronLibraryLoadError {
    summary: string;
    details?: string;
}

declare global {
    interface Window {
        electronAPI: {
            onMenuCommand: (callback: (command: string) => void) => () => void;
            onMenuCommandWithData: (callback: (command: string, data: any) => void) => () => void;
            // Context menu
            showContextMenu: (menuItems: any[]) => void;
            onContextMenuCommand: (callback: (command: string) => void) => () => void;
            // Send to Electron shell
            minimize: () => void;
            maximize: () => void;
            close: () => void;
            setTitle: (title: string) => void;

            // Files
            loadFile: (file?: { name: string, id: string }) => void;
            saveFile: (data: {
                name: string;
                id: FileIdType | string;
                folderId: FileIdType | string;
                content: string
            }) => void;

            // Libraries
            loadLibrary: (file?: { name?: string, id?: string, silent?: boolean, folderId?: string | null }) => void;
            saveLibrary: (data: {
                name: string;
                id: FileIdType | string;
                folderId: FileIdType | string;
                content: ArrayBuffer
            }) => void;
            removeLibrary: (file: string) => void;
            saveLibraryConfig: (config: {
                libraries: { name: string, id: string, folderId?: string | null }[];
                libraryFolders: { id: string, name: string }[];
            }) => void;
            setMenuMode: (mode: boolean) => void;
            setMenuTranslations: (translations: Record<string, string>) => void;

            // Callbacks
            fileLoaded: (callback: (data: { content: string, name: string, id: string }) => void) => () => void;
            fileSaved: (callback: (data: { success: boolean, name: string, id: string }) => void) => () => void;
            recentFiles: (callback: (data: { name: string, id: string }[]) => void) => () => void;
            libraryLoaded: (callback: (data: { content: ArrayBuffer, name: string, id: string, lastModified?: Date | string }) => void) => () => void;
            libraryLoadFailed: (callback: (data: { id: string, name: string, error: ElectronLibraryLoadError }) => void) => () => void;
            librarySaved: (callback: (data: { success: boolean, name: string, id: string }) => void) => () => void;
            libraries: (callback: (data: {
                libraries: { name: string, id: string, folderId?: string | null, lastModified?: Date | string, bad?: boolean, error?: ElectronLibraryLoadError }[];
                libraryFolders: { id: string, name: string }[];
            }) => void) => () => void;
            refreshLibraries: () => void;
            onAppClosing: (callback: () => void) => () => void;
            sendAppClosingResponse: (saveNeeded: boolean) => void;
            
            // PDF printing and export
            printPdf: (pdfBase64: string) => void;
            getPrinters: () => Promise<{ name: string; displayName: string; isDefault: boolean }[]>;
            printDocument: (options: { html: string; printerName: string; copies?: number; landscape?: boolean }) => void;
            onPrintComplete: (callback: (data: { success: boolean, failureReason?: string }) => void) => () => void;
            savePdf: (data: { content: string, name: string }) => void;
            saveSvg: (data: { content: string, name: string }) => void;
            onPdfSaved: (callback: (data: { success: boolean, path?: string, error?: string, cancelled?: boolean }) => void) => () => void;
            openKicadImport: () => Promise<{ fileName: string, content: string } | null>;

            // Window management
            openNewWindow: (arg: string) => void;

            // External links
            openExternal: (url: string) => void;
            openContainingFolder: (filePath: string) => void;
        };
    }
}
