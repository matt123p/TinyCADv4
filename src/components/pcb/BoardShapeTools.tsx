import React from 'react';
import { SplitMenuButton } from '../toolbar/SplitMenuButton';
import { rectangleImage, ellipseImage, lineImage } from '../toolbar/shapeToolImages';

export const areaToolShapes = [
  { key: 'rectangle', text: 'Rectangle', image: rectangleImage },
  { key: 'polygon', text: 'Polygon', image: lineImage },
  { key: 'ellipse', text: 'Circle / ellipse', image: ellipseImage },
] as const;
export type AreaToolShape = (typeof areaToolShapes)[number]['key'];
export type BoardDrawShape = AreaToolShape | 'round-hole' | 'slot' | 'line';
export const openingToolShapes = [
  { key: 'round-hole', text: 'Round hole', image: ellipseImage },
  { key: 'slot', text: 'Slot', image: rectangleImage },
] as const;
export type OpeningToolShape = (typeof openingToolShapes)[number]['key'];
export const areaTools = [
  { kind: 'region', label: 'Routing area', buttonLabel: 'Routing' },
  { kind: 'area', label: 'Placement area', buttonLabel: 'Placement' },
  { kind: 'zone', label: 'Copper area', buttonLabel: 'Copper' },
  { kind: 'cutout', label: 'Board cutout', buttonLabel: 'Cutout' },
] as const;
export type AreaTool = (typeof areaTools)[number]['kind'];

export function BoardShapeTool<Shape extends BoardDrawShape>({ label, buttonLabel, choices, current, active, disabled, onDraw }: {
  label: string; buttonLabel: string; current: Shape; active: boolean; disabled: boolean;
  choices: readonly { key: Shape; text: string; image: string }[];
  onDraw(shape: Shape): void;
}) {
  return <SplitMenuButton text={label} buttonLabel={buttonLabel} optionsSuffix="shape options" highlighted={active} disabled={disabled}
    mainImage={choices.find(({ key }) => key === current).image} onMainClick={() => onDraw(current)}
    menuItems={choices}
    onMenuItemClick={({ key }) => onDraw(key)} />;
}
