import React, { FunctionComponent, memo } from 'react';
import { Coordinate } from '../../model/dsnItem';
import { SheetDetails } from '../../model/dsnDrawing';

interface TDesignDetailsProps {
  page_size: Coordinate;
  details: SheetDetails;
}

//
// This class represents the design details box at the bottom right of the drawing
//
const TDesignDetails: FunctionComponent<TDesignDetailsProps> = (
  props: TDesignDetailsProps,
) => {
  let M_NBOXWIDTH = 400;
  let M_NLINEHEIGHT = 18;
  let M_NRULERHEIGHT = 15;
  let M_NPIXELSPERMM = 5;
  let TEXT_HEIGHT = 13;
  let RULE_HEIGHT = 10;
  let PIN_HEIGHT = 10;

  // Draw the box to house it all
  let tl = [
    props.page_size[0] - M_NBOXWIDTH - 2,
    props.page_size[1] - M_NLINEHEIGHT * 9 - 2,
  ];
  let br = [props.page_size[0] - 2, props.page_size[1] - 2];

  // Move if necessary
  if (props.details.show_guides) {
    tl[0] -= M_NRULERHEIGHT;
    tl[1] -= M_NRULERHEIGHT;
    br[0] -= M_NRULERHEIGHT;
    br[1] -= M_NRULERHEIGHT;
  }

  let LineHeight = M_NLINEHEIGHT;
  let TextSpace = LineHeight / 2;
  let VertAdjust = -TEXT_HEIGHT * 0.5;
  let BottomRow = (br[0] - tl[0]) / 3;
  let MiddleRow = br[0] - (br[0] - tl[0]) / 5;
  let font_size = TEXT_HEIGHT;

  return (
    <>
      {/* Now draw the outline */}
      <polyline
        points={
          tl[0] +
          ',' +
          tl[1] +
          ' ' +
          br[0] +
          ',' +
          tl[1] +
          ' ' +
          br[0] +
          ',' +
          br[1] +
          ' ' +
          tl[0] +
          ',' +
          br[1] +
          ' ' +
          tl[0] +
          ',' +
          tl[1]
        }
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />

      {/* Draw the horizontal lines */}
      <line
        x1={tl[0]}
        y1={tl[1] + LineHeight * 2}
        x2={br[0]}
        y2={tl[1] + LineHeight * 2}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={tl[0]}
        y1={tl[1] + LineHeight * 5}
        x2={br[0]}
        y2={tl[1] + LineHeight * 5}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={tl[0]}
        y1={tl[1] + LineHeight * 7}
        x2={br[0]}
        y2={tl[1] + LineHeight * 7}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />

      {/* Draw the vertical lines */}
      <line
        x1={MiddleRow}
        y1={tl[1] + LineHeight * 5}
        x2={MiddleRow}
        y2={tl[1] + LineHeight * 7}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={tl[0] + BottomRow}
        y1={tl[1] + LineHeight * 7}
        x2={tl[0] + BottomRow}
        y2={tl[1] + LineHeight * 9}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />
      <line
        x1={MiddleRow}
        y1={tl[1] + LineHeight * 7}
        x2={MiddleRow}
        y2={tl[1] + LineHeight * 9}
        style={{
          stroke: 'black',
          strokeWidth: 1,
          fill: 'none',
        }}
      />

      {/* Text for titles */}
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace}
        y={tl[1] + LineHeight + VertAdjust}
      >
        Title
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace}
        y={tl[1] + LineHeight * 3 + VertAdjust}
      >
        Author
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace}
        y={tl[1] + LineHeight * 6 + VertAdjust}
      >
        File
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace}
        y={tl[1] + LineHeight * 8 + VertAdjust}
      >
        Revision
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={MiddleRow + TextSpace}
        y={tl[1] + LineHeight * 6 + VertAdjust}
      >
        Document
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + BottomRow + TextSpace}
        y={tl[1] + LineHeight * 8 + VertAdjust}
      >
        Date
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={MiddleRow + TextSpace}
        y={tl[1] + LineHeight * 8 + VertAdjust}
      >
        Sheets
      </text>

      {/* Add the actual data! */}
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace * 2}
        y={tl[1] + LineHeight * 2 + VertAdjust}
      >
        {props.details.title}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace * 2}
        y={tl[1] + LineHeight * 4 + VertAdjust}
      >
        {props.details.author}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace * 2}
        y={tl[1] + LineHeight * 5 + VertAdjust}
      >
        {props.details.organisation}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace * 2}
        y={tl[1] + LineHeight * 9 + VertAdjust}
      >
        {props.details.revision}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={MiddleRow + TextSpace * 2}
        y={tl[1] + LineHeight * 7 + VertAdjust}
      >
        {props.details.docnumber}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={MiddleRow + TextSpace * 2}
        y={tl[1] + LineHeight * 9 + VertAdjust}
      >
        {props.details.sheets}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + TextSpace * 2}
        y={tl[1] + LineHeight * 7 + VertAdjust}
      >
        {props.details.filename}
      </text>
      <text
        style={{ fontSize: '13px', fontFamily: 'Arial', whiteSpace: 'pre' }}
        x={tl[0] + BottomRow + TextSpace * 2}
        y={tl[1] + LineHeight * 9 + VertAdjust}
      >
        {props.details.date}
      </text>
    </>
  );
};

export default memo(TDesignDetails);
