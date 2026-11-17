import React, { useEffect, useRef } from 'react';
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  horizontalHandle: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '4px',
    height: '100%',
    cursor: 'ew-resize',
    touchAction: 'none',
    backgroundColor: 'transparent',
    zIndex: 10,
    '&:hover': {
      backgroundColor: '#0078d4',
    },
    '&:active': {
      backgroundColor: '#0078d4',
    },
  },
  verticalHandle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '4px',
    cursor: 'ns-resize',
    touchAction: 'none',
    backgroundColor: 'transparent',
    zIndex: 10,
    '&:hover': {
      backgroundColor: '#0078d4',
    },
    '&:active': {
      backgroundColor: '#0078d4',
    },
  },
});

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
}

export const ResizeHandle: React.FunctionComponent<ResizeHandleProps> = (
  props: ResizeHandleProps,
) => {
  const styles = useStyles();
  const drag = useRef<{ pointerId: number; position: number }>();
  const dragStateChange = useRef(props.onDragStateChange);
  dragStateChange.current = props.onDragStateChange;

  useEffect(() => () => {
    if (drag.current) {
      drag.current = undefined;
      dragStateChange.current?.(false);
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      position: props.direction === 'horizontal' ? e.clientX : e.clientY,
    };
    props.onDragStateChange?.(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const position = props.direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = position - current.position;
    // Advance synchronously: several pointer events can arrive before a render.
    current.position = position;
    if (delta) props.onResize(delta);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    props.onDragStateChange?.(false);
  };

  return (
    <div
      className={props.direction === 'horizontal' ? styles.horizontalHandle : styles.verticalHandle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => {
        handlePointerMove(e);
        finishDrag(e);
      }}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    />
  );
};
