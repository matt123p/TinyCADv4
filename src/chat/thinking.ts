import { ProviderSettings, ProviderKind } from './types';
export const thinkingLevels: Record<ProviderKind, string[]> = {
  openai: [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ],
  ollama: [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ],
  compatible: [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ],
  anthropic: [
    'default',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'budget',
    'disabled',
  ],
  gemini: ['default', 'minimal', 'low', 'medium', 'high', 'budget', 'disabled'],
  glm: ['default', 'low', 'medium', 'high', 'max', 'disabled'],
};
export function thinkingParameters(
  settings: ProviderSettings,
): Record<string, any> {
  const level = settings.thinkingLevel ?? 'default';
  if (!thinkingLevels[settings.provider].includes(level))
    throw new Error('Unsupported thinking level for this provider.');
  if (level === 'default') return {};
  if (level === 'budget') {
    const budget = settings.thinkingBudget;
    const min = settings.provider === 'anthropic' ? 1024 : 0;
    if (
      !Number.isInteger(budget) ||
      budget < min ||
      budget >= settings.maxTokens
    )
      throw new Error(
        `Thinking token budget must be ${min} or more and less than maximum output tokens.`,
      );
    return settings.provider === 'anthropic'
      ? { thinking: { type: 'enabled', budget_tokens: budget } }
      : { thinkingConfig: { thinkingBudget: budget } };
  }
  if (settings.provider === 'anthropic')
    return level === 'disabled'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'adaptive' }, output_config: { effort: level } };
  if (settings.provider === 'gemini')
    return {
      thinkingConfig:
        level === 'disabled' ? { thinkingBudget: 0 } : { thinkingLevel: level },
    };
  if (settings.provider === 'glm')
    return level === 'disabled'
      ? { thinking: { type: 'disabled' } }
      : { thinking: { type: 'enabled' }, reasoning_effort: level };
  return { reasoning_effort: level };
}

export function sliderThinkingLevels(provider: ProviderKind): string[] {
  return thinkingLevels[provider].filter(
    (level) => !['default', 'none', 'disabled', 'budget'].includes(level),
  );
}
export function sliderThinkingLevel(
  provider: ProviderKind,
  level?: string,
): string {
  const levels = sliderThinkingLevels(provider);
  return levels.includes(level) ? level : 'medium';
}
export function thinkingLabel(provider: ProviderKind, level?: string): string {
  const levels = sliderThinkingLevels(provider),
    value = sliderThinkingLevel(provider, level);
  if (value === levels[0]) return 'Minimal';
  if (value === levels[levels.length - 1]) return 'Max';
  return value === 'xhigh'
    ? 'Very high'
    : value.charAt(0).toUpperCase() + value.slice(1);
}
