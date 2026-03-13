import React, { useRef, useEffect, useState } from 'react';
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
    rulerContainer: {
        position: 'relative',
        backgroundColor: '#e0e0e0', // Slightly darker than white
        overflow: 'hidden',
        userSelect: 'none',
    },
    horizontal: {
        height: '20px',
        width: '100%',
        borderBottom: '1px solid #999',
    },
    vertical: {
        width: '20px',
        height: '100%',
        borderLeft: '1px solid #999',
    },
});

interface RulerProps {
    orientation: 'horizontal' | 'vertical';
    unit?: 'mm' | 'in';
    zoom: number; // percentage, e.g. 100
    scrollOffset: number; // pixels
    mousePosition: number | null; // in drawing units (mm)
    scaleOrign?: number; // pixels per unit at 100% zoom. Default 5.
    zeroOffset: number; // pixels. Where the 0 mark starts.
    containerSize: number; // pixels. Width or Height of the ruler view.
    tickAlignment?: 'start' | 'end'; // start=Top/Left, end=Bottom/Right. Default 'end'.
}

export const Ruler: React.FC<RulerProps> = (props) => {
    const styles = useStyles();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [actualSize, setActualSize] = useState({ width: 0, height: 0 });

    const scaleBase = props.scaleOrign || 5;
    const pixelsPerUnit = scaleBase * (props.zoom / 100);
    const align = props.tickAlignment || 'end';
    
    // 5 px/mm -> every 1mm is 5px.
    // Major ticks every 10mm (50px).
    // Medium ticks every 5mm.
    // Minor ticks every 1mm.
    
    // If zoomed out, we might want to skip some ticks.
    // Minimum tick spacing ~3-4px.
    
    // Use ResizeObserver to track actual container size
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setActualSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                });
            }
        });
        
        resizeObserver.observe(container);
        
        // Initialize with current size
        setActualSize({
            width: container.clientWidth,
            height: container.clientHeight
        });
        
        return () => resizeObserver.disconnect();
    }, []);
    
    // Draw ruler
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Get actual container dimensions from state (set by ResizeObserver)
        const containerWidth = props.orientation === 'horizontal' 
            ? Math.max(actualSize.width, props.containerSize, 1) 
            : 20;
        const containerHeight = props.orientation === 'horizontal' 
            ? 20 
            : Math.max(actualSize.height, props.containerSize, 1);
        
        // Don't draw if size is too small
        if (containerWidth < 10 && containerHeight < 10) return;
        
        // Set the canvas drawing surface size
        canvas.width = containerWidth;
        canvas.height = containerHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear with background color
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(0, 0, width, height);

        // Set drawing styles
        ctx.fillStyle = 'black';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Calculate offset (scroll is negative relative to content start, but here passed as positive scrollLeft/Top)
        // The content starts at `zeroOffset`.
        // The coordinate in pixels relative to viewport 0 is:
        // P_screen = P_drawing_pixels + zeroOffset - scrollOffset
        // P_drawing_pixels = P_drawing_units * pixelsPerUnit
        
        // So P_screen = P_drawing_units * pixelsPerUnit + startPos
        const startPos = props.zeroOffset - props.scrollOffset;

        // We want to iterate visible range.
        // 0 to containerSize.
        
        // Find unit value at screen pixel 0:
        // 0 = unit * ppu + startPos => unit = -startPos / ppu
        const startUnit = Math.floor((-startPos) / pixelsPerUnit) - 1;
        // Find unit value at screen pixel containerSize:
        const endUnit = Math.ceil((props.containerSize - startPos) / pixelsPerUnit) + 1;

        // Step size.
        // If pixelsPerUnit is small, we need larger steps.
        // Base step = 1 (mm).
        let step = 1;
        if (pixelsPerUnit < 4) step = 2;
        if (pixelsPerUnit < 2) step = 5;
        if (pixelsPerUnit < 1) step = 10;
        if (pixelsPerUnit < 0.5) step = 20;

        for (let u = startUnit; u <= endUnit; u++) {
            if (u % step !== 0) continue;

            const pos = Math.floor(u * pixelsPerUnit + startPos) + 0.5; // +0.5 for crisp lines
            
            if (pos < -50 || pos > (props.orientation === 'horizontal' ? width : height) + 50) continue;

            let tickLength = 4;
            let showLabel = false;
            
            if (u % 10 === 0) {
                tickLength = 10; // Major
                showLabel = true;
            } else if (u % 5 === 0) {
                tickLength = 7; // Medium
            }

            if (props.orientation === 'horizontal') {
                const yBase = align === 'end' ? height - 1 : 0;
                const dir = align === 'end' ? -1 : 1;

                ctx.beginPath();
                ctx.moveTo(pos, yBase);
                ctx.lineTo(pos, yBase + tickLength * dir);
                ctx.stroke();
                
                if (showLabel) {
                   // Place text at top if align end (ticks bottom), else bottom
                   ctx.fillText(u.toString(), pos + 2, align === 'end' ? 0 : height - 12); 
                }
            } else {
                const xBase = align === 'end' ? width - 1 : 0;
                const dir = align === 'end' ? -1 : 1;

                ctx.beginPath();
                ctx.moveTo(xBase, pos);
                ctx.lineTo(xBase + tickLength * dir, pos);
                ctx.stroke();

                if (showLabel) {
                    // Vertical text
                    ctx.save();
                    // If align end (right), text on left. If align start (left), text on right.
                    ctx.translate(align === 'end' ? 0 : width - 12, pos + 2);
                    // Rotate 90 degrees clockwise (or -270) to have text running down? 
                    // Original was -PI/2 which is 270 deg (text reading up).
                    // User requested rotate by 180 from original.
                    // Original: ctx.rotate(-Math.PI / 2); (reading up)
                    // New: ctx.rotate(Math.PI / 2); (reading down)
                    ctx.rotate(Math.PI / 2);
                    ctx.fillText(u.toString(), 0, -8); // Adjust position as needed
                    ctx.restore();
                }
            }
        }

        // Draw Mouse Position Indicator
        if (props.mousePosition !== null) {
            const screenPos = Math.floor(props.mousePosition * pixelsPerUnit + startPos) + 0.5;
            if (screenPos >= 0 && screenPos <= (props.orientation === 'horizontal' ? width : height)) {
                ctx.strokeStyle = 'red';
                ctx.beginPath();
                if (props.orientation === 'horizontal') {
                    ctx.moveTo(screenPos, 0);
                    ctx.lineTo(screenPos, height);
                } else {
                    ctx.moveTo(0, screenPos);
                    ctx.lineTo(width, screenPos);
                }
                ctx.stroke();
            }
        }

    }, [props.zoom, props.scrollOffset, props.orientation, props.containerSize, props.scaleOrign, props.zeroOffset, props.mousePosition, props.tickAlignment, pixelsPerUnit, align, actualSize]);


    return (
        <div 
            ref={containerRef}
            className={`${styles.rulerContainer} ${props.orientation === 'horizontal' ? styles.horizontal : styles.vertical}`}
        >
            <canvas 
                ref={canvasRef} 
            />
        </div>
    );
};
