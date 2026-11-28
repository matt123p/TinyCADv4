if (process.platform === 'linux') delete process.env.ELECTRON_RUN_AS_NODE;

if (process.platform === 'linux' && ['code', 'code-insiders'].includes(process.env.SNAP_NAME)) {
  // The VS Code Snap exports its own GTK libraries and schemas into the
  // terminal. Use the host desktop environment for this Electron process.
  for (const name of [
    'GIO_MODULE_DIR',
    'GSETTINGS_SCHEMA_DIR',
    'GTK_EXE_PREFIX',
    'GTK_IM_MODULE_FILE',
    'GTK_MODULES',
    'GTK_PATH',
  ]) {
    delete process.env[name];
  }

  for (const name of ['XDG_CONFIG_DIRS', 'XDG_DATA_DIRS']) {
    const original = process.env[`${name}_VSCODE_SNAP_ORIG`];
    if (original) {
      process.env[name] = original;
    } else {
      delete process.env[name];
    }
  }
}

const { DISPLAY, XDG_CURRENT_DESKTOP, XDG_SESSION_TYPE } = process.env;
const hasOzoneOverride = process.argv.slice(2).some(argument =>
  argument === '--ozone-platform' || argument.startsWith('--ozone-platform='),
);
if (process.platform === 'linux' && XDG_SESSION_TYPE === 'wayland' && DISPLAY &&
    XDG_CURRENT_DESKTOP?.split(':').includes('GNOME') && !hasOzoneOverride) {
  // Let GNOME supply the title bar through XWayland for development windows.
  process.argv.splice(2, 0, '--ozone-platform=x11');
  // Keep Electron's GTK print helper on X11 too. Its Wayland backend can
  // abort when reading GNOME's deprecated XSettings font keys.
  process.env.GDK_BACKEND = 'x11';
}

await import('electron/cli.js');
