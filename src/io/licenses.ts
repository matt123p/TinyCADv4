export interface LicenseNotice {
  name: string;
  version?: string;
  license?: string;
  file: string;
}

async function fetchLicenseFile(file: string) {
  const response = await fetch(new URL(`licenses/${file}`, document.baseURI));
  if (!response.ok) throw new Error(`Failed to load license file (${response.status})`);
  return response;
}

export async function loadLicenseIndex(): Promise<LicenseNotice[]> {
  if (process.env.TARGET_SYSTEM === 'electron') return window.electronAPI.licenseIndex();
  return (await fetchLicenseFile('index.json')).json();
}

export async function loadLicenseText(file: string): Promise<string> {
  if (process.env.TARGET_SYSTEM === 'electron') return window.electronAPI.readLicense(file);
  return (await fetchLicenseFile(file)).text();
}
