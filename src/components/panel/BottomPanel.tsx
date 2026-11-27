import React, { Dispatch, lazy, Suspense } from 'react';
import { makeStyles, mergeClasses, Tab, TabList } from '@fluentui/react-components';
import { DocItem, DocItemTypes, dsnPin, dsnSymbol } from '../../model/dsnItem';
import StylePanelContainer from '../../state/containers/stylePanelContainer';
import SymbolPanelContainer from '../../state/containers/symbolPanelContainer';
import { SymbolFontDefaultsButton, SymbolTextSizePanel } from './SymbolTextSizePanel';
import { readControl } from '../../simulation/controls';
import PinPanelContainer from '../../state/containers/pinPanelContainer';
import DrcPanelContainer from '../../state/containers/drcPanelContainer';
import { SymbolListPanel } from './SymbolListPanel';
import { NetlistListPanel } from './NetlistListPanel';
import { WirePanel } from './WirePanel';
import { PinListPanel } from './PinListPanel';
import { dsnDrawing } from '../../model/dsnDrawing';
import { useTranslation } from 'react-i18next';
import { Panels } from '../../state/dispatcher/AppDispatcher';

const SpiceControlPanel = lazy(() =>
  import('./SpiceControlPanel').then(m => ({ default: m.SpiceControlPanel })),
);
const InstrumentPanel = lazy(() =>
  import('./InstrumentPanel').then(m => ({ default: m.InstrumentPanel })),
);

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    padding: '4px 12px',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    minHeight: '24px',
    flexShrink: 0,
    gap: '8px',
  },
  content: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    overflow: 'hidden',
  },
  panelContent: {
    flexGrow: 1,
    overflow: 'hidden',
  },
  hidden: { display: 'none' },
  textSizeContent: {
    display: 'flex',
    flex: '1 1 auto',
    minWidth: 0,
    maxWidth: '520px',
    padding: '4px 12px',
  },
});

interface BottomPanelProps {
  selectedSymbol: dsnSymbol;
  selectedPin: dsnPin;
  selectedItem: DocItem;
  sheetName: string;
  hasSelection: boolean;
  hasSelectedSymbols: boolean;
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
  panel: Panels;
  isLibraryEditMode: boolean;
}

export const BottomPanel: React.FunctionComponent<BottomPanelProps> = (
  props: BottomPanelProps,
) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [fallbackTab, setFallbackTab] = React.useState('options');
  const [listMode, setListMode] = React.useState<'symbols' | 'netlist'>('symbols');
  const selectedWire =
    props.selectedItem?.NodeName === DocItemTypes.Wire ? props.selectedItem : null;
  const selectedIsPower = props.selectedItem?.NodeName === DocItemTypes.Power;
  // Determine which panel to show
  const getPanelType = (): 'symbol' | 'pin' | 'wire' | 'style' | 'drc' | 'empty' | 'pinList' => {
    if (selectedWire) {
      return 'wire';
    }
    if (selectedIsPower) {
      return 'empty';
    }
    if (props.selectedSymbol) {
      return 'symbol';
    } else if (props.selectedPin) {
      return 'pin';
    } else if (props.hasSelection) {
      return 'style';
    } else if (props.panel === Panels.DrcPanel) {
      return 'drc';
    } else if (props.isLibraryEditMode) {
      return 'pinList';
    }
    return 'empty';
  };

  const panelType = getPanelType();
  const control = props.selectedSymbol ? readControl(props.selectedSymbol) : null;
  const hasTextSizeTab =
    props.hasSelectedSymbols && !props.isLibraryEditMode && (panelType !== 'symbol' || !!control);
  const showTextSize = hasTextSizeTab && fallbackTab === 'textSize';

  return (
    <div className={styles.container}>
      {hasTextSizeTab && (
        <div className={styles.header}>
          <TabList size="small" aria-label={t('panel.symbol.propertiesTitle')}
            selectedValue={fallbackTab}
            onTabSelect={(_, data) => setFallbackTab(data.value === 'textSize' ? 'textSize' : 'options')}
          >
            <Tab value="options">{t('panel.symbol.options')}</Tab>
            <Tab value="textSize">{t('panel.symbol.textSize')}</Tab>
          </TabList>
          {showTextSize && <SymbolFontDefaultsButton />}
        </div>
      )}
      {showTextSize && (
        <div className={styles.textSizeContent} role="tabpanel" aria-label={t('panel.symbol.textSize')}>
          <SymbolTextSizePanel />
        </div>
      )}
      <div
        className={mergeClasses(styles.content, showTextSize && styles.hidden)}
        role={hasTextSizeTab ? 'tabpanel' : undefined}
        aria-label={hasTextSizeTab ? t('panel.symbol.options') : undefined}
      >
        {panelType === 'symbol' && (
          <div className={styles.panelContent}>
            <Suspense fallback={null}>{control?.kind === 'instrument' ? <InstrumentPanel key={props.selectedSymbol._id} symbol={props.selectedSymbol} drawing={props.drawing} dispatch={props.dispatch}/> : control ? (
              <SpiceControlPanel key={props.selectedSymbol._id}
                symbol={props.selectedSymbol} drawing={props.drawing} dispatch={props.dispatch} />
            ) : <SymbolPanelContainer />}</Suspense>
          </div>
        )}
        {panelType === 'pin' && (
          <div className={styles.panelContent}>
            <PinPanelContainer />
          </div>
        )}
        {panelType === 'wire' && (
          <div className={styles.panelContent}>
            <WirePanel
              key={selectedWire._id}
              wire={selectedWire}
              sheetName={props.sheetName}
              drawing={props.drawing}
              dispatch={props.dispatch}
            />
          </div>
        )}
        {panelType === 'style' && (
          <div className={styles.panelContent}>
            <StylePanelContainer />
          </div>
        )}
        {panelType === 'drc' && (
          <div className={styles.panelContent}>
            <DrcPanelContainer />
          </div>
        )}
        {panelType === 'pinList' && (
          <div className={styles.panelContent}>
            <PinListPanel
              drawing={props.drawing}
              dispatch={props.dispatch}
            />
          </div>
        )}
        {panelType === 'empty' && (
          <div className={styles.panelContent}>
            {listMode === 'symbols' ? (
              <SymbolListPanel
                drawing={props.drawing}
                dispatch={props.dispatch}
                listMode={listMode}
                onListModeChange={setListMode}
              />
            ) : (
              <NetlistListPanel
                dispatch={props.dispatch}
                drawing={props.drawing}
                focusedParentId={selectedIsPower ? props.selectedItem._id : undefined}
                listMode={listMode}
                onListModeChange={setListMode}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
