export const printerPaperSizes = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
} as const;

export interface PrinterSettings {
  printerName: string;
  paperSize: '' | keyof typeof printerPaperSizes;
  orientation: 'drawing' | 'portrait' | 'landscape';
  copies: number;
  colour: '' | 'colour' | 'monochrome';
  duplexMode: '' | 'simplex' | 'shortEdge' | 'longEdge';
}

const storageKey = 'tinycad.printerSettings';
const defaults: PrinterSettings = {
  printerName: '',
  paperSize: '',
  orientation: 'drawing',
  copies: 1,
  colour: '',
  duplexMode: '',
};

export function loadPrinterSettings(): PrinterSettings {
  try {
    const saved: Partial<PrinterSettings> = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return {
      printerName: typeof saved.printerName === 'string' ? saved.printerName : defaults.printerName,
      paperSize: saved.paperSize && Object.hasOwn(printerPaperSizes, saved.paperSize) ? saved.paperSize : defaults.paperSize,
      orientation: saved.orientation === 'portrait' || saved.orientation === 'landscape' ? saved.orientation : defaults.orientation,
      copies: saved.copies && Number.isInteger(saved.copies) && saved.copies >= 1 && saved.copies <= 999 ? saved.copies : defaults.copies,
      colour: saved.colour === 'colour' || saved.colour === 'monochrome' ? saved.colour : defaults.colour,
      duplexMode: saved.duplexMode === 'simplex' || saved.duplexMode === 'shortEdge' || saved.duplexMode === 'longEdge' ? saved.duplexMode : defaults.duplexMode,
    };
  } catch {
    return defaults;
  }
}

export function savePrinterSettings(settings: PrinterSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}
