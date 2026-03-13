import React, { FunctionComponent, memo } from 'react';
import { dsnDesignRuler } from '../../model/dsnItem';

interface TDesignRulerProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnDesignRuler;
  hover: boolean;
  selected: boolean;
}

const TDesignRuler: FunctionComponent<TDesignRulerProps> = (
  props: TDesignRulerProps,
) => {
  const item = props.data;

  // The actual line
  let line = null;
  if (item.rotation === 0) {
    line = (
      <>
        <line
          x1="-1000000"
          x2="1000000"
          y1={item.point[1]}
          y2={item.point[1]}
          style={{ stroke: 'black', strokeWidth: 1 }}
        />
        <text
          x="2"
          y={item.point[1] - 6}
          style={{ fill: 'black', fillOpacity: 0.5, fontSize: '16px' }}
        >
          {item.point[1]}
        </text>
        {props.hover ? (
          <line
            x1="-1000000"
            x2="1000000"
            y1={item.point[1]}
            y2={item.point[1]}
            className="selectableHighlight"
          />
        ) : null}
      </>
    );
  } else {
    line = (
      <>
        <line
          y1="-1000000"
          y2="1000000"
          x1={item.point[0]}
          x2={item.point[0]}
          style={{ stroke: 'black', strokeWidth: 1 }}
        />
        <text
          y="2"
          writingMode="tb-rl"
          x={item.point[0] + 9}
          style={{ fill: 'black', fillOpacity: 0.5, fontSize: '16px' }}
        >
          {item.point[0]}
        </text>
        {props.hover ? (
          <line
            y1="-1000000"
            y2="1000000"
            x1={item.point[0]}
            x2={item.point[0]}
            className="selectableHighlight"
          />
        ) : null}
      </>
    );
  }

  return line;
};

export default memo(TDesignRuler);
