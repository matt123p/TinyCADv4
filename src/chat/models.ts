export const CHAT_OUTPUT_TOKENS = 65536;
export function isChatGptModel(id: string): boolean {
  return /^gpt-\d+(?:\.\d+)?-(sol|luna|astra)(?:-\d{4}-\d{2}-\d{2}|-latest)?$/i.test(
    id,
  );
}
export function modelLabel(id: string): string {
  return isChatGptModel(id)
    ? id
        .replace(/^gpt-/i, 'GPT-')
        .replace(
          /-(sol|luna|astra)/i,
          (_, family: string) =>
            ` ${family.charAt(0).toUpperCase()}${family.slice(1)}`,
        )
    : id;
}

// Compare numeric versions, not alphabetic IDs (6.10 is newer than 6.9).
export function modelVersion(id: string): number[] {
  const match = id.match(
    /(?:^|[-_])(\d{1,2})(?:[.-](\d{1,2})(?=[-_]|$))?(?=[-_]|$)/,
  );
  return match ? [Number(match[1]), Number(match[2] || 0)] : [0, 0];
}
export function latestModels(ids: string[]): string[] {
  const versions = ids.map(modelVersion);
  const latest = versions.reduce(
    (a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a),
    [0, 0],
  );
  return ids.filter(
    (_, i) => versions[i][0] === latest[0] && versions[i][1] === latest[1],
  );
}
export function modelOutputTokens(provider: string, model: string): number {
  if (provider === 'openai' && isChatGptModel(model)) return 128000;
  if (provider === 'glm' && modelVersion(model)[0] >= 5) return 131072;
  return CHAT_OUTPUT_TOKENS;
}

// Keep an explicit available choice; otherwise start with the newest catalog
// version. Sol is the default ChatGPT family when the account offers it.
export function defaultModel(ids: string[], selected = ''): string {
  if (selected && ids.includes(selected)) return selected;
  const latest = latestModels(ids);
  return (
    latest.find((id) => /^gpt-\d+(?:\.\d+)?-sol$/i.test(id)) ||
    latest.find((id) => isChatGptModel(id) && /-sol(?:-|$)/i.test(id)) ||
    latest[0] ||
    ''
  );
}
