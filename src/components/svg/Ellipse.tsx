import React, { FunctionComponent, memo } from 'react';

import { UtilityService } from '../../util/utilityService';
import { dsnEllipse } from '../../model/dsnItem';
import { updateEllipse } from '../../manipulators/updateEllipse';

interface TEllipseProps {
  dx: number;
  dy: number;
  dr: number;
  scale_x: number;
  scale_y: number;
  data: dsnEllipse;
  hover: boolean;
  selected: boolean;
  selected_handle: number;
}

const TEllipse: FunctionComponent<TEllipseProps> = (props: TEllipseProps) => {
  const scope = UtilityService.simpleRefreshPoints(props);

  let highlight = props.selected ? (
    <ellipse
      cx={scope.x + scope.width / 2}
      cy={scope.y + scope.height / 2}
      rx={scope.width / 2}
      ry={scope.height / 2}
      className="selectedLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
    />
  ) : null;

  let selectable = props.hover ? (
    <ellipse
      cx={scope.x + scope.width / 2}
      cy={scope.y + scope.height / 2}
      rx={scope.width / 2}
      ry={scope.height / 2}
      className="selectableLineHighlight"
      strokeWidth={(props.data.line_width + 1.0) * 2}
    />
  ) : null;

  const update_item = new updateEllipse(props.data);
  return (
    <>
      <ellipse
        cx={scope.x + scope.width / 2}
        cy={scope.y + scope.height / 2}
        rx={scope.width / 2}
        ry={scope.height / 2}
        style={update_item.style()}
      />
      {selectable} {highlight}
    </>
  );
};

export default memo(TEllipse);
