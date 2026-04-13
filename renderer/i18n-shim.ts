const i18n = {
  t(key: string, options?: Record<string, unknown>) {
    if (options?.defaultValue && typeof options.defaultValue === 'string') {
      return options.defaultValue;
    }
    return key;
  },
};

export default i18n;
