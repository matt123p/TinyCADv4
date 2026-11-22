import React from 'react';
import { ResizeHandle } from './ResizeHandle';

export function EditorSidePanel({ children, label, resizeLabel, width, hidden, collapsed, resizing, onResize, onDragStateChange }: {
  children: React.ReactNode;
  label?: string;
  resizeLabel?: string;
  width?: number | string;
  hidden?: boolean;
  collapsed?: boolean;
  resizing?: boolean;
  onResize?: (delta: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const Panel = label ? 'aside' : 'div';
  return <Panel
    className={'side-panel-container' + (collapsed ? ' side-panel-collapsed' : '') +
      (resizing ? ' side-panel-resizing' : '')}
    aria-label={label}
    style={{ width }}
    hidden={hidden}>
    {onResize && <ResizeHandle direction="horizontal" onResize={onResize}
      onDragStateChange={onDragStateChange} label={resizeLabel} />}
    {children}
  </Panel>;
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
