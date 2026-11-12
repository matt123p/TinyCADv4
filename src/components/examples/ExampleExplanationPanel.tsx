import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, tokens } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { docDrawing } from '../../state/undo/undo';
import { ResizeHandle } from '../panel/ResizeHandle';
import { ExampleDescription } from './ExampleDescription';

export function ExampleExplanationPanel() {
  const item = useSelector(
    (state: docDrawing) => state.altStore.exampleExplanation,
  );
  const visible = useSelector(
    (state: docDrawing) => state.altStore.exampleExplanationVisible,
  );
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [width, setWidth] = useState(430);
  const [activated, setActivated] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const setVisible = (visible: boolean) =>
    dispatch({ type: 'example/explanation', visible });
  const resize = useCallback((delta: number) => {
    setWidth((current) => Math.max(280, Math.min(900, current - delta)));
  }, []);

  useEffect(() => {
    if (visible) setActivated(true);
    else
      body.current?.querySelectorAll('video').forEach((video) => video.pause());
  }, [visible]);

  if (!item) return null;
  return (
    <aside
      aria-label={t('examples.explanationTitle')}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: visible ? width : 40,
        maxWidth: '60vw',
        minWidth: visible ? 0 : 40,
        flexShrink: visible ? 1 : 0,
        minHeight: 0,
        overflow: 'hidden',
        background: tokens.colorNeutralBackground1,
        borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
      }}
    >
      {visible ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              zIndex: 20,
            }}
          >
            <ResizeHandle direction="horizontal" onResize={resize} />
          </div>
          <header
            style={{
              padding: '8px 12px',
              borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <strong style={{ flex: 1 }}>
                {t('examples.explanationTitle')}
              </strong>
              <Button
                size="small"
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label={t('examples.hideExplanation')}
                title={t('examples.hideExplanation')}
                onClick={() => setVisible(false)}
              />
            </div>
            <div
              style={{
                marginTop: 8,
                overflowWrap: 'anywhere',
                color: tokens.colorNeutralForeground2,
              }}
            >
              {item.title}
            </div>
          </header>
        </>
      ) : (
        <Button
          appearance="subtle"
          aria-label={t('examples.showExplanation')}
          title={t('examples.showExplanation')}
          style={{ writingMode: 'vertical-rl', minHeight: 140 }}
          onClick={() => setVisible(true)}
        >
          {t('examples.explanation')}
        </Button>
      )}
      <div
        ref={body}
        tabIndex={visible ? 0 : -1}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          padding: 12,
          display: visible ? undefined : 'none',
        }}
      >
        {(visible || activated) && <ExampleDescription item={item} />}
      </div>
    </aside>
  );
}
