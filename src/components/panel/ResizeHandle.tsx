import React, { useCallback, useEffect, useState } from 'react';
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  horizontalHandle: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '4px',
    height: '100%',
    cursor: 'ew-resize',
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
}

export const ResizeHandle: React.FunctionComponent<ResizeHandleProps> = (
  props: ResizeHandleProps,
) => {
  const styles = useStyles();
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState(0);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setStartPos(props.direction === 'horizontal' ? e.clientX : e.clientY);
  }, [props.direction]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      const currentPos = props.direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      props.onResize(delta);
      setStartPos(currentPos);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, startPos, props.direction, props.onResize]);

  return (
    <div
      className={props.direction === 'horizontal' ? styles.horizontalHandle : styles.verticalHandle}
      onPointerDown={handlePointerDown}
    />
  );
};
