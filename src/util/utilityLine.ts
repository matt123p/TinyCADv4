//
// The line utilities

import { Coordinate } from '../model/dsnItem';

//
export class UtilityLine {
  //
  // Calculate the nearest point on a line (assuming line is infinite)
  //
  static nearestPointOnLineInf(a: Coordinate, p1: Coordinate, p2: Coordinate) {
    // Is the line horizontal or vertical?
    if (p1[0] === p2[0]) {
      // Vertical
      return [p1[0], a[1]];
    }
    if (p1[1] === p2[1]) {
      // Horizontal
      return [a[0], p1[1]];
    }

    // First convert to formula: y = mx + k
    let m = (p2[1] - p1[1]) / (p2[0] - p1[0]);
    let k = p1[1] - m * p1[0];

    // Solve for X & Y
    let x = (a[0] + m * a[1] - m * k) / (m * m + 1);
    let y = m * ((a[0] + m * a[1] - m * k) / (m * m + 1)) + k;

    return [x, y];
  }

  //
  // Calculate the nearest point on a line (assuming line is finite)
  //
  static nearestPointOnLine(a: Coordinate, p1: Coordinate, p2: Coordinate) {
    let r = UtilityLine.nearestPointOnLineInf(a, p1, p2);

    // Is this point outside of the line?
    // See if the point is outside of the bounding box
    // created by p1 & p2
    let x1 = Math.min(p1[0], p2[0]);
    let y1 = Math.min(p1[1], p2[1]);
    let x2 = Math.max(p1[0], p2[0]);
    let y2 = Math.max(p1[1], p2[1]);

    if (r[0] < x1 || r[0] > x2 || r[1] < y1 || r[1] > y2) {
      // Ok, outside of the line, so returned the nearest
      // point (p1 or p2) to the line
      let d1 =
        (r[0] - p1[0]) * (r[0] - p1[0]) + (r[1] - p1[1]) * (r[1] - p1[1]);
      let d2 =
        (r[0] - p2[0]) * (r[0] - p2[0]) + (r[1] - p2[1]) * (r[1] - p2[1]);

      if (d1 < d2) {
        r = p1;
      } else {
        r = p2;
      }
    }

    return r;
  }

  static distance2PointFromLine(a: Coordinate, p1: Coordinate, p2: Coordinate) {
    let r = UtilityLine.nearestPointOnLine(a, p1, p2);
    return (r[0] - a[0]) * (r[0] - a[0]) + (r[1] - a[1]) * (r[1] - a[1]);
  }
}
