# Project Home documentation

## Multiple documents

Use **New design** to create another schematic. Existing documents remain open. The document tabs let you switch drawings, and each drawing has independent Undo/Redo and dirty state.

## Saving

Use each document's **Save** button or TinyCAD's **Save all** command. File access follows the active TinyCAD target: local files, Google Drive, or Electron files.

Save All reports incomplete saves and leaves unsuccessful documents marked as modified. File saves across several files are not atomic.

## Closing

Closing a modified document asks whether to save or discard its changes. Quitting Electron checks every open document. A browser refresh still requires files to be saved first.

## Startup page

In the plugin manager, choose **Use Project Home as the startup page**. Disable that option to return to the normal editor at startup.

## Scope of this example

This plugin manages open document sessions. Portable `.tcproject` descriptors and directory discovery can be built on top of the document API; they are not part of this example.
