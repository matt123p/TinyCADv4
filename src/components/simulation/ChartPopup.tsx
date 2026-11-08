import React, { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  createDOMRenderer,
  RendererProvider,
  FluentProvider,
  webLightTheme,
} from '@fluentui/react-components';

export interface ChartPopup {
  child: Window;
  root: HTMLElement;
}
export function openChartPopup(title: string): ChartPopup | undefined {
  if (process.env.TARGET_SYSTEM !== 'electron') return;
  const child = window.open(
    'about:blank',
    `tinycad-chart-${crypto.randomUUID()}`,
    'popup,width=900,height=620',
  );
  if (!child) return;
  const doc = child.document;
  doc.title = title;
  doc.documentElement.style.height = '100%';
  doc.body.style.cssText =
    'margin:0;height:100%;font-family:Segoe UI,sans-serif;background:white';
  const root = doc.createElement('div');
  root.style.height = '100%';
  doc.body.appendChild(root);
  return { child, root };
}
export function ChartPopupPortal({
  popup,
  onClose,
  children,
}: {
  popup: ChartPopup;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const renderer = useMemo(
    () => createDOMRenderer(popup.child.document),
    [popup],
  );
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useEffect(() => {
    const closed = () => closeCallback.current();
    popup.child.addEventListener('pagehide', closed);
    const interval = window.setInterval(() => {
      if (popup.child.closed) closed();
    }, 500);
    return () => {
      clearInterval(interval);
      popup.child.removeEventListener('pagehide', closed);
    };
  }, [popup]);
  return createPortal(
    <RendererProvider renderer={renderer} targetDocument={popup.child.document}>
      <FluentProvider
        targetDocument={popup.child.document}
        theme={webLightTheme}
        style={{
          height: '100%',
          overflow: 'auto',
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        {children}
      </FluentProvider>
    </RendererProvider>,
    popup.root,
  );
}
