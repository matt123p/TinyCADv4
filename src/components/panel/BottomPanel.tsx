import React, { Dispatch } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { DocItem, DocItemTypes, dsnPin, dsnSymbol } from '../../model/dsnItem';
import StylePanelContainer from '../../state/containers/stylePanelContainer';
import SymbolPanelContainer from '../../state/containers/symbolPanelContainer';
import PinPanelContainer from '../../state/containers/pinPanelContainer';
import DrcPanelContainer from '../../state/containers/drcPanelContainer';
import { SymbolListPanel } from './SymbolListPanel';
import { NetlistListPanel } from './NetlistListPanel';
import { PinListPanel } from './PinListPanel';
import { dsnDrawing } from '../../model/dsnDrawing';
import { Panels } from '../../state/dispatcher/AppDispatcher';

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
  headerTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
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
});

interface BottomPanelProps {
  selectedSymbol: dsnSymbol;
  selectedPin: dsnPin;
  selectedItem: DocItem;
  hasSelection: boolean;
  drawing: dsnDrawing;
  dispatch: Dispatch<any>;
  panel: Panels;
  isLibraryEditMode: boolean;
}

export const BottomPanel: React.FunctionComponent<BottomPanelProps> = (
  props: BottomPanelProps,
) => {
  const styles = useStyles();
  const [listMode, setListMode] = React.useState<'symbols' | 'netlist'>('symbols');
  const selectedIsWireOrPower =
    props.selectedItem?.NodeName === DocItemTypes.Wire ||
    props.selectedItem?.NodeName === DocItemTypes.Power;
  // Determine which panel to show
  const getPanelType = (): 'symbol' | 'pin' | 'style' | 'drc' | 'empty' | 'pinList' => {
    if (selectedIsWireOrPower) {
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

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {panelType === 'symbol' && (
          <div className={styles.panelContent}>
            <SymbolPanelContainer />
          </div>
        )}
        {panelType === 'pin' && (
          <div className={styles.panelContent}>
            <PinPanelContainer />
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
                focusedParentId={selectedIsWireOrPower ? props.selectedItem?._id : undefined}
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
