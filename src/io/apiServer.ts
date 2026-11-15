// Browser builds always use the origin serving the editor (including its port).
// Electron loads from file://, so its TinyCAD website/API origin is explicit.
export const isElectron = process.env.TARGET_SYSTEM === 'electron';
export const apiServer = isElectron ? 'https://www.tinycad.net' : '';

export function tinycadUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('/') && !pathOrUrl.startsWith('//'))
    return `${apiServer}${pathOrUrl}`;
  try {
    const url = new URL(pathOrUrl);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ['www.tinycad.net', 'tinycad.net'].includes(url.hostname)
    )
      return `${apiServer}${url.pathname}${url.search}${url.hash}`;
  } catch {
    /* Preserve URLs belonging to other services and local artifacts. */
  }
  return pathOrUrl;
}
