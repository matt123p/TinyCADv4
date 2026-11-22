import React from 'react';

export function DrawingViewportFrame({ children, height = '100%', rulers, scrollbars }: {
  children: React.ReactNode;
  height?: string | number;
  rulers?: { horizontal: React.ReactNode; vertical: React.ReactNode };
  scrollbars?: React.ReactNode;
}) {
  const classes = ['svg-viewport', rulers && 'svg-viewport-with-rulers',
    scrollbars && 'svg-viewport-with-scrollbars'].filter(Boolean).join(' ');
  return <div className={classes} style={{ height }}>
    {rulers && <>
      <div className="svg-viewport-top-ruler">{rulers.horizontal}</div>
      <div className="svg-viewport-ruler-corner" />
    </>}
    <div className="svg-viewport-drawing">{children}</div>
    {rulers && <div className="svg-viewport-side-ruler">{rulers.vertical}</div>}
    {scrollbars && <>
      {scrollbars}
      <div className="svg-viewport-scroll-corner" />
    </>}
  </div>;
}
