import React, { type ReactNode } from 'react';

// These flags are visual cues. The picker also shows each language's name.
const artwork: Record<string, ReactNode> = {
  en: (
    <>
      <path fill="#012169" d="M0 0h24v16H0z" />
      <path stroke="#fff" strokeWidth="3.4" d="m0 0 24 16M24 0 0 16" />
      <path
        fill="#c8102e"
        d="M0 0v1.2L12 8h2L0 0zm24 0h-1.8L12 8h2L24 1.3V0zm0 16v-1.2L12 8h-2l14 8zM0 16h1.8L12 8h-2L0 14.7V16z"
      />
      <path stroke="#fff" strokeWidth="5.2" d="M12 0v16M0 8h24" />
      <path stroke="#c8102e" strokeWidth="3" d="M12 0v16M0 8h24" />
    </>
  ),
  nl: (
    <>
      <path fill="#ae1c28" d="M0 0h24v5.33H0z" />
      <path fill="#21468b" d="M0 10.67h24V16H0z" />
    </>
  ),
  fr: (
    <>
      <path fill="#002395" d="M0 0h8v16H0z" />
      <path fill="#ed2939" d="M16 0h8v16h-8z" />
    </>
  ),
  es: (
    <>
      <path fill="#aa151b" d="M0 0h24v16H0z" />
      <path fill="#f1bf00" d="M0 4h24v8H0z" />
    </>
  ),
  de: (
    <>
      <path fill="#171717" d="M0 0h24v5.33H0z" />
      <path fill="#d00" d="M0 5.33h24v5.34H0z" />
      <path fill="#ffce00" d="M0 10.67h24V16H0z" />
    </>
  ),
  it: (
    <>
      <path fill="#009246" d="M0 0h8v16H0z" />
      <path fill="#ce2b37" d="M16 0h8v16h-8z" />
    </>
  ),
  ja: <circle cx="12" cy="8" r="4.6" fill="#bc002d" />,
  pl: <path fill="#dc143c" d="M0 8h24v8H0z" />,
  'zh-CN': (
    <>
      <path fill="#de2910" d="M0 0h24v16H0z" />
      <path
        fill="#ffde00"
        d="m5 1.7.65 2h2.1l-1.7 1.24.65 2-1.7-1.24L3.3 6.94l.65-2-1.7-1.24h2.1L5 1.7z"
      />
      <path
        fill="#ffde00"
        d="m9.15 1.2.27.75h.8l-.63.48.25.76-.69-.47-.65.47.25-.76-.65-.48h.8zm1.9 1.8.27.75h.8l-.65.48.25.76-.67-.47-.65.47.25-.76-.65-.48h.8zm0 2.65.27.75h.8l-.65.48.25.76-.67-.47-.65.47.25-.76-.65-.48h.8zM9.15 7.1l.27.75h.8l-.63.48.25.76-.69-.47-.65.47.25-.76-.65-.48h.8z"
      />
    </>
  ),
};

export function LanguageFlag({ language }: { language: string }) {
  return (
    <svg
      width="24"
      height="16"
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#fff" d="M0 0h24v16H0z" />
      {artwork[language]}
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="15"
        fill="none"
        stroke="#17213a"
        strokeOpacity="0.24"
      />
    </svg>
  );
}
