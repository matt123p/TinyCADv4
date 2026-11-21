export const editorZoomStep = 1.25;

export function wheelPinchZoomFactor(deltaY: number) {
  const factor = Math.exp(-deltaY * Math.log(editorZoomStep) / 100);
  return Math.min(editorZoomStep, Math.max(1 / editorZoomStep, factor));
}
