/** Optional browser CORS relay. It serves GitHub release assets, never arbitrary URLs. */
import { createServer } from 'node:http';
const origins = new Set((process.env.PLUGIN_RELAY_ORIGINS || 'https://www.tinycad.net').split(',').map(value => value.trim()));
const allowed = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const maxBytes = 128 * 1024 * 1024;
let active = 0;
export async function githubReleaseAsset(repository, release, asset) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || !/^\d+$/.test(String(release)) || !/^\d+$/.test(String(asset))) throw new Error('Invalid release asset identity.');
  const metadata = await fetch(`https://api.github.com/repos/${repository}/releases/${release}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!metadata.ok) throw new Error(`GitHub metadata request failed (${metadata.status}).`);
  const info = await metadata.json();
  if (info.draft || !info.assets?.some(item => String(item.id) === String(asset))) throw new Error('Asset does not belong to that published release.');
  let url = new URL(`https://api.github.com/repos/${repository}/releases/assets/${asset}`);
  for (let redirect = 0; redirect < 6; redirect++) {
    if (url.protocol !== 'https:' || !allowed.has(url.hostname) || url.username || url.password || url.port) throw new Error('Unsupported GitHub asset redirect.');
    const response = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url); continue; }
    if (!response.ok) throw new Error(`GitHub asset request failed (${response.status}).`);
    if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Asset too large.');
    return response;
  }
  throw new Error('Too many redirects.');
}
export const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!origins.has(origin)) { response.writeHead(403).end('Origin is not allowed.'); return; }
  response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
  if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); response.writeHead(204).end(); return; }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (active >= 16) { response.writeHead(429).end('Try again later.'); return; }
  active++;
  try {
    const url = new URL(request.url, 'http://localhost');
    const upstream = await githubReleaseAsset(url.searchParams.get('repository') || '', url.searchParams.get('release') || '', url.searchParams.get('asset') || '');
    response.setHeader('Content-Type', 'application/octet-stream'); response.setHeader('X-Content-Type-Options', 'nosniff');
    const reader = upstream.body.getReader(); let size = 0;
    response.on('close', () => { void reader.cancel().catch(() => {}); });
    while (true) {
      const next = await reader.read(); if (next.done) break; size += next.value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Asset too large.'); }
      if (!response.write(next.value)) await new Promise(resolve => { response.once('drain', resolve); response.once('close', resolve); });
      if (response.destroyed) break;
    }
    response.end();
  } catch (error) {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain' });
    response.end('Plugin download failed: ' + error.message);
  } finally { active--; }
});
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('TinyCAD plugin download relay is listening.'));
}
