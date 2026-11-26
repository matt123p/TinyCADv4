import React from 'react';
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components';
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
  { kind: 'region', label: 'Routing region' },
  { kind: 'area', label: 'Placement area' },
  { kind: 'zone', label: 'Copper zone' },
  { kind: 'cutout', label: 'Cutout' },
] as const;

export function BoardShapeMenu<Shape extends BoardDrawShape>({ label, choices, disabled, onDraw }: {
  label: string;
  choices: readonly { key: Shape; text: string; image: string }[];
  disabled: boolean;
  onDraw(shape: Shape): void;
}) {
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <MenuItem disabled={disabled}>{label}</MenuItem>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {choices.map(({ key, text, image }) => (
            <MenuItem key={key} icon={<img src={image} width={18} height={18} alt="" />}
              onClick={() => onDraw(key)}>{text}</MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
