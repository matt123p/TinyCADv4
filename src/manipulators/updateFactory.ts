import { DocItem, DocItemTypes } from '../model/dsnItem';
import { updateBusLabel } from './updateBusLabel';
import { updateLabel } from './updateLabel';
import { updatePower } from './updatePower';
import { updateSymbol } from './updateSymbol';
import { updateText } from './updateText';
import { updateWire } from './updateWire';
import { updateBusSlash } from './updateBusSlash';
import { updateBusWire } from './updateBusWire';
import { updateDesignRuler } from './updateDesignRuler';
import { updateEllipse } from './updateEllipse';
import { updateJunction } from './updateJunction';
import { updateLine } from './updateLine';
import { updateNoConnect } from './updateNoConnect';
import { updatePin } from './updatePin';
import { updateRectangle } from './updateRectangle';
import { updatePointBase } from './updatePointBase';
import { updateRectBase } from './updateRectBase';
import { updateImage } from './updateImage';

export function updateFactory(item: DocItem) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusLabel:
      return new updateBusLabel(item);
    case DocItemTypes.BusSlash:
      return new updateBusSlash(item);
    case DocItemTypes.BusWire:
      return new updateBusWire(item);
    case DocItemTypes.Ruler:
      return new updateDesignRuler(item);
    case DocItemTypes.Ellipse:
      return new updateEllipse(item);
    case DocItemTypes.Junction:
      return new updateJunction(item);
    case DocItemTypes.Label:
      return new updateLabel(item);
    case DocItemTypes.Line:
      return new updateLine(item);
    case DocItemTypes.NoConnect:
      return new updateNoConnect(item);
    case DocItemTypes.Pin:
      return new updatePin(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Rectangle:
      return new updateRectangle(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
    case DocItemTypes.Text:
      return new updateText(item);
    case DocItemTypes.Wire:
      return new updateWire(item);
    case DocItemTypes.Image:
      return new updateImage(item);
  }

  return null;
}

export function updateAPFactory(item: DocItem) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
    case DocItemTypes.Wire:
      return new updateWire(item);
    case DocItemTypes.BusWire:
      return new updateBusWire(item);
  }

  return null;
}

export function updateTextFactory(item: DocItem) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusLabel:
      return new updateBusLabel(item);
    case DocItemTypes.Label:
      return new updateLabel(item);
    case DocItemTypes.Pin:
      return new updatePin(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
    case DocItemTypes.Text:
      return new updateText(item);
  }

  return null;
}

export function updateSimpleAddFactory(item: any) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusLabel:
      return new updateBusLabel(item);
    case DocItemTypes.BusSlash:
      return new updateBusSlash(item);
    case DocItemTypes.BusWire:
      return new updateBusWire(item);
    case DocItemTypes.Ruler:
      return new updateDesignRuler(item);
    case DocItemTypes.Ellipse:
      return new updateEllipse(item);
    case DocItemTypes.Label:
      return new updateLabel(item);
    case DocItemTypes.Line:
      return new updateLine(item);
    case DocItemTypes.NoConnect:
      return new updateNoConnect(item);
    case DocItemTypes.Pin:
      return new updatePin(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Rectangle:
      return new updateRectangle(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
    case DocItemTypes.Text:
      return new updateText(item);
    case DocItemTypes.Wire:
      return new updateWire(item);
    case DocItemTypes.Image:
      return new updateImage(item);
  }

  return null;
}

export function updateSimpleDragFactory(item: any) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusWire:
      return new updateBusWire(item);
    case DocItemTypes.Wire:
      return new updateWire(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
  }

  return null;
}

export function updateLineFactoryFactory(item: any) {
  if (item == null) {
    return null;
  }
  switch (item.NodeName) {
    case DocItemTypes.Line:
      return new updateLine(item);
  }

  return null;
}

export function updateMoveAddFactory(item: any) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusWire:
      return new updateBusWire(item);
    case DocItemTypes.Wire:
      return new updateWire(item);
    case DocItemTypes.Ellipse:
      return new updateEllipse(item);
    case DocItemTypes.Rectangle:
      return new updateRectangle(item);
    case DocItemTypes.Line:
      return new updateLine(item);
    case DocItemTypes.Text:
      return new updateText(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Image:
      return new updateImage(item);
  }
  return null;
}

export function updateRotateFactory(item: any) {
  if (item == null) {
    return null;
  }

  switch (item.NodeName) {
    case DocItemTypes.BusLabel:
      return new updateBusLabel(item);
    case DocItemTypes.BusSlash:
      return new updateBusSlash(item);
    case DocItemTypes.Ruler:
      return new updateDesignRuler(item);
    case DocItemTypes.Ellipse:
      return new updateEllipse(item);
    case DocItemTypes.Label:
      return new updateLabel(item);
    case DocItemTypes.Line:
      return new updateLine(item);
    case DocItemTypes.Pin:
      return new updatePin(item);
    case DocItemTypes.Power:
      return new updatePower(item);
    case DocItemTypes.Rectangle:
      return new updateRectangle(item);
    case DocItemTypes.Symbol:
      return new updateSymbol(item);
    case DocItemTypes.Text:
      return new updateText(item);
    case DocItemTypes.Image:
      return new updateImage(item);
  }

  return null;
}

export type Updater =
  | updateBusLabel
  | updateBusSlash
  | updateBusWire
  | updateDesignRuler
  | updateEllipse
  | updateJunction
  | updateLabel
  | updateLine
  | updateNoConnect
  | updatePin
  | updatePower
  | updateRectangle
  | updateSymbol
  | updateText
  | updateWire
  | updatePointBase
  | updateRectBase;
