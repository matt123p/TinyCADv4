import React from 'react';
import { useTranslation } from 'react-i18next';
import { tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import { ioXML } from '../../io/ioXml';
import { XMLBuilder } from '../../util/xmlbuilder';
import { TDrawing } from '../svg/Drawing';
import { updateFactory } from '../../manipulators/updateFactory';
import { connect } from 'react-redux';
import {
  apiServer,
  error,
  FetchSymbolData,
  SearchSymbol,
  SelectSymbol,
} from './Search';
import { Dispatch } from 'redux';

interface SymbolViewProps {
  dispatch: Dispatch;
  name: tclibLibraryEntry;
  symbol: tclibSymbol;
  searchSymbol: SearchSymbol;
  width: number;
  height: number;
}

let activeGhost: HTMLDivElement | null = null;
let dragPayload: any = null;

const handleTouchStart = (e: React.TouchEvent<HTMLElement>, payload: any) => {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  dragPayload = payload;

  // Create the ghost element
  const ghost = document.createElement('div');
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '999999';
  ghost.style.opacity = '0';
  ghost.style.transform = 'translate(-50%, -120%) scale(0.8)';
  ghost.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
  
  // Sleek dark-themed glassmorphic container to blend with premium layout
  ghost.style.background = 'rgba(255, 255, 255, 0.9)';
  ghost.style.backdropFilter = 'blur(10px)';
  (ghost.style as any).WebkitBackdropFilter = 'blur(10px)';
  ghost.style.border = '1px solid rgba(255, 255, 255, 0.6)';
  ghost.style.borderRadius = '16px';
  ghost.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.3), 0 5px 15px rgba(0, 0, 0, 0.15)';
  ghost.style.padding = '12px';
  ghost.style.display = 'flex';
  ghost.style.alignItems = 'center';
  ghost.style.justifyContent = 'center';

  // Clone target element
  const clone = e.currentTarget.cloneNode(true) as HTMLElement;
  clone.className = '';
  clone.style.width = '70px';
  clone.style.height = '70px';
  clone.style.maxWidth = '70px';
  clone.style.maxHeight = '70px';
  clone.style.opacity = '1';
  clone.style.margin = '0';
  clone.style.display = 'block';
  clone.style.pointerEvents = 'none';

  // Ensure inner content scales nicely
  const svg = clone.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.width = '100%';
    svg.style.height = '100%';
  }
  const img = clone.querySelector('img') || (clone.tagName === 'IMG' ? clone : null);
  if (img) {
    (img as HTMLElement).style.width = '100%';
    (img as HTMLElement).style.height = '100%';
    (img as HTMLElement).style.objectFit = 'contain';
  }

  ghost.appendChild(clone);
  document.body.appendChild(ghost);
  activeGhost = ghost;

  const clientX = touch.clientX;
  const clientY = touch.clientY;
  ghost.style.left = `${clientX}px`;
  ghost.style.top = `${clientY}px`;

  // Animate in
  requestAnimationFrame(() => {
    if (ghost) {
      ghost.style.opacity = '0.95';
      ghost.style.transform = 'translate(-50%, -120%) scale(1.15)';
    }
  });
};

const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
  if (!activeGhost) return;
  const touch = e.touches[0];
  const clientX = touch.clientX;
  const clientY = touch.clientY;

  activeGhost.style.left = `${clientX}px`;
  activeGhost.style.top = `${clientY}px`;
  
  if (e.cancelable) {
    e.preventDefault();
  }
};

const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
  if (!activeGhost) return;
  
  const touch = e.changedTouches[0];
  const clientX = touch.clientX;
  const clientY = touch.clientY;

  // Clean up ghost
  if (activeGhost && activeGhost.parentNode) {
    activeGhost.parentNode.removeChild(activeGhost);
  }
  activeGhost = null;

  // Dispatch custom drop event
  const dropEvent = new CustomEvent('touchsymbol-drop', {
    detail: {
      clientX,
      clientY,
      payload: dragPayload,
    },
  });
  window.dispatchEvent(dropEvent);
  
  dragPayload = null;
};

const handleTouchCancel = (e: React.TouchEvent<HTMLElement>) => {
  if (activeGhost && activeGhost.parentNode) {
    activeGhost.parentNode.removeChild(activeGhost);
  }
  activeGhost = null;
  dragPayload = null;
};

const SymbolView: React.FunctionComponent<SymbolViewProps> = (
  props: SymbolViewProps,
) => {
  const { t } = useTranslation();
  if (props.symbol) {
    // Load the symbol data as a XML file
    const io = new ioXML();
    const xmlBuilder = new XMLBuilder();
    xmlBuilder.fromText(props.symbol.Data);
    const doc = io.from_dsn(xmlBuilder);
    const items = doc.sheets[0].items;

    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;
    let first = true;

    for (let i = 0; i < items.length; ++i) {
      const update_obj = updateFactory(items[i]);
      let r = update_obj.getBoundingRect();

      if (first) {
        x1 = r.x1;
        y1 = r.y1;
        x2 = r.x2;
        y2 = r.y2;
        first = false;
      } else {
        x1 = Math.min(x1, r.x1);
        y1 = Math.min(y1, r.y1);
        x2 = Math.max(x2, r.x2);
        y2 = Math.max(y2, r.y2);
      }
    }

    // Scaling and position
    const target_size = Math.min(props.width, props.height);
    const scale_x = Math.min(target_size / (x2 - x1), 1.0);
    const scale_y = Math.min(target_size / (y2 - y1), 1.0);
    const scale = Math.min(scale_x, scale_y);
    const width = (x2 - x1) * scale;
    const height = (y2 - y1) * scale;
    let dx = x1 + width - (width / 2 + props.width / 2);
    let dy = y1 + height - (height / 2 + props.height / 2);

    return (
      <div
        className="symbol-svg"
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData(
            'application/json',
            JSON.stringify({
              name: props.name,
              symbolData: doc.sheets.map((i) => i.items),
            }),
          );
        }}
        onTouchStart={(e) => handleTouchStart(e, {
          name: props.name,
          symbolData: doc.sheets.map((i) => i.items),
        })}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <svg
          id="svg-drawing"
          className="symbol-svg"
          viewBox={`0 0 ${props.width / scale} ${props.height / scale}`}
        >
          <TDrawing
            dx={-dx}
            dy={-dy}
            dr={0}
            part={0}
            show_power={false}
            scale_x={1.0}
            scale_y={1.0}
            parent={null}
            editLibrary={false}
            heterogeneous={false}
            items={doc.sheets[0].items}
            selection={[]}
            selected_handle={-1}
            options={doc.sheets[0].options}
            hover={false}
            hover_obj={null}
            selected={false}
            add={null}
          />
        </svg>
      </div>
    );
  }

  if (props.searchSymbol) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%' }}>
        <img
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData(
              'application/json',
              JSON.stringify({
                searchSymbol: props.searchSymbol,
              }),
            );
          }}
          onTouchStart={(e) => handleTouchStart(e, {
            searchSymbol: props.searchSymbol,
          })}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          style={{ maxWidth: '100%', maxHeight: 'calc(100% - 20px)', objectFit: 'contain' }}
          crossOrigin="anonymous"
          src={
            `${apiServer}/api/Search/Thumbnail?size=md&id=` +
            props.searchSymbol.symbolID
          }
        />
          <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
            {t('library.dragToAdd')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#999', height: '100%' }}>
        <span style={{ fontSize: '12px' }}>{t('library.selectSymbolToPreview')}</span>
    </div>
  );
};

export default connect()(SymbolView);
