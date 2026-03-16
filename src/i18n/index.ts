import i18n from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  detectInitialLanguage,
  normalizeLanguageCode,
  SUPPORTED_LANGUAGES,
} from './languages';

type LocaleModule = {
  default: Record<string, unknown>;
};

const localeLoaders: Record<string, () => Promise<LocaleModule>> = {
  en: () => import('./locales/en/common'),
  nl: () => import('./locales/nl/common'),
  fr: () => import('./locales/fr/common'),
  es: () => import('./locales/es/common'),
  de: () => import('./locales/de/common'),
  it: () => import('./locales/it/common'),
  ja: () => import('./locales/ja/common'),
  'zh-CN': () => import('./locales/zh-CN/common'),
};

const supportedCodes = SUPPORTED_LANGUAGES.map((language) => language.code);

void i18n
  .use(
    resourcesToBackend((language: string) => {
      const normalized = normalizeLanguageCode(language);
      const load = localeLoaders[normalized] ?? localeLoaders[DEFAULT_LANGUAGE];
      return load();
    }),
  )
  .use(initReactI18next)
  .init({
    lng: detectInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: supportedCodes,
    defaultNS: 'common',
    ns: ['common'],
    load: 'currentOnly',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

void i18n.loadLanguages([detectInitialLanguage()]);

export default i18n;
