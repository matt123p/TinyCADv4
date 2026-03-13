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

interface ClipboardFailureDialogProps {}

//
// This component represents the clipboard failure dialogue
//
export const ClipboardFailureDialog: FunctionComponent<ClipboardFailureDialogProps> =
  () => {
    const dispatch = useDispatch();
    const { t } = useTranslation();

    return (
      <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialogues.clipboardFailure.title')}</DialogTitle>
            <DialogContent>
              <p>
                {t('dialogues.clipboardFailure.message1')}
              </p>
              <p>
                {t('dialogues.clipboardFailure.message2')}
              </p>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="primary"
                onClick={() => dispatch(actionCancelDialog())}
              >
                {t('common.ok')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  };
