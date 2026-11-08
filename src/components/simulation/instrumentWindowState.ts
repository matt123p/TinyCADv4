import { ChartPopup, openChartPopup } from './ChartPopup';

// Shared by the docked panel and popup host without importing either component.
// Keeping this state outside the host avoids a cycle across Parcel lazy chunks.
export const instrumentWindows = new Map<
  string,
  { document: string; sheet: string; id: number; popup: ChartPopup }
>();
export const instrumentWindowListeners = new Set<() => void>();
const publish = () => instrumentWindowListeners.forEach((fn) => fn());

export function openInstrumentWindow(
  document: string,
  sheet: string,
  id: number,
  title: string,
): boolean {
  const key = `${document}:${sheet}:${id}`,
    existing = instrumentWindows.get(key);
  if (existing && !existing.popup.child.closed) {
    existing.popup.child.focus();
    return true;
  }
  const popup = openChartPopup(title);
  if (!popup) return false;
  instrumentWindows.set(key, { document, sheet, id, popup });
  publish();
  return true;
}

export function closeInstrumentWindow(key: string) {
  const entry = instrumentWindows.get(key);
  instrumentWindows.delete(key);
  if (entry && !entry.popup.child.closed) entry.popup.child.close();
  publish();
}
