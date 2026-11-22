import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { wheelZoomFactor, zoomStepFactor } from '../../util/editorZoom';
import { Ruler } from '../controls/Ruler';

export type SvgViewBox = readonly [number, number, number, number];
export interface SvgViewportHandle {
  fit(view?: SvgViewBox): void;
  zoom(direction: 'in' | 'out', point?: { x: number; y: number }): void;
}

export function svgDrawingMatrix(svg?: SVGSVGElement | null) {
  return svg?.querySelector<SVGGElement>(':scope > [data-svg-drawing]')?.getScreenCTM();
}

function localPoint(scene: SVGGElement | null, clientX: number, clientY: number) {
  const matrix = scene?.getScreenCTM()?.inverse();
  return matrix && new DOMPoint(clientX, clientY).matrixTransform(matrix);
}

/** An SVG sheet viewport with independent display coordinates and pointer transforms. */
export function SvgViewport({
  label,
  fit,
  height = '100%',
  rulerUnits,
  editorWheel = false,
  viewportRef,
  children,
  onLocation,
  renderLocationPreview,
}: {
  label: string;
  fit: SvgViewBox;
  height?: string | number;
  editorWheel?: boolean;
  rulerUnits?: { unitsPerMillimeter: number; yUp: boolean };
  viewportRef?: React.Ref<SvgViewportHandle>;
  children: React.ReactNode;
  onLocation?(x: number, y: number, unitsPerPixel: number): void;
  renderLocationPreview?(position?: readonly [number, number, number]): React.ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const scene = useRef<SVGGElement>(null);
  const drag = useRef<{ x: number; y: number; pointer: number }>();
  const [view, setView] = useState<SvgViewBox>();
  const [pointer, setPointer] = useState<readonly [number, number, number]>();
  const [fitX, fitY, fitWidth, fitHeight] = fit;
  const current = view ?? fit;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rulerPointer, setRulerPointer] = useState<{ x: number; y: number }>();
  const [x, y, width, viewHeight] = current;
  const scale = Math.min(size.width / width, size.height / viewHeight);
  const zeroX = (size.width - width * scale) / 2 - x * scale;
  const zeroY = (size.height - viewHeight * scale) / 2 - y * scale;
  const pixelsPerMillimeter = scale * (rulerUnits?.unitsPerMillimeter ?? 1);
  const yDirection = rulerUnits?.yUp ? -1 : 1;

  useLayoutEffect(() => {
    const element = svg.current;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((size) => size.width === width && size.height === height
        ? size : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function zoomBy(factor: number, point?: { x: number; y: number }) {
    const anchor = point && localPoint(scene.current, point.x, point.y);
    setPointer(undefined);
    setView((last) => {
      const [x, y, width, height] = last ?? [fitX, fitY, fitWidth, fitHeight];
      const nextWidth = Math.max(fitWidth / 64, Math.min(fitWidth * 8, width / factor));
      const ratio = nextWidth / width;
      const anchorX = anchor?.x ?? x + width / 2;
      const anchorY = anchor?.y ?? y + height / 2;
      return [
        anchorX + (x - anchorX) * ratio,
        anchorY + (y - anchorY) * ratio,
        nextWidth,
        height * ratio,
      ];
    });
  }

  useImperativeHandle(viewportRef, () => ({
    fit(next) {
      setPointer(undefined);
      setView(next);
    },
    zoom(direction, point) {
      zoomBy(zoomStepFactor(direction), point);
    },
  }));

  useEffect(() => {
    const element = svg.current;
    function wheel(event: WheelEvent) {
      const factor = wheelZoomFactor(event, !editorWheel);
      if (factor !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        zoomBy(factor, { x: event.clientX, y: event.clientY });
        return;
      }
      if (!editorWheel || event.ctrlKey || event.shiftKey || (!event.deltaX && !event.deltaY)) return;
      event.preventDefault();
      const matrix = scene.current?.getScreenCTM();
      if (!matrix || !matrix.a && !matrix.b) return;
      const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1;
      const drawingDelta = deltaScale / Math.hypot(matrix.a, matrix.b);
      setPointer(undefined);
      setView(([x, y, width, height] = [fitX, fitY, fitWidth, fitHeight]) => [
        x + event.deltaX * drawingDelta,
        y + event.deltaY * drawingDelta,
        width,
        height,
      ]);
    }
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [fitX, fitY, fitWidth, fitHeight, editorWheel]);

  const drawing = (
    <svg
      ref={svg}
      role="img"
      aria-label={label}
      width="100%"
      height="100%"
      viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
      preserveAspectRatio="none"
      data-view-box={current.join(' ')}
      data-fit-view-box={fit.join(' ')}
      onDoubleClick={(event) => {
        if (event.shiftKey) setView(undefined);
      }}
      onPointerDown={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (renderLocationPreview) setPointer(undefined);
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          pointer: event.pointerId,
        };
      }}
      onPointerMove={(event) => {
        if (rulerUnits && event.pointerType !== 'touch') {
          const bounds = event.currentTarget.getBoundingClientRect();
          setRulerPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
        }
        const previous = drag.current;
        if (previous?.pointer !== event.pointerId) {
          if (renderLocationPreview && event.pointerType !== 'touch') {
            const p = localPoint(
              scene.current,
              event.clientX,
              event.clientY,
            );
            const matrix = scene.current?.getScreenCTM();
            if (p && matrix) setPointer([p.x, p.y, 1 / Math.hypot(matrix.a, matrix.b)]);
          }
          return;
        }
        const a = localPoint(scene.current, previous.x, previous.y);
        const b = localPoint(scene.current, event.clientX, event.clientY);
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          pointer: event.pointerId,
        };
        if (a && b)
          setView(([x, y, width, height] = current) => [
            x + a.x - b.x,
            y + a.y - b.y,
            width,
            height,
          ]);
      }}
      onPointerLeave={() => {
        setPointer(undefined);
        if (rulerUnits) setRulerPointer(undefined);
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
      }}
      onClick={(event) => {
        if (event.button !== 0 || event.shiftKey) return;
        const p = localPoint(scene.current, event.clientX, event.clientY);
        if (!p || !onLocation) return;
        const matrix = scene.current?.getScreenCTM();
        onLocation(p.x, p.y, matrix ? 1 / Math.hypot(matrix.a, matrix.b) : 0);
      }}
    >
      {/* The root maps display pixels. The drawing group owns the camera transform. */}
      <g ref={scene} data-svg-drawing="" visibility={scale > 0 ? undefined : 'hidden'}
        transform={`matrix(${scale} 0 0 ${scale} ${zeroX} ${zeroY})`}>
        {children}
        {renderLocationPreview?.(pointer)}
      </g>
    </svg>
  );

  return (
    <div className={rulerUnits ? 'svg-viewport svg-viewport-with-rulers' : 'svg-viewport'} style={{ height }}>
      {rulerUnits && (
        <div className="svg-viewport-top-ruler">
          {scale > 0 && <Ruler orientation="horizontal" unit="mm" zoom={100}
            scaleOrign={pixelsPerMillimeter} scrollOffset={0} zeroOffset={zeroX}
            containerSize={size.width}
            mousePosition={rulerPointer ? (rulerPointer.x - zeroX) / pixelsPerMillimeter : null} />}
        </div>
      )}
      {rulerUnits && <div className="svg-viewport-ruler-corner" />}
      <div className="svg-viewport-drawing">{drawing}</div>
      {rulerUnits && (
        <div className="svg-viewport-side-ruler">
          {scale > 0 && <Ruler orientation="vertical" unit="mm" zoom={100}
            scaleOrign={pixelsPerMillimeter} scrollOffset={0} zeroOffset={zeroY}
            direction={yDirection} tickAlignment="start" containerSize={size.height}
            mousePosition={rulerPointer ? (rulerPointer.y - zeroY) / (yDirection * pixelsPerMillimeter) : null} />}
        </div>
      )}
    </div>
  );
}
