import React, { FunctionComponent, memo } from 'react';
import { Coordinate } from '../../model/dsnItem';
import { SheetDetails } from '../../model/dsnDrawing';

interface TDesignGuidesProps {
  page_size: Coordinate;
  details: SheetDetails;
}

//
// This class represents the design guides around the drawing
//
const TDesignGuides: FunctionComponent<TDesignGuidesProps> = (
  props: TDesignGuidesProps,
) => {
  // Draw the outline box
  let M_NRULERHEIGHT = 15;
  let font_size = 10;
  let tl1 = [0, 0];
  let tl2 = [M_NRULERHEIGHT + 2, M_NRULERHEIGHT + 2];
  let br2 = [
    props.page_size[0] - M_NRULERHEIGHT - 2,
    props.page_size[1] - M_NRULERHEIGHT - 2,
  ];
  let br1 = [props.page_size[0] - 2, props.page_size[1] - 2];

  let drawing = [];
  let split = (br1[0] - tl1[0]) / props.details.horiz_guide;
  for (let col = 0; col < props.details.horiz_guide; ++col) {
    drawing.push(
      <line
        x1={col * split}
        y1={tl1[1]}
        x2={col * split}
        y2={tl2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
        key={'A' + col * split}
      />,
    );
    drawing.push(
      <line
        x1={col * split}
        y1={br1[1]}
        x2={col * split}
        y2={br2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
        key={'B' + col * split}
      />,
    );
    drawing.push(
      <text
        textAnchor="middle"
        x={split * col + split / 2}
        y={tl2[1] - 5}
        fontFamily="sans-serif"
        fontSize={font_size}
        key={'C' + col * split}
      >
        {col + 1}
      </text>,
    );
    drawing.push(
      <text
        textAnchor="middle"
        x={split * col + split / 2}
        y={br1[1] - 4}
        fontFamily="sans-serif"
        fontSize={font_size}
        key={'D' + col * split}
      >
        {col + 1}
      </text>,
    );
  }

  split = (br1[1] - tl1[1]) / props.details.vert_guide;
  for (let row = 0; row < props.details.vert_guide; row++) {
    drawing.push(
      <line
        x1={tl1[0]}
        y1={row * split}
        x2={tl2[0]}
        y2={row * split}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
        key={'E' + row * split}
      />,
    );
    drawing.push(
      <line
        x1={br1[0]}
        y1={row * split}
        x2={br2[0]}
        y2={row * split}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
        key={'F' + row * split + 1}
      />,
    );
    let y = split * row + split / 2;
    let x = tl2[0] - 5;
    drawing.push(
      <text
        textAnchor="middle"
        x={x}
        y={y}
        fontFamily="sans-serif"
        fontSize={font_size}
        key={'G' + y}
        transform={'rotate(-90,' + x + ',' + y + ')'}
      >
        {String.fromCharCode(row + 65)}
      </text>,
    );
    x = br1[0] - 4;
    drawing.push(
      <text
        textAnchor="middle"
        x={x}
        y={y}
        fontFamily="sans-serif"
        fontSize={font_size}
        key={'H' + y}
        transform={'rotate(-90,' + x + ',' + y + ')'}
      >
        {String.fromCharCode(row + 65)}
      </text>,
    );
  }

  return (
    <>
      {/* Draw the 4 lines that make up the outer boarder */}
      <polyline
        points={
          tl1[0] +
          ',' +
          tl1[1] +
          ' ' +
          br1[0] +
          ',' +
          tl1[1] +
          ' ' +
          br1[0] +
          ',' +
          br1[1] +
          ' ' +
          tl1[0] +
          ',' +
          br1[1] +
          ' ' +
          tl1[0] +
          ',' +
          tl1[1]
        }
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />

      {/* Draw the 4 lines that make up the inner boarder */}
      <polyline
        points={
          tl2[0] +
          ',' +
          tl2[1] +
          ' ' +
          br2[0] +
          ',' +
          tl2[1] +
          ' ' +
          br2[0] +
          ',' +
          br2[1] +
          ' ' +
          tl2[0] +
          ',' +
          br2[1] +
          ' ' +
          tl2[0] +
          ',' +
          tl2[1]
        }
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      {/* Now draw the cross bracings */}
      <line
        x1={tl1[0]}
        y1={tl1[1]}
        x2={tl2[0]}
        y2={tl2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={br1[0]}
        y1={br1[1]}
        x2={br2[0]}
        y2={br2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={br1[0]}
        y1={tl1[1]}
        x2={br2[0]}
        y2={tl2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={tl1[0]}
        y1={br1[1]}
        x2={tl2[0]}
        y2={br2[1]}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      {drawing}
    </>
  );
};

export default memo(TDesignGuides);
