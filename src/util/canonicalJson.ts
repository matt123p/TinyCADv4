export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, item[key]]),
      );
    }
    return item;
  });
}
