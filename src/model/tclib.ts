import { FileIdType } from '../io/files';

export interface tclibLoadError {
  summary: string;
  details?: string;
}

export function normalizeTclibLoadError(
  error: unknown,
  fallbackSummary = 'Unable to load library.',
): tclibLoadError {
  if (error instanceof Error) {
    return {
      summary: error.message || fallbackSummary,
      details: error.stack || undefined,
    };
  }

  if (typeof error === 'string') {
    return {
      summary: error || fallbackSummary,
    };
  }

  if (error && typeof error === 'object') {
    const maybeError = error as {
      summary?: unknown;
      message?: unknown;
      details?: unknown;
      stack?: unknown;
      code?: unknown;
      syscall?: unknown;
      path?: unknown;
    };
    const summary =
      typeof maybeError.summary === 'string' && maybeError.summary.trim().length > 0
        ? maybeError.summary
        : typeof maybeError.message === 'string' && maybeError.message.trim().length > 0
          ? maybeError.message
          : fallbackSummary;

    const detailsParts = [
      typeof maybeError.details === 'string' ? maybeError.details : null,
      typeof maybeError.code === 'string' ? `Code: ${maybeError.code}` : null,
      typeof maybeError.syscall === 'string'
        ? `Operation: ${maybeError.syscall}`
        : null,
      typeof maybeError.path === 'string' ? `Path: ${maybeError.path}` : null,
      typeof maybeError.stack === 'string' ? maybeError.stack : null,
    ].filter((part): part is string => !!part && part.trim().length > 0);

    return {
      summary,
      details: detailsParts.length > 0 ? detailsParts.join('\n\n') : undefined,
    };
  }

  return {
    summary: fallbackSummary,
  };
}

export interface tclibSymbol {
  SymbolId: number;
  Data: string;
}

export interface tclibLibraryAttributes {
  AttName: string;
  AttValue: string;
  ShowAtt: number;
}

export enum TextDisplayMethod {
  ShowValue = 0,
  HideValue = 1,
  NeverShow = 2,
  ShowValueExtra = 3,
  ShowNameValuePresent = 4,
  ShowNameValue = 5,
  ShowValuePresent = 6,
}

export interface tclibLibraryEntry {
  id?: string;
  NameID: number;
  Name: string;
  SymbolID: number;
  Reference: string;
  ppp: number;
  Description: string;
  ShowName: TextDisplayMethod;
  ShowRef: TextDisplayMethod;
  Attributes: tclibLibraryAttributes[];
}

export interface tclib {
  fileId: FileIdType;
  modified: string;
  name: string;
  bad?: boolean;
  loadError?: tclibLoadError;
  names: tclibLibraryEntry[];
  symbols: tclibSymbol[];
}
