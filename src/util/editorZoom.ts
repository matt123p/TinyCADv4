const editorZoomStep = 1.25;

export const schematicZoomLimits = { min: 10, max: 400 } as const;

export function clampSchematicZoom(zoom: number) {
  return Math.max(schematicZoomLimits.min, Math.min(schematicZoomLimits.max, zoom));
}

export function zoomStepFactor(direction: 'in' | 'out') {
  return direction === 'in' ? editorZoomStep : 1 / editorZoomStep;
}

export function clampPinchZoomFactor(factor: number) {
  return Math.min(editorZoomStep, Math.max(1 / editorZoomStep, factor));
}

export function wheelZoomFactor(
  { ctrlKey, shiftKey, deltaY }: Pick<WheelEvent, 'ctrlKey' | 'shiftKey' | 'deltaY'>,
  zoomWithoutModifier = false,
) {
  if (!deltaY) return undefined;
  if (ctrlKey) {
    return clampPinchZoomFactor(Math.exp(-deltaY * Math.log(editorZoomStep) / 100));
  }
  if (shiftKey || zoomWithoutModifier) return zoomStepFactor(deltaY < 0 ? 'in' : 'out');
}
