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
