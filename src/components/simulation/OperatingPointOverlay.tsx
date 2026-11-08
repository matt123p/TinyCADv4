import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import {
  getOperatingPoint,
  operatingAnnotations,
  overlayMode,
  subscribeOverlay,
} from '../../simulation/operatingPoint';
export function OperatingPointOverlay({ sheetName }: { sheetName: string }) {
  const { drawing, editing } = useSelector((s: docDrawing) => ({
    drawing: s.docStore.present.drawing,
    editing: !!s.docStore.present.editSymbol,
  }));
  const [, refresh] = useState(0);
  useEffect(() => subscribeOverlay(() => refresh((n) => n + 1)), []);
  const acquisition = getOperatingPoint();
  if (editing || !acquisition?.fresh || acquisition.drawing !== drawing)
    return null;
  const annotations = operatingAnnotations(
    drawing,
    acquisition.net,
    acquisition.data,
    acquisition.run,
    sheetName,
    overlayMode(drawing.documentId),
  );
  return (
    <g
      pointerEvents="none"
      aria-label="DC operating point"
      fontFamily="Segoe UI, sans-serif"
      fontSize={9}
      fill="#006b55"
      stroke="white"
      strokeWidth={2.5}
      paintOrder="stroke"
    >
      {annotations.map((a, i) => (
        <text key={i} x={a.x} y={a.y}>
          <title>{a.detail}</title>
          {a.text}
        </text>
      ))}
    </g>
  );
}
