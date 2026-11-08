import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import { DocItemTypes } from '../../model/dsnItem';
import { ChartPopup, ChartPopupPortal, openChartPopup } from './ChartPopup';
import { InstrumentPanel } from '../panel/InstrumentPanel';
import { readControl } from '../../simulation/controls';
const entries = new Map<
    string,
    { document: string; sheet: string; id: number; popup: ChartPopup }
  >(),
  listeners = new Set<() => void>();
const publish = () => listeners.forEach((fn) => fn());
export function openInstrumentWindow(
  document: string,
  sheet: string,
  id: number,
  title: string,
): boolean {
  const key = `${document}:${sheet}:${id}`,
    existing = entries.get(key);
  if (existing && !existing.popup.child.closed) {
    existing.popup.child.focus();
    return true;
  }
  const popup = openChartPopup(title);
  if (!popup) return false;
  entries.set(key, { document, sheet, id, popup });
  publish();
  return true;
}
function close(key: string) {
  const entry = entries.get(key);
  entries.delete(key);
  if (entry && !entry.popup.child.closed) entry.popup.child.close();
  publish();
}
export function InstrumentWindowHost() {
  const drawing = useSelector((s: docDrawing) => s.docStore.present.drawing),
    dispatch = useDispatch(),
    [, refresh] = useState(0);
  useEffect(() => {
    const fn = () => refresh((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  useEffect(
    () => () => {
      for (const [key, entry] of entries)
        if (entry.document === drawing.documentId) close(key);
    },
    [drawing.documentId],
  );
  useEffect(() => {
    for (const [key, e] of entries) {
      const symbol = drawing.sheets
        .find((s) => s.id === e.sheet)
        ?.items.find((i) => i._id === e.id);
      if (
        e.document !== drawing.documentId ||
        symbol?.NodeName !== DocItemTypes.Symbol ||
        readControl(symbol)?.kind !== 'instrument'
      )
        close(key);
    }
  }, [drawing]);
  return (
    <>
      {[...entries].map(([key, e]) => {
        const symbol = drawing.sheets
          .find((s) => s.id === e.sheet)
          ?.items.find((i) => i._id === e.id);
        return symbol?.NodeName === DocItemTypes.Symbol &&
          e.document === drawing.documentId ? (
          <ChartPopupPortal
            key={key}
            popup={e.popup}
            onClose={() => close(key)}
          >
            <InstrumentPanel
              symbol={symbol}
              drawing={drawing}
              dispatch={dispatch}
              windowClose={() => close(key)}
            />
          </ChartPopupPortal>
        ) : null;
      })}
    </>
  );
}
