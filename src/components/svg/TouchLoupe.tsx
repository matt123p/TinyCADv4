import React, { useId } from 'react';
import i18n from '../../i18n';

interface TouchLoupeProps {
  touchSvgX: number;
  touchSvgY: number;
  scrollX: number;
  scrollY: number;
  sheetName: string;
  canvasWidth: number;
  canvasHeight: number;
  onClose: () => void;
  onLeftClick: () => void;
  onRightClick: () => void;
  onDragToggle: () => void;
  isDragging: boolean;
}

// The lens stays in one place while the canvas acts as a relative trackpad.
// Keeping the controls visible lets a second finger place or drop an object.
export const TouchLoupe: React.FC<TouchLoupeProps> = ({
  touchSvgX, touchSvgY, scrollX, scrollY, sheetName,
  canvasWidth, canvasHeight, onClose, onLeftClick, onRightClick,
  onDragToggle, isDragging,
}) => {
  const clipId = `touch-loupe-${useId().replace(/:/g, '')}`;
  const width = 200;
  const radius = 70;
  const height = 232;
  const margin = 12;
  const x = scrollX + Math.max(0, canvasWidth - width - margin);
  const y = scrollY + Math.min(margin, Math.max(0, canvasHeight - height));
  const contentId = 'sheet-content-' + sheetName.replace(/\s+/g, '-');
  const controls = [
    { label: i18n.t('touchLoupe.click'), action: onLeftClick, icon: '↖' },
    { label: i18n.t(isDragging ? 'touchLoupe.drop' : 'touchLoupe.drag'), action: onDragToggle, icon: '✥', active: isDragging },
    { label: i18n.t('touchLoupe.menu'), action: onRightClick, icon: '⋯' },
    { label: i18n.t('common.close'), action: onClose, icon: '×' },
  ];

  return (
    <g transform={`translate(${x}, ${y})`} data-touch-loupe="" style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={width / 2} cy={radius + 8} r={radius} />
        </clipPath>
      </defs>
      <rect width={width} height={height} rx={12} fill="white" stroke="#b3b3b3" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx={width / 2} cy={radius + 8} r={radius} fill="white" />
        <use href={`#${contentId}`}
          transform={`translate(${width / 2}, ${radius + 8}) scale(2) translate(${-touchSvgX}, ${-touchSvgY})`} />
      </g>
      <circle cx={width / 2} cy={radius + 8} r={radius} fill="none" stroke="#0078d4" strokeWidth={2} />
      <path d={`M 86 78 H 114 M 100 64 V 92`} stroke="white" strokeWidth={4} />
      <path d={`M 86 78 H 114 M 100 64 V 92`} stroke="#0078d4" strokeWidth={1.5} />
      <text x={width / 2} y={223} textAnchor="middle" fontSize={11} fill="#555">{i18n.t('touchLoupe.hint')}</text>
      {controls.map(({ label, action, icon, active }, index) => (
        <g key={index} data-loupe-control="" role="button" aria-label={label}
          aria-pressed={index === 1 ? isDragging : undefined} tabIndex={0}
          transform={`translate(${4 + index * 49}, 158)`}
          style={{ pointerEvents: 'all', cursor: 'pointer', touchAction: 'none' }}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); action(); }}
          onTouchStart={(e) => { e.stopPropagation(); }}
          onTouchMove={(e) => { e.stopPropagation(); }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            // Suppress the compatibility click so each tap performs one action.
            if (e.cancelable) e.preventDefault();
            const touch = e.changedTouches[0];
            const rect = e.currentTarget.getBoundingClientRect();
            if (touch && touch.clientX >= rect.left && touch.clientX <= rect.right &&
                touch.clientY >= rect.top && touch.clientY <= rect.bottom) action();
          }}
          onTouchCancel={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              action();
            }
          }}>
          <rect width={44} height={48} rx={6} fill={active ? '#0078d4' : '#f0f3f6'} />
          <text x={22} y={22} textAnchor="middle" fontSize={22} fill={active ? 'white' : '#17456b'}>{icon}</text>
          <text x={22} y={40} textAnchor="middle" fontSize={10} fill={active ? 'white' : '#17456b'}>{label}</text>
        </g>
      ))}
    </g>
  );
};
