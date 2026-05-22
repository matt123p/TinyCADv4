import React from 'react';

interface TouchLoupeProps {
  touchSvgX: number;
  touchSvgY: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  sheetName: string;
  canvasWidth: number;
  canvasHeight: number;
  onClose: () => void;
  isFingerDown: boolean;
  onLeftClick: () => void;
  onRightClick: () => void;
  onDragToggle: () => void;
  isDragging: boolean;
}

export const TouchLoupe: React.FC<TouchLoupeProps> = ({
  touchSvgX,
  touchSvgY,
  scrollX,
  scrollY,
  zoom,
  sheetName,
  canvasWidth,
  canvasHeight,
  onClose,
  isFingerDown,
  onLeftClick,
  onRightClick,
  onDragToggle,
  isDragging,
}) => {
  const M = 2.0; // Magnification factor
  const radius = 60; // Loupe radius
  const offsetDistance = 120; // Distance of loupe above finger
  
  const eventX = touchSvgX - scrollX;
  const eventY = touchSvgY - scrollY;
  
  // Dynamic offsets to prevent going off the top edge
  const startY = 190;
  const endY = 130;
  const t = Math.max(0, Math.min(1, (startY - eventY) / (startY - endY)));
  
  const isLeftHalf = eventX < canvasWidth / 2;
  const maxSideOffset = 100;
  const horizontalOffset = t * (isLeftHalf ? maxSideOffset : -maxSideOffset);
  const verticalOffset = offsetDistance - t * 80; // goes from 120 down to 40
  
  // Position relative to viewport
  let viewportLoupeX = eventX + horizontalOffset;
  let viewportLoupeY = eventY - verticalOffset;
  
  // Clamp to keep within viewport boundaries (with 10px margin)
  const margin = 10;
  viewportLoupeX = Math.max(radius + margin, Math.min(canvasWidth - radius - margin, viewportLoupeX));
  viewportLoupeY = Math.max(radius + margin, viewportLoupeY);
  
  // Convert back to SVG space
  const loupeX = viewportLoupeX + scrollX;
  const loupeY = viewportLoupeY + scrollY;
  const contentId = "sheet-content-" + sheetName.replace(/\s+/g, '-');

  return (
    <g transform={`translate(${loupeX}, ${loupeY})`}>
      <defs>
        <clipPath id="loupe-clip">
          <circle cx="0" cy="0" r={radius} />
        </clipPath>
      </defs>
      
      {/* Loupe background shadow - no pointerEvents */}
      <circle cx="0" cy="0" r={radius} fill="white" stroke="#ccc" strokeWidth="1" style={{ pointerEvents: 'none' }} />
      
      {/* Magnified content - no pointerEvents */}
      <g clipPath="url(#loupe-clip)" style={{ pointerEvents: 'none' }}>
        <use href={`#${contentId}`} transform={`scale(${M}) translate(${-touchSvgX}, ${-touchSvgY})`} />
      </g>
      
      {/* Loupe outer rim and crosshair - no pointerEvents */}
      <circle cx="0" cy="0" r={radius} fill="none" stroke="#0078d4" strokeWidth="3" style={{ pointerEvents: 'none' }} />
      <line x1={-15} y1={0} x2={15} y2={0} stroke="#0078d4" strokeWidth="1.5" style={{ pointerEvents: 'none' }} />
      <line x1={0} y1={-15} x2={0} y2={15} stroke="#0078d4" strokeWidth="1.5" style={{ pointerEvents: 'none' }} />

      {/* Interaction buttons around the loupe circle - pointerEvents: all */}
      {!isFingerDown && (
        <g style={{ pointerEvents: 'all' }}>
          {/* Top-Left: Drag/Drop Toggle */}
          <g
            onClick={(e) => {
              e.stopPropagation();
              onDragToggle();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDragToggle();
            }}
            style={{ cursor: 'pointer' }}
            transform="translate(-54, -54)"
          >
            <circle
              cx={0}
              cy={0}
              r={14}
              fill={isDragging ? '#0078d4' : 'rgba(0, 0, 0, 0.6)'}
              stroke="white"
              strokeWidth="1.5"
            />
            {/* 4-way move arrow icon */}
            <path
              d="M -7 0 L 7 0 M 0 -7 L 0 7 M -7 0 L -4 -3 M -7 0 L -4 3 M 7 0 L 4 -3 M 7 0 L 4 3 M 0 -7 L -3 -4 M 0 -7 L 3 -4 M 0 7 L -3 4 M 0 7 L 3 4"
              stroke="white"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* Top-Right: Close Button */}
          <g
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
            style={{ cursor: 'pointer' }}
            transform="translate(54, -54)"
          >
            <circle
              cx={0}
              cy={0}
              r={14}
              fill="rgba(0, 0, 0, 0.6)"
              stroke="white"
              strokeWidth="1.5"
            />
            <line x1={-5} y1={-5} x2={5} y2={5} stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1={5} y1={-5} x2={-5} y2={5} stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </g>

          {/* Bottom-Left: Left-Click */}
          <g
            onClick={(e) => {
              e.stopPropagation();
              onLeftClick();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onLeftClick();
            }}
            style={{ cursor: 'pointer' }}
            transform="translate(-54, 54)"
          >
            <circle
              cx={0}
              cy={0}
              r={14}
              fill="rgba(0, 0, 0, 0.6)"
              stroke="white"
              strokeWidth="1.5"
            />
            {/* Mouse Left-Click Highlighted */}
            <rect x={-5} y={-7} width={10} height={14} rx={5} fill="none" stroke="white" strokeWidth="1.2" />
            <line x1={0} y1={-7} x2={0} y2={0} stroke="white" strokeWidth="1.2" />
            <line x1={-5} y1={0} x2={5} y2={0} stroke="white" strokeWidth="1.2" />
            <path d="M -5 0 A 5 5 0 0 1 0 -5 L 0 0 Z" fill="white" />
          </g>

          {/* Bottom-Right: Right-Click */}
          <g
            onClick={(e) => {
              e.stopPropagation();
              onRightClick();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onRightClick();
            }}
            style={{ cursor: 'pointer' }}
            transform="translate(54, 54)"
          >
            <circle
              cx={0}
              cy={0}
              r={14}
              fill="rgba(0, 0, 0, 0.6)"
              stroke="white"
              strokeWidth="1.5"
            />
            {/* Mouse Right-Click Highlighted */}
            <rect x={-5} y={-7} width={10} height={14} rx={5} fill="none" stroke="white" strokeWidth="1.2" />
            <line x1={0} y1={-7} x2={0} y2={0} stroke="white" strokeWidth="1.2" />
            <line x1={-5} y1={0} x2={5} y2={0} stroke="white" strokeWidth="1.2" />
            <path d="M 5 0 A 5 5 0 0 0 0 -5 L 0 0 Z" fill="white" />
          </g>
        </g>
      )}
    </g>
  );
};
