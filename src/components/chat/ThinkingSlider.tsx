import React from 'react';
import {
  sliderThinkingLevels,
  sliderThinkingLevel,
  thinkingLabel,
} from '../../chat/thinking';
import { ProviderSettings } from '../../chat/types';

export function ThinkingSlider({
  settings,
  disabled,
  onChange,
}: {
  settings: ProviderSettings;
  disabled?: boolean;
  onChange: (level: string) => void;
}) {
  const levels = sliderThinkingLevels(settings.provider);
  const level = sliderThinkingLevel(settings.provider, settings.thinkingLevel);
  const label = thinkingLabel(settings.provider, level);
  return (
    <div className="chat-thinking-slider">
      <label>
        Thinking level <output>{label}</output>
        <input
          type="range"
          aria-label="Thinking level"
          aria-valuetext={label}
          min="0"
          max={levels.length - 1}
          step="1"
          value={levels.indexOf(level)}
          disabled={disabled}
          onChange={(event) => onChange(levels[Number(event.target.value)])}
        />
      </label>
      <div className="chat-thinking-scale" aria-hidden="true">
        <span>Minimal</span>
        <span>Max</span>
      </div>
    </div>
  );
}
