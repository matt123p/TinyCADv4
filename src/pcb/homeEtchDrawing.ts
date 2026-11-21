import type { BoardDocument } from './board';
import type { BoardCamPreview } from './boardCam';
import { svgEscape, svgRegionPath } from './boardOutputDrawing';
import { readXnc } from './camReadback';
import { bounds } from './regionDistances';
import type { BoardPoint } from './geometry';
import { samePoint } from './geometry';

export type HomeEtchOrientation = 'unmirrored' | 'mirrored';

export function homeEtchDrawings(
  board: BoardDocument,
  preview: BoardCamPreview,
  orientation: HomeEtchOrientation,
) {
  if (
    board.boardId !== preview.manifest.boardId ||
    board.revision !== preview.manifest.revision ||
    board.copperLayers.length !== 1 ||
    preview.layers.length !== 1 ||
    preview.layers[0].id !== board.copperLayers[0].id ||
    board.vias?.length
  )
    throw new Error(
      'Use a current read-back preview of a single-layer board without vias.',
    );

  const { minX, minY, maxX, maxY } = bounds(preview.profile);
  const millimetres = (nm: number) => nm / 1e6;
  const mirrored = orientation === 'mirrored';
  const toSvg = ({ x, y }: BoardPoint) => ({
    x: millimetres(mirrored ? maxX - x : x - minX),
    y: millimetres(maxY - y),
  });
  const width = Math.max(128, millimetres(maxX - minX) + 10);
  const height = millimetres(maxY - minY) + 31;
  const title = svgEscape(board.title);
  const frame = (template: string, note: string, content: string) =>
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="-5 -20 ${width} ${height}" font-family="sans-serif">`,
      `<title>${title} · ${template}</title>`,
      `<text x="0" y="-15" font-size="2.6">${template} · Revision ${board.revision}</text>`,
      `<text x="0" y="-11" font-size="1.9">${
        mirrored ? 'MIRRORED · X reflected' : 'UNMIRRORED · Board top view'
      } · Print at 100%</text>`,
      '<text x="0" y="-7" font-size="1.9">Single copper layer · No hole plating · Fit and process checks required</text>',
      `<text x="0" y="-3.5" font-size="1.9">${note}</text>`,
      content,
      `<path data-calibration-mm="10" d="M0,${
        height - 25
      } H10" fill="none" stroke="black" stroke-width="0.18"/>`,
      `<text x="12" y="${
        height - 24.4
      }" font-size="1.9">10 mm · Check with a ruler before use</text>`,
      `<text x="0" y="${
        height - 21.4
      }" font-size="1.65">Teaching starting point: 0.50 mm tracks and gaps. Verify your process on a sample.</text>`,
      '</svg>',
    ].join('\n');
  const trackArtwork = preview.layers[0].copper
    .map(
      (region) =>
        `<path data-copper="true" d="${svgRegionPath(
          region,
          toSvg,
        )}" fill="black" fill-rule="evenodd"/>`,
    )
    .join('\n');
  const openings = ['plated.xnc', 'non-plated.xnc'].flatMap(
    (filename) => readXnc(preview.files[filename]).drills,
  );
  const centreMark = ({ x, y }: BoardPoint) =>
    `<path data-centre="true" d="M${x - 0.4},${y} H${x + 0.4} M${x},${
      y - 0.4
    } V${y + 0.4}" fill="none" stroke="black" stroke-width="0.10"/>`;
  const holeArtwork = openings
    .map(({ start, end, widthNm }) => {
      const a = toSvg(start);
      const b = toSvg(end);
      const diameter = millimetres(widthNm);
      const slot = !samePoint(start, end);
      return [
        slot
          ? `<path data-slot-mm="${diameter}" d="M${a.x},${a.y} L${b.x},${b.y}" stroke="#ccc" stroke-width="${diameter}" stroke-linecap="round"/>`
          : `<circle data-drill-mm="${diameter}" cx="${a.x}" cy="${a.y}" r="${
              diameter / 2
            }" fill="none" stroke="black" stroke-width="0.10"/>`,
        centreMark(a),
        slot ? centreMark(b) : '',
      ].join('\n');
    })
    .join('\n');
  const profile = `<path data-board-profile="true" d="${svgRegionPath(
    preview.profile,
    toSvg,
  )}" fill="none" stroke="black" stroke-width="0.12"/>`;
  return {
    copper: frame(
      'Home-etch copper artwork',
      'Black marks intended copper. Check the transfer orientation with an asymmetric feature.',
      trackArtwork,
    ),
    drill: frame(
      'Home-etch drill template',
      'Use centre marks for holes and both slot endpoints. Check tool diameter and physical fit.',
      profile + '\n' + holeArtwork,
    ),
  };
}
