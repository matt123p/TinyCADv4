import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { FootprintPlacement } from './footprint';
import type { FootprintModelTransform } from './footprintDetails';

const radians = (microdegree: number) => (microdegree * Math.PI) / 180_000_000;

export function boardMountMatrix(
  placement: FootprintPlacement,
  thicknessMm: number,
): Matrix4 {
  const { positionNm, rotationMicrodegree, side } = placement;
  return new Matrix4()
    .makeTranslation(
      positionNm.x / 1e6,
      positionNm.y / 1e6,
      thicknessMm * (side === 'top' ? 0.5 : -0.5),
    )
    .multiply(new Matrix4().makeRotationZ(radians(rotationMicrodegree)))
    .multiply(new Matrix4().makeRotationY(side === 'top' ? 0 : Math.PI));
}

export function modelLocalMatrix({
  offsetNm,
  rotationMicrodegree,
  scale,
}: FootprintModelTransform): Matrix4 {
  const [rx, ry, rz] = rotationMicrodegree.map(radians);
  // Local STEP coordinates are scaled, rotated X/Y/Z, then translated in millimetres.
  return new Matrix4().compose(
    new Vector3(offsetNm[0] / 1e6, offsetNm[1] / 1e6, offsetNm[2] / 1e6),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz, 'ZYX')),
    new Vector3(...scale),
  );
}
