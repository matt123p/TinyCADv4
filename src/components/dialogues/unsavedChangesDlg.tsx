import React, { FunctionComponent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
} from '@fluentui/react-components';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { useDispatch, useSelector } from 'react-redux';
import { fileSave, librarySave, performPendingAction } from '../../io/files';
import { docDrawing } from '../../state/undo/undo';

export type UnsavedAction = 
  | { type: 'file-new' }
  | { type: 'file-open' }
  | { type: 'file-open-recent'; file: { name: string; id: string } }
  | { type: 'app-close' };

interface UnsavedChangesDialogProps {
  pendingAction: UnsavedAction;
}

//
// This component shows a warning when there are unsaved changes
//
export const UnsavedChangesDialog: FunctionComponent<UnsavedChangesDialogProps> = (
  props: UnsavedChangesDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [awaitingSave, setAwaitingSave] = useState(false);
  const saveNeeded = useSelector(
    (state: docDrawing) => state.docStore.present.drawingVersion !== state.altStore.savedVersion,
  );
  const saveInProgress = useSelector(
    (state: docDrawing) => state.altStore.saveInProgress,
  );
  const editLibrary = useSelector(
    (state: docDrawing) => state.docStore.present.editLibrary,
  );

  useEffect(() => {
    if (!awaitingSave || saveInProgress) {
      return;
    }

    if (!saveNeeded) {
      dispatch(actionCancelDialog());
      dispatch(performPendingAction(props.pendingAction) as any);
      return;
    }

    setAwaitingSave(false);
  }, [awaitingSave, dispatch, props.pendingAction, saveInProgress, saveNeeded]);

  const handleCancel = () => {
    dispatch(actionCancelDialog());
  };

  const handleSave = () => {
    setAwaitingSave(true);
    dispatch((editLibrary ? librarySave : fileSave) as any);
  };

  const handleContinue = () => {
    // Close dialog first, then perform the pending action
    dispatch(actionCancelDialog());
    dispatch(performPendingAction(props.pendingAction) as any);
  };

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.unsavedChanges.title')}</DialogTitle>
          <DialogContent>
            <p>{t('dialogues.unsavedChanges.message')}</p>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={handleSave}
              disabled={saveInProgress}
            >
              {t('toolbar.save')}
            </Button>
            <Button
              appearance="secondary"
              onClick={handleContinue}
              disabled={saveInProgress}
            >
              {t('dialogues.unsavedChanges.continueWithoutSaving')}
            </Button>
            <Button
              appearance="secondary"
              onClick={handleCancel}
              disabled={saveInProgress}
            >
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
