import React from 'react';
import { ToolbarButton, ToolbarDivider } from '@fluentui/react-components';
import { RulerRegular, ZoomInRegular, ZoomOutRegular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';

interface ViewToolbarControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  showRulers: boolean;
  dividerClassName?: string;
  highlightClassName?: string;
  onZoom(direction: 'in' | 'out'): void;
  onToggleRulers(): void;
}

export function ViewToolbarControls({
  canZoomIn, canZoomOut, showRulers, dividerClassName, highlightClassName, onZoom, onToggleRulers,
}: ViewToolbarControlsProps) {
  const { t } = useTranslation();
  const zoomIn = t('toolbar.zoomIn');
  const zoomOut = t('toolbar.zoomOut');
  const rulers = t('toolbar.toggleRulers');
  return (
    <>
      <ToolbarButton aria-label={zoomIn} title={zoomIn} icon={<ZoomInRegular />}
        disabled={!canZoomIn} onClick={() => onZoom('in')} />
      <ToolbarButton aria-label={zoomOut} title={zoomOut} icon={<ZoomOutRegular />}
        disabled={!canZoomOut} onClick={() => onZoom('out')} />
      <ToolbarDivider className={dividerClassName} />
      <ToolbarButton aria-label={rulers} title={rulers} icon={<RulerRegular />}
        className={showRulers ? highlightClassName : undefined} aria-pressed={showRulers}
        onClick={onToggleRulers} />
    </>
  );
}
