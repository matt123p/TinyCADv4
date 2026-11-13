import React, { useSyncExternalStore } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { docDrawing } from '../../state/undo/undo';
import {
  actionSelectPanel,
  actionSheetSelect,
  Panels,
} from '../../state/dispatcher/AppDispatcher';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  tokens,
} from '@fluentui/react-components';
import {
  dismissSimulationFailure,
  getSimulationFailure,
  getSimulationFailureTarget,
  requestSimulationDiagnostics,
  subscribeSession,
} from '../../simulation/session';

export function SimulationFailureDialog() {
  const dispatch = useDispatch(),
    store = useStore<docDrawing>();
  const failure = useSyncExternalStore(subscribeSession, getSimulationFailure);
  if (!failure) return null;

  const viewDiagnostics = () => {
    const target = getSimulationFailureTarget();
    const drawing = store.getState().docStore.present.drawing;
    if (target?.documentId !== drawing.documentId) {
      dismissSimulationFailure();
      return;
    }
    const index = drawing.sheets.findIndex(
      (sheet) => sheet.id === target.sheetId,
    );
    if (index >= 0 && target.runId) {
      requestSimulationDiagnostics();
      dispatch(actionSheetSelect(index));
    } else {
      dispatch(actionSelectPanel(Panels.DrcPanel));
      dismissSimulationFailure();
    }
  };

  return (
    <Dialog
      open
      modalType="alert"
      onOpenChange={(_, data) => {
        if (!data.open) dismissSimulationFailure();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Simulation failed</DialogTitle>
          <DialogContent style={{ color: tokens.colorPaletteRedForeground1 }}>
            {failure}
          </DialogContent>
          <DialogActions>
            <Button onClick={dismissSimulationFailure}>
              OK
            </Button>
            <Button appearance="primary" onClick={viewDiagnostics}>
              View diagnostics
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
