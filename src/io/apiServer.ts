// Website links and account requests are same-origin in browser builds.
const websiteOrigin = 'https://www.tinycad.net';
export const isElectron = process.env.TARGET_SYSTEM === 'electron';
export const apiServer = isElectron ? websiteOrigin : '';

export function onlineLibraryUrl(path: string): string {
  // The public editor is hosted separately from the symbol API.
  const origin =
    typeof window !== 'undefined' &&
    window.location?.hostname === 'online.tinycad.net'
      ? websiteOrigin
      : apiServer;
  return origin + path;
}

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
