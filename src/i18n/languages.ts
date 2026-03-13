export const LANGUAGE_STORAGE_KEY = 'tinycad.language';

export interface LanguageOption {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-CN', label: '中文 (简体)' },
];

export const DEFAULT_LANGUAGE = 'en';

export const normalizeLanguageCode = (value: string | null | undefined): string => {
  if (!value) {
    return DEFAULT_LANGUAGE;
  }

  const lower = value.toLowerCase();

  if (lower.startsWith('zh')) {
    return 'zh-CN';
  }

  if (lower.startsWith('en')) {
    return 'en';
  }

  if (lower.startsWith('fr')) {
    return 'fr';
  }

  if (lower.startsWith('es')) {
    return 'es';
  }

  if (lower.startsWith('de')) {
    return 'de';
  }

  if (lower.startsWith('it')) {
    return 'it';
  }

  if (lower.startsWith('ja')) {
    return 'ja';
  }

  return DEFAULT_LANGUAGE;
};

export const detectInitialLanguage = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved) {
    return normalizeLanguageCode(saved);
  }

  return normalizeLanguageCode(window.navigator.language);
};

export const persistLanguagePreference = (code: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguageCode(code));
};
