import React, { Dispatch, FunctionComponent, memo } from 'react';
import { TDrawing } from './Drawing';
import TDesignDetails from './DesignDetails';
import TDesignGuides from './DesignGuides';
import { Coordinate, DocItem } from '../../model/dsnItem';
import TSvgDefs from './SvgDefs';
import {
  SheetDetails,
  SheetOptions,
  libImage,
  libHatch,
} from '../../model/dsnDrawing';

interface TPrintSheetProps {
  items: DocItem[];
  page_size: Coordinate;
  details: SheetDetails;
  options: SheetOptions;
  images: { [key: string]: libImage };
  hatches: libHatch[];
}

//
// This component represents editing a single sheet of a TinyCAD drawing for printing
//

const TPrintSheet: FunctionComponent<TPrintSheetProps> = (
  props: TPrintSheetProps,
) => {
  return (
    <svg
      viewBox={`0 0 ${props.page_size[0]} ${props.page_size[1]}`}
      width={props.page_size[0] / 5.0 + 'mm'}
      height={props.page_size[1] / 5.0 + 'mm'}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
    >
      <TSvgDefs images={props.images} hatches={props.hatches} />
      <g>
        {props.details.show_details ? (
          <TDesignDetails details={props.details} page_size={props.page_size} />
        ) : null}
        {props.details.show_guides ? (
          <TDesignGuides details={props.details} page_size={props.page_size} />
        ) : null}
        <TDrawing
          dx={0}
          dy={0}
          dr={0}
          items={props.items}
          hover_obj={null}
          selection={[]}
          selected_handle={0}
          options={props.options}
          add={null}
          hover={false}
          parent={null}
          part={0}
          selected={false}
          show_power={false}
          scale_x={1.0}
          scale_y={1.0}
          editLibrary={false}
          heterogeneous={false}
        />
      </g>
    </svg>
  );
};

export default memo(TPrintSheet);
