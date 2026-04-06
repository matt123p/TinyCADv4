export enum TextDisplayMethod {
  ShowValue = 0,
  HideValue = 1,
  NeverShow = 2,
  ShowValueExtra = 3,
  ShowNameValuePresent = 4,
  ShowNameValue = 5,
  ShowValuePresent = 6,
}

export function normalizeTclibLoadError(
  error: unknown,
  fallbackSummary = 'Unable to load library.',
) {
  if (error instanceof Error) {
    return {
      summary: error.message || fallbackSummary,
      details: error.stack || undefined,
    };
  }

  return {
    summary: fallbackSummary,
  };
}
