import React, { useEffect, useRef, useState } from 'react';
import { latestModels, modelLabel } from '../../chat/models';
import { sliderThinkingLevel, thinkingLabel } from '../../chat/thinking';
import { ThinkingSlider } from './ThinkingSlider';
import { ProviderSettings } from '../../chat/types';

export function ModelPicker({
  inline = false,
  settings,
  models,
  disabled,
  onChange,
}: {
  inline?: boolean;
  settings: ProviderSettings;
  models: string[];
  disabled: boolean;
  onChange: (model: string, thinking: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const recentHistory = useRef<string[]>([]);
  const [custom, setCustom] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const recentKey = `tinycad.chat.recent.${settings.provider}.${settings.endpoint}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recentKey) || '[]');
      const history = Array.isArray(saved)
        ? saved
            .filter(
              (id) =>
                typeof id === 'string' &&
                (settings.provider !== 'openai' || models.includes(id)),
            )
            .slice(0, 6)
        : [];
      recentHistory.current = history;
      setRecent(history);
    } catch {
      recentHistory.current = [];
      setRecent([]);
    }
  }, [recentKey, models]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    container.current
      ?.querySelector<HTMLInputElement>('input:checked, input')
      ?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const choose = (id: string) => {
    if (!id.trim()) return;
    id = id.trim();
    const next = [
      id,
      ...recentHistory.current.filter((item) => item !== id),
    ].slice(0, 6);
    recentHistory.current = next;
    // Keep setup/settings rows in place while selecting; record recents for next time.
    if (!inline) setRecent(next);
    try {
      localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      /* Optional preferences. */
    }
    onChange(
      id,
      sliderThinkingLevel(settings.provider, settings.thinkingLevel),
    );
  };
  const latest = latestModels(models);
  const availableRecent = recent.filter(
    (id) => models.includes(id) || settings.provider !== 'openai',
  );
  if (inline)
    availableRecent.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  const rows = (ids: string[]) =>
    ids.map((id) => (
      <label className="chat-model-option" key={id}>
        <input
          type="radio"
          name="chat-model"
          aria-label={modelLabel(id)}
          checked={settings.model === id}
          onChange={() => choose(id)}
        />
        {modelLabel(id)}
      </label>
    ));
  return (
    <div className="chat-model-picker" ref={container}>
      {!inline && (
        <button
          ref={trigger}
          type="button"
          className="chat-model-trigger"
          aria-label="Select model and thinking level"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          title={`${
            modelLabel(settings.model) || 'Select model'
          } · ${thinkingLabel(
            settings.provider,
            settings.thinkingLevel,
          )} thinking`}
          onClick={() => setOpen(!open)}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
            <path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" />
            <path d="M10 10h4v4h-4z" />
          </svg>
        </button>
      )}
      {(inline || open) && !disabled && (
        <div
          role={inline ? undefined : 'dialog'}
          aria-label={inline ? undefined : 'Model and thinking'}
          className={inline ? 'chat-model-defaults' : 'chat-model-popup'}
          onKeyDown={(event) => {
            if (inline || event.key !== 'Tab') return;
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button, input, summary',
              ),
            ).filter((item) => item.getClientRects().length);
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <strong>Select model</strong>
          <div className="chat-model-list">
            {!!availableRecent.length && (
              <fieldset>
                <legend>Recently selected</legend>
                {rows(availableRecent)}
              </fieldset>
            )}
            <fieldset>
              <legend>Latest models</legend>
              {rows(latest.filter((id) => !availableRecent.includes(id)))}
              {!latest.length && <p>Enter a model ID below.</p>}
            </fieldset>
            <details className="chat-more-models">
              <summary>More models</summary>
              {rows(
                models.filter(
                  (id) => !latest.includes(id) && !availableRecent.includes(id),
                ),
              )}
              {settings.provider !== 'openai' && (
                <div className="chat-custom-model">
                  <label>
                    Model ID
                    <input
                      aria-label="Model ID"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!custom.trim()}
                    onClick={() => choose(custom)}
                  >
                    Use model
                  </button>
                </div>
              )}
            </details>
          </div>
          <ThinkingSlider
            settings={settings}
            disabled={!settings.model}
            onChange={(thinkingLevel) =>
              onChange(settings.model, thinkingLevel)
            }
          />
          {!inline && (
            <button type="button" onClick={close}>
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
