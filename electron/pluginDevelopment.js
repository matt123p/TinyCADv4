import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dialog, ipcMain, net } from 'electron';

const MAX_FILE = 32 * 1024 * 1024;
export function registerPluginDevelopment({ authorize, read, write, getWindow }) {
  ipcMain.handle('choose-plugin-directory', async event => {
    authorize(event);
    const selected = await dialog.showOpenDialog(getWindow(), { title: 'Select a development plugin or catalog folder', properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const root = await fs.realpath(selected.filePaths[0]);
    const directories = await read('development-directories') || {};
    const id = Object.keys(directories).find(key => directories[key] === root) || randomUUID();
    directories[id] = root; await write('development-directories', directories);
    return { id, name: path.basename(root) };
  });
  ipcMain.handle('read-plugin-development-file', async (event, id, relative) => {
    authorize(event);
    if (typeof id !== 'string' || typeof relative !== 'string' || relative.length > 240 || /[\\\x00-\x1f:#?%]/.test(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid development resource path.');
    const root = (await read('development-directories'))?.[id];
    if (!root) throw new Error('Choose the development folder again.');
    // Reject symlinks in every component, including a replaced root, before opening a resource.
    let file = root;
    try {
      if ((await fs.realpath(root)) !== root) throw new Error('Development folder was replaced by a symlink.');
      for (const part of relative.split('/')) {
        file = path.join(file, part); const info = await fs.lstat(file);
        if (info.isSymbolicLink()) throw new Error('Development resources cannot be symlinks.');
      }
      const resource = await fs.lstat(file);
      if (!resource.isFile() || resource.size > MAX_FILE) throw new Error('Development resource is not a regular file or is too large.');
      const handle = await fs.open(file, 'r');
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_FILE) throw new Error('Development resource is not a regular file or is too large.');
        const bytes = Buffer.alloc(info.size + 1); let size = 0;
        while (size < bytes.length) { const chunk = await handle.read(bytes, size, bytes.length - size); if (!chunk.bytesRead) break; size += chunk.bytesRead; }
        if (size > MAX_FILE || size > info.size) throw new Error('Development resource grew during reading.');
        return new Uint8Array(bytes.subarray(0, size));
      } finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  ipcMain.handle('plugin-development-download', async (event, input) => {
    authorize(event); const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) throw new Error('Development downloads must use a loopback HTTP(S) server.');
    const response = await net.fetch(url.href, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Local plugin server failed (${response.status}).`);
    if (Number(response.headers.get('content-length') || 0) > MAX_FILE) throw new Error('Development resource too large.');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > MAX_FILE) { await reader.cancel(); throw new Error('Development resource too large.'); }
      chunks.push(Buffer.from(chunk.value));
    }
    return new Uint8Array(Buffer.concat(chunks, size));
  });
}
