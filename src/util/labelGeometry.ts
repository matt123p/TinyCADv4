/** Plain-label text offset used by the SVG renderer and layout geometry. */
export function plainLabelTextOffset(rotation: number): [number, number] {
  switch (rotation & 3) {
    case 1:
      return [-3, 3];
    case 3:
      return [-3, 0];
    default:
      return [0, -3];
  }
}
