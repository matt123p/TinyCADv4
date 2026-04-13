import React from 'react';

type TranslationResult = {
  t: (key: string, options?: Record<string, unknown>) => string;
  i18n: {
    language: string;
    exists: () => boolean;
  };
  ready: boolean;
};

const translationResult: TranslationResult = {
  t: (key: string, options?: Record<string, unknown>) => {
    if (options?.defaultValue && typeof options.defaultValue === 'string') {
      return options.defaultValue;
    }
    return key;
  },
  i18n: {
    language: 'en',
    exists: () => true,
  },
  ready: true,
};

export function useTranslation() {
  return translationResult;
}

export function withTranslation() {
  return function withTranslationWrapper<T>(Component: React.ComponentType<T>) {
    return function WrappedComponent(props: T) {
      return React.createElement(Component as any, {
        ...props,
        t: translationResult.t,
        i18n: translationResult.i18n,
      });
    };
  };
}

export const Trans = (props: { children?: React.ReactNode }) => props.children ?? null;
export const I18nextProvider = (props: { children?: React.ReactNode }) => props.children ?? null;
export const initReactI18next = {
  type: '3rdParty',
  init() {},
};
