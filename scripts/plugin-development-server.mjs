import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILE = 32 * 1024 * 1024;
function safePath(file) {
  if (typeof file !== 'string' || file.length > 240 || /[\\\x00-\x1f:#?%]/.test(file)
    || file.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe resource path.');
  return file;
}
async function read(root, relative) {
  let file = root;
  if (await fs.realpath(root) !== root) throw new Error('Development root changed.');
  for (const part of safePath(relative).split('/')) {
    file = path.join(file, part); if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlinks are unsupported.');
  }
  const resource = await fs.lstat(file);
  if (!resource.isFile() || resource.size > MAX_FILE) throw new Error('Resource too large or not a file.');
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Resource too large or not a file.');
    const buffer = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < buffer.length) { const chunk = await handle.read(buffer, size, buffer.length - size); if (!chunk.bytesRead) break; size += chunk.bytesRead; }
    if (size > stat.size) throw new Error('Resource grew during reading.'); return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
/** Serve declared package files only, even when the root is an entire repository checkout. */
export async function createPluginDevelopmentServer(directory) {
  const root = await fs.realpath(directory);
  return http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    try {
      // Validate the raw path before URL normalization can remove traversal segments.
      const requested = safePath(decodeURIComponent(request.url.split('?')[0].slice(1)));
      const allowed = new Set(['tinycad-plugins.json', 'tinycad-plugin.json']);
      let manifests = ['tinycad-plugin.json'];
      try {
        const catalog = JSON.parse((await read(root, 'tinycad-plugins.json')).toString('utf8'));
        if (catalog.catalogVersion !== 1 || !Array.isArray(catalog.plugins) || catalog.plugins.length > 100) throw new Error('Invalid development catalog.');
        manifests = catalog.plugins.map(entry => {
          if (entry.package?.type !== 'source') throw new Error('Development catalogs need source packages.');
          return safePath(entry.package.manifest);
        });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const file of manifests) {
        allowed.add(file); const manifest = JSON.parse((await read(root, file)).toString('utf8'));
        if (!Array.isArray(manifest.files) || manifest.files.length > 512) throw new Error('Invalid resource list.');
        const prefix = file.split('/').slice(0, -1).join('/');
        for (const resource of manifest.files) allowed.add(prefix ? `${prefix}/${safePath(resource)}` : safePath(resource));
      }
      if (!allowed.has(requested)) { response.writeHead(404); response.end('Resource is not declared by a plugin.'); return; }
      const bytes = await read(root, requested);
      const extension = path.extname(requested).toLowerCase();
      response.setHeader('Content-Type', ({ '.json': 'application/json', '.js': 'text/javascript', '.md': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' })[extension] || 'application/octet-stream');
      response.writeHead(200); response.end(bytes);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400); response.end(error.code === 'ENOENT' ? 'Plugin resource not found.' : 'Invalid development resource or manifest.');
    }
  });
}
async function main() {
  const directory = process.argv[2] || '.'; const port = Number(process.argv[3] || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port between 1 and 65535.');
  const server = await createPluginDevelopmentServer(directory);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Plugin server: http://127.0.0.1:${port}/ (declared resources in ${path.resolve(directory)})`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(error => { console.error(error.message); process.exitCode = 1; });
