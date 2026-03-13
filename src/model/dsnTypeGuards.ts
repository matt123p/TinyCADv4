import { Stroked, Filled, Text, DocItemTypes } from './dsnItem';

export function isStroked(item: any): item is Stroked {
  switch (item?.NodeName) {
    case DocItemTypes.Line:
    case DocItemTypes.Rectangle:
    case DocItemTypes.Text:
    case DocItemTypes.Ellipse:
      return true;
  }
  return false;
}

export function isFilled(item: any): item is Filled {
  switch (item?.NodeName) {
    case DocItemTypes.Rectangle:
    case DocItemTypes.Text:
    case DocItemTypes.Ellipse:
      return true;
    case DocItemTypes.Line:
      return item.polygon;
  }
  return false;
}

export function isText(item: any): item is Text {
  switch (item?.NodeName) {
    case DocItemTypes.Symbol:
    case DocItemTypes.Text:
    case DocItemTypes.BusLabel:
    case DocItemTypes.Label:
    case DocItemTypes.Power:
      return true;
  }
  return false;
}

export function isTextColour(item: any): item is Text {
  switch (item?.NodeName) {
    case DocItemTypes.Text:
    case DocItemTypes.Label:
    case DocItemTypes.BusLabel:
      return true;
  }
  return false;
}

export function isBorderStyle(item: any): item is Filled {
  switch (item?.NodeName) {
    case DocItemTypes.Text:
    case DocItemTypes.Rectangle:
      return true;
  }
  return false;
}
