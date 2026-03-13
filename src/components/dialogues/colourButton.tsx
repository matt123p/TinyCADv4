import React, { FunctionComponent } from 'react';

interface ColourButtonProps {
  name: string;
  selected: string;
  colour: string;
  'button-text': string;
  onClick(name: string): void;
}

//
// This class represents a colour picker button (for dialouges)
//
export const ColourButton: FunctionComponent<ColourButtonProps> = (
  props: ColourButtonProps,
) => {
  let selected = props.name === props.selected;
  return (
    <div
      style={{ width: '10rem' }}
      onClick={props.onClick ? () => props.onClick(props.name) : null}
      className={selected ? 'colour-button-selected' : 'colour-button'}
    >
      <div
        style={{
          width: '1rem',
          height: '1rem',
          display: 'inline-block',
          marginRight: '0.25rem',
          marginLeft: '0.25rem',
          backgroundColor: props.colour,
          borderStyle: 'solid',
          borderColor: 'black',
          borderWidth: '1px',
        }}
      />
      {props['button-text']}
    </div>
  );
};
