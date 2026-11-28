export const LANGUAGE_STORAGE_KEY = 'tinycad.language';

export interface LanguageOption {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'pl', label: 'Polski' },
  { code: 'zh-CN', label: '中文 (简体)' },
];

export const DEFAULT_LANGUAGE = 'en';

function supportedLanguage(
  value: string | null | undefined,
): string | undefined {
  const base = value?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LANGUAGES.find(
    ({ code }) => code.toLowerCase().split('-')[0] === base,
  )?.code;
}

export const normalizeLanguageCode = (
  value: string | null | undefined,
): string => supportedLanguage(value) ?? DEFAULT_LANGUAGE;

export const detectInitialLanguage = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  try {
    const saved = supportedLanguage(
      window.localStorage.getItem(LANGUAGE_STORAGE_KEY),
    );
    if (saved) return saved;
  } catch {
    // Browser preferences are still available when storage is disabled.
  }

  const systemLanguages = window.electronAPI?.preferredSystemLanguages;
  const preferred = systemLanguages?.length
    ? systemLanguages
    : [...(window.navigator.languages ?? []), window.navigator.language];
  return preferred.map(supportedLanguage).find(Boolean) ?? DEFAULT_LANGUAGE;
};

export const persistLanguagePreference = (code: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      LANGUAGE_STORAGE_KEY,
      normalizeLanguageCode(code),
    );
  } catch {
    // Switching languages still works for this session.
  }
};
