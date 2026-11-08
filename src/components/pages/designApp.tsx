import React, {
  FunctionComponent,
  useState,
  useCallback,
  useEffect,
  lazy,
  Suspense,
} from 'react';
import { useDispatch } from 'react-redux';
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

const SimulationSheet = lazy(() =>
  import('../simulation/SimulationSheet').then((m) => ({
    default: m.SimulationSheet,
  })),
);
const ChartWorkspace = lazy(() =>
  import('../simulation/ChartWorkspace').then((m) => ({
    default: m.ChartWorkspace,
  })),
);
const InstrumentWindowHost = lazy(() =>
  import('../simulation/InstrumentWindows').then((m) => ({
    default: m.InstrumentWindowHost,
  })),
);

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
  simulationPanelActivated?: boolean;
  selectedSpiceControl?: boolean;
  simulationSheet: boolean;
  editSymbol: tclibLibraryEntry;
  selected_sheet: number;
  browserSheets: BrowserSheetData[];
  creating: boolean;
  dialogOpen: boolean;
  cancelCreation: () => void;
}

const SIDE_PANEL_WIDTH_STORAGE_KEY = 'tinycad.sidePanelWidth';
const DEFAULT_SIDE_PANEL_WIDTH = 288;
const MIN_SIDE_PANEL_WIDTH = 220;
const MAX_SIDE_PANEL_WIDTH = 600;

function loadSidePanelWidth(): number {
  try {
    const parsed = parseInt(
      window.localStorage?.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY) || '',
      10,
    );
    if (isNaN(parsed)) {
      return DEFAULT_SIDE_PANEL_WIDTH;
    }

    return Math.max(
      MIN_SIDE_PANEL_WIDTH,
      Math.min(MAX_SIDE_PANEL_WIDTH, parsed),
    );
  } catch {
    return DEFAULT_SIDE_PANEL_WIDTH;
  }
}

function saveSidePanelWidth(width: number) {
  try {
    window.localStorage?.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    return;
  }
}

export const DesignApp: FunctionComponent<DesignAppProps> = (props) => {
  const dispatch = useDispatch();
  useEffect(() => {
    const show = () => dispatch({ type: 'simulation/panel', visible: true });
    window.addEventListener('tinycad:show-charts', show);
    return () => window.removeEventListener('tinycad:show-charts', show);
  }, [dispatch]);
  useEffect(() => {
    if (props.simulationSheet || props.selectedSpiceControl)
      dispatch({ type: 'simulation/panel', visible: true });
  }, [dispatch, props.simulationSheet, props.selectedSpiceControl]);
  const styles = useStyles();
  const { t } = useTranslation();
  const [sidePanelVisible, setSidePanelVisible] = useState(true);
  const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [simulationToolbarTarget, setSimulationToolbarTarget] =
    useState<HTMLSpanElement>(null);

  const toggleSidePanel = useCallback(() => {
    setSidePanelVisible((prev) => !prev);
  }, []);

  const handleSidePanelResize = useCallback((delta: number) => {
    setSidePanelWidth((prev) => {
      const next = Math.max(
        MIN_SIDE_PANEL_WIDTH,
        Math.min(MAX_SIDE_PANEL_WIDTH, prev + delta),
      );
      saveSidePanelWidth(next);
      return next;
    });
  }, []);

  const handleBottomPanelResize = useCallback((delta: number) => {
    setBottomPanelHeight((prev) => Math.max(100, Math.min(500, prev - delta)));
  }, []);

  useEffect(() => {
    if (props.editSymbol) {
      setBottomPanelHeight(350);
    } else if (props.selectedSpiceControl) {
      setBottomPanelHeight(340);
    }
  }, [props.editSymbol, props.selectedSpiceControl]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      !props.creating ||
      props.dialogOpen
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.cancelCreation();
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="page-container"
      style={{ top: process.env.TARGET_SYSTEM === 'electron' ? 0 : undefined }}
    >
      <ToolbarContainer simulationToolbarRef={setSimulationToolbarTarget} />
      <div className="mid-container">
        <div
          className={`side-panel-container${
            sidePanelVisible ? '' : ' side-panel-collapsed'
          }${sidePanelResizing ? ' side-panel-resizing' : ''}`}
          style={sidePanelVisible ? { width: sidePanelWidth } : undefined}
        >
          {sidePanelVisible && (
            <ResizeHandle
              direction="horizontal"
              onResize={handleSidePanelResize}
              onDragStateChange={setSidePanelResizing}
            />
          )}
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
            {props.selected_sheet >= 0 ? (
              props.simulationSheet ? (
                <Suspense fallback={null}>
                  <SimulationSheet toolbarTarget={simulationToolbarTarget} />
                </Suspense>
              ) : (
                <SheetContainer />
              )
            ) : null}
            {props.selected_sheet === -1 ? <BomContainer /> : null}
            {props.selected_sheet < -1 ? (
              <Browser
                url={props.browserSheets[-2 - props.selected_sheet].url}
              />
            ) : null}
            <SheetbarContainer />
          </div>
          <div
            className="bottom-panel-wrapper"
            style={{ height: bottomPanelHeight }}
          >
            <ResizeHandle
              direction="vertical"
              onResize={handleBottomPanelResize}
            />
            <BottomPanelContainer />
          </div>
        </div>
        {!props.editSymbol && props.simulationPanelActivated && (
          <Suspense fallback={null}>
            <ChartWorkspace />
            <InstrumentWindowHost />
          </Suspense>
        )}
      </div>
    </div>
  );
};
