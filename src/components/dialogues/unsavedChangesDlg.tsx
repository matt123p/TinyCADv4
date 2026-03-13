import React, { FunctionComponent } from 'react';
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
import { useDispatch } from 'react-redux';
import { performPendingAction } from '../../io/files';

export type UnsavedAction = 
  | { type: 'file-new' }
  | { type: 'file-open' }
  | { type: 'file-open-recent'; file: { name: string; id: string } };

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
              onClick={handleContinue}
            >
              {t('dialogues.unsavedChanges.continueWithoutSaving')}
            </Button>
            <Button
              appearance="secondary"
              onClick={() => dispatch(actionCancelDialog())}
            >
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
