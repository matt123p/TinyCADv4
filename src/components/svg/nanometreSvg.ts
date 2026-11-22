// SVG length attributes can clamp large nanometre values. Use micrometre
// lengths for native shapes and scale them back into the drawing coordinates.
const nanometresPerSvgUnit = 1_000;

export const svgLength = (nanometres: number) => nanometres / nanometresPerSvgUnit;
export const svgLengthTransform = `scale(${nanometresPerSvgUnit})`;

export function svgCircle(x: number, y: number, radius: number) {
  return { cx: svgLength(x), cy: svgLength(y), r: svgLength(radius), transform: svgLengthTransform };
}

// The matrix's numeric translation preserves large offsets in SVG user units.
export function svgTranslation(x: number, y: number, scale = 1) {
  return `matrix(${scale} 0 0 ${scale} ${x} ${y})`;
}
