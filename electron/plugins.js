import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { spawn } from 'node:child_process';
import { app, ipcMain, dialog, net } from 'electron';
import { registerPluginDevelopment } from './pluginDevelopment.js';

const MAX_BYTES = 128 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(value);
export function registerPluginServices(getWindow, setMenus) {
  const tasks = new Map();
  const authorize = event => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Plugin service accepts only the host main frame.');
  };
  const cacheFile = key => {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.-]{1,250}$/.test(key)) throw new Error('Invalid plugin storage key.');
    return path.join(app.getPath('userData'), 'plugins', key + '.bin');
  };
  const read = async key => {
    try { return deserialize(await fs.readFile(cacheFile(key))); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  };
  const write = async (key, value) => {
    const file = cacheFile(key); const bytes = serialize(value);
    if (bytes.length > MAX_BYTES + 32 * 1024 * 1024) throw new Error('Plugin cache value exceeds storage limit.');
    await fs.mkdir(path.dirname(file), { recursive: true }); const temporary = file + '.' + randomUUID() + '.tmp';
    let lock;
    try {
      if (key === 'records') {
        const deadline = Date.now() + 5000;
        while (!lock) {
          try { lock = await fs.open(file + '.lock', 'wx'); }
          catch (error) {
            if (error.code !== 'EEXIST' || Date.now() >= deadline) throw new Error('Plugin installation store is busy. Try again.');
            const stat = await fs.stat(file + '.lock').catch(() => null);
            if (stat && Date.now() - stat.mtimeMs > 30000) await fs.rm(file + '.lock', { force: true });
            else await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        const previous = await read(key);
        if (value.revision !== (previous?.revision || 0) + 1) throw new Error('Plugin installations changed in another window. Reload before changing them.');
      }
      await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
      if (lock) { await lock.close(); await fs.rm(file + '.lock', { force: true }); }
    }
  };
  registerPluginDevelopment({ authorize, read, write, getWindow });
  ipcMain.handle('plugin-storage', async (event, operation, key, value) => {
    authorize(event);
    if (operation === 'get') return read(key);
    if (operation === 'set') return write(key, value);
    if (operation === 'remove') { await fs.rm(cacheFile(key), { force: true }); return; }
    throw new Error('Unknown plugin storage operation.');
  });
  ipcMain.handle('plugin-download', async (event, input, binary) => {
    authorize(event); let url = new URL(input);
    const allowed = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
    const validate = target => {
      if (target.protocol !== 'https:' || target.username || target.password || target.port || !allowed.has(target.hostname)) throw new Error('Unsupported plugin download location.');
    };
    validate(url);
    if (!['api.github.com', 'github.com'].includes(url.hostname)) throw new Error('Downloads must start at GitHub.');
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await net.fetch(url.href, { credentials: 'omit', redirect: 'manual', headers: { Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url); validate(url); continue; }
      if (!response.ok) throw new Error(`GitHub download failed (${response.status}).`);
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Plugin download is too large.');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Plugin download limit exceeded.'); }
        chunks.push(Buffer.from(chunk.value));
      }
      return new Uint8Array(Buffer.concat(chunks, size));
    }
    throw new Error('Too many plugin download redirects.');
  });
  ipcMain.on('set-plugin-menus', (event, items) => {
    try {
      authorize(event);
      if (!Array.isArray(items) || items.length > 500) throw new Error('Invalid plugin menus.');
      const menus = items.map(item => {
        if (!item || typeof item.label !== 'string' || item.label.length > 200 || !validId(item.command) || typeof item.enabled !== 'boolean' || !/^(file\/(import|export)|edit\/plugins|view\/(panels|main)|tools\/plugins|help\/plugins)$/.test(item.location)) throw new Error('Invalid plugin menu item.');
        return { label: item.label, command: item.command, enabled: item.enabled, location: item.location };
      });
      setMenus(menus);
    } catch (error) { console.error('Plugin menus:', error.message); }
  });
  ipcMain.handle('choose-plugin-tool', async (event, pluginId) => {
    authorize(event); if (!validId(pluginId)) throw new Error('Invalid plugin ID.');
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Select an executable for this plugin', properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const executable = result.filePaths[0]; const name = path.basename(executable);
    // A fixed adapter supplies stdin only; scripts cannot inject shell commands or arguments.
    const id = randomUUID(); const tools = await read('native-tools') || {};
    tools[id] = { pluginId, executable, name }; await write('native-tools', tools);
    return { id, name };
  });
  ipcMain.handle('run-plugin-tool', async (event, pluginId, toolId, input) => {
    authorize(event);
    if (!validId(pluginId) || typeof input !== 'string' || Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error('Invalid native tool input.');
    const tool = (await read('native-tools'))?.[toolId];
    if (!tool || tool.pluginId !== pluginId) throw new Error('Native tool was not approved for this plugin.');
    if (tasks.size >= 4 || [...tasks.values()].filter(task => task.pluginId === pluginId).length >= 2) throw new Error('Native tool concurrency limit exceeded.');
    const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'tinycad-plugin-'));
    try {
      return await new Promise((resolve, reject) => {
        if (tasks.size >= 4 || [...tasks.values()].filter(task => task.pluginId === pluginId).length >= 2) { reject(new Error('Native tool concurrency limit exceeded.')); return; }
        const child = spawn(tool.executable, [], { cwd: directory, shell: false, windowsHide: true, env: { PATH: process.env.PATH || '', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || '' } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
        const taskId = randomUUID(); tasks.set(taskId, { pluginId, child });
        let stdout = ''; let stderr = ''; let size = 0;
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Native tool timed out.')); }, 60000);
        const collect = (chunk, target) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { child.kill(); reject(new Error('Native tool output limit exceeded.')); return; }
          if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
        };
        child.stdout.on('data', chunk => collect(chunk, 'stdout')); child.stderr.on('data', chunk => collect(chunk, 'stderr'));
        child.on('error', error => { tasks.delete(taskId); clearTimeout(timer); reject(error); });
        child.on('close', code => { tasks.delete(taskId); clearTimeout(timer); resolve({ code, stdout, stderr }); });
        child.stdin.on('error', () => {}); child.stdin.end(input);
      });
    } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  });
  ipcMain.handle('list-plugin-tools', async (event, pluginId) => {
    authorize(event); if (!validId(pluginId)) throw new Error('Invalid plugin ID.');
    const tools = await read('native-tools') || {};
    return Object.entries(tools).filter(([, tool]) => tool.pluginId === pluginId).map(([id, tool]) => ({ id, name: tool.name }));
  });
  ipcMain.on('cancel-plugin-tasks', (event, pluginId) => {
    try { authorize(event); if (!validId(pluginId)) return; for (const task of tasks.values()) if (task.pluginId === pluginId) task.child.kill(); }
    catch (error) { console.error('Plugin task cancellation:', error.message); }
  });
}
