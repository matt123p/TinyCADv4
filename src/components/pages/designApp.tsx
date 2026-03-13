import React, { FunctionComponent, useState, useCallback, useEffect } from 'react';
import { makeStyles, Button } from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { PanelLeftExpandRegular } from '@fluentui/react-icons';
import ToolbarContainer from '../../state/containers/toolbarContainer';
import SidePanelContainer from '../../state/containers/sidePanelContainer';
import SheetContainer from '../../state/containers/sheetContainer';
import BomContainer from '../../state/containers/bomContainer';
import SheetbarContainer from '../../state/containers/sheetbarContainer';
import BottomPanelContainer from '../../state/containers/bottomPanelContainer';
import { ResizeHandle } from '../panel/ResizeHandle';
import { Browser } from '../sheets/browser';
import { tclibLibraryEntry } from '../../model/tclib';
import { BrowserSheetData } from '../../model/dsnView';

// TODO: These styles seem common, maybe they should be in a common CSS or utility?
// For now, mirroring what was seen in mainAppElectron.tsx
const useStyles = makeStyles({
  toggleButton: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 1000,
    minWidth: '32px',
    padding: '6px',
  },
});

export interface DesignAppProps {
  editSymbol: tclibLibraryEntry;
  selected_sheet: number;
  browserSheets: BrowserSheetData[];
}

export const DesignApp: FunctionComponent<DesignAppProps> = (props) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [sidePanelVisible, setSidePanelVisible] = useState(true);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);

  const toggleSidePanel = useCallback(() => {
    setSidePanelVisible(prev => !prev);
  }, []);

  const handleBottomPanelResize = useCallback((delta: number) => {
    setBottomPanelHeight(prev => Math.max(100, Math.min(500, prev - delta)));
  }, []);

  useEffect(() => {
    if (props.editSymbol) {
      setBottomPanelHeight(350);
    }
  }, [props.editSymbol]);

  return (
    <div
      className="page-container"
      style={{ top: process.env.TARGET_SYSTEM === 'electron' ? 0 : undefined }}
    >
      <ToolbarContainer />
      <div className="mid-container">
        <div className={sidePanelVisible ? "side-panel-container" : "side-panel-container side-panel-collapsed"}>
          {!sidePanelVisible && (
            <Button
              className={styles.toggleButton}
              appearance="subtle"
              icon={<PanelLeftExpandRegular />}
              onClick={toggleSidePanel}
              title={t('designApp.showSidePanel')}
            />
          )}
          <SidePanelContainer toggleSidePanel={toggleSidePanel} />
        </div>
        <div className="main-content-area">
          <div
            className={
              props.editSymbol ? 'circuit-container-es' : 'circuit-container'
            }
          >
            {props.selected_sheet >= 0 ? <SheetContainer /> : null}
            {props.selected_sheet === -1 ? <BomContainer /> : null}
            {props.selected_sheet < -1 ? <Browser url={props.browserSheets[-2 - props.selected_sheet].url} /> : null}
            <SheetbarContainer />
          </div>
          <div className="bottom-panel-wrapper" style={{ height: bottomPanelHeight }}>
            <ResizeHandle direction="vertical" onResize={handleBottomPanelResize} />
            <BottomPanelContainer />
          </div>
        </div>
      </div>
    </div>
  );
};
