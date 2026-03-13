import React, { FunctionComponent, memo } from 'react';
import { libHatch, libImage } from '../../model/dsnDrawing';

interface TSvgDefsProps {
  images: { [key: string]: libImage };
  hatches: libHatch[];
}

const TSvgDefs: FunctionComponent<TSvgDefsProps> = (props: TSvgDefsProps) => {
  let images = props.images
    ? Object.keys(props.images).map((id) => {
        const img = props.images[id];
        return (
          <image
            key={id}
            id={`img_${img.id}`}
            preserveAspectRatio="none"
            href={img.imageData}
            x="0"
            y="0"
            width="1"
            height="1"
          />
        );
      })
    : [];

  let hatches = props.hatches.map((hatch) => {
    switch (hatch.index) {
      case 1: // Horizontal
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,0 l8,0"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
      case 2: // Vertical
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,0 l0,8"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
      case 3: // Downwards
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,0 l8,8"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
      case 4: // Upwards
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,8 l8,-8"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
      case 5: // Cross
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,0 l8,0 M0,0 l0,8"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
      case 6: // Diagonal cross
        return (
          <pattern
            key={hatch.id}
            id={hatch.id}
            patternUnits="userSpaceOnUse"
            width="8"
            height="8"
          >
            <path
              d="M0,8 l8,-8 M0,0 l8,8"
              style={{ stroke: hatch.color, strokeWidth: 1 }}
            />
          </pattern>
        );
    }
  });

  return (
    <defs>
      <filter id="dropshadow" height="130%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
        <feOffset dx="1" dy="1" result="offsetblur" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {images}
      {hatches}
    </defs>
  );
};

export default memo(TSvgDefs);
