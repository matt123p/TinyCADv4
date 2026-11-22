import React, { useId } from 'react';
import { Button } from '@fluentui/react-components';
import { PanelLeftContractRegular, PanelLeftExpandRegular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { ResizeHandle } from './ResizeHandle';

export function EditorSidePanel({ children, resizeLabel, width, collapsed, resizing, onToggle, onResize, onDragStateChange }: {
  children: React.ReactNode;
  resizeLabel?: string;
  width?: number | string;
  collapsed?: boolean;
  resizing?: boolean;
  onToggle(): void;
  onResize?: (delta: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const contentId = useId();
  const toggleLabel = t(collapsed ? 'designApp.showSidePanel' : 'library.hideSidePanel');
  return <div
    className={'side-panel-container' + (collapsed ? ' side-panel-collapsed' : '') +
      (resizing ? ' side-panel-resizing' : '')}
    style={{ width }}>
    <Button className="editor-side-panel-toggle" appearance="subtle"
      icon={collapsed ? <PanelLeftExpandRegular /> : <PanelLeftContractRegular />}
      title={toggleLabel} aria-label={toggleLabel} aria-expanded={!collapsed}
      aria-controls={contentId} onClick={onToggle} />
    {onResize && <ResizeHandle direction="horizontal" onResize={onResize}
      onDragStateChange={onDragStateChange} label={resizeLabel} />}
    <div id={contentId} className="editor-side-panel-content" hidden={collapsed}>{children}</div>
  </div>;
}

export function EditorDrawingStack({ drawing, children, symbolEditor, bottomHeight, bottomHidden, bottomLabel,
  resizeLabel, onBottomResize }: {
  drawing: React.ReactNode;
  children: React.ReactNode;
  symbolEditor?: boolean;
  bottomHeight: number;
  bottomHidden?: boolean;
  bottomLabel?: string;
  resizeLabel?: string;
  onBottomResize: (delta: number) => void;
}) {
  return <>
    <div className={symbolEditor ? 'circuit-container-es' : 'circuit-container'}>{drawing}</div>
    <div className="bottom-panel-wrapper" role={bottomLabel ? 'region' : undefined}
      aria-label={bottomLabel} style={{ height: bottomHeight }} hidden={bottomHidden}>
      <ResizeHandle direction="vertical" onResize={onBottomResize} label={resizeLabel} />
      {children}
    </div>
  </>;
}
