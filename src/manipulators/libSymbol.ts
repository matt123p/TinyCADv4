//
// This object deals with collections of Symbol
// objects, which are collected together to
// make a symbol
//

import { Coordinate, DocItem } from '../model/dsnItem';
import { Size } from '../model/dsnDrawing';

export interface RefPoint {
  pos: Coordinate;
  power: number;
  part: number;
}

export interface SymbolProperty {
  value: string;
  type: number;
}

export class libSymbol {
  // ID for this drawing
  public id: number;

  // Some symbol properties
  public description: string;
  public name: SymbolProperty;
  public ref: SymbolProperty;

  // Symbol definitons
  public items: DocItem[] = [];

  // Here is the size of the symbol
  public size: Size = [0, 0];
  public ref_point: RefPoint = null;
  public parts: number = 1;

  // Parts per package
  public ppp: number;

  // Globally Unique identifier
  public uid: string;

  // Hotspots for connections
  public active_points: Coordinate[];

  constructor() {
    // Here is the list of items that this collection
    // encapsulates
  }
}
