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

interface IoFailureDialogProps {
  message: string;
}

//
// This component represents the IO failure dialogue
//
export const IoFailureDialog: FunctionComponent<IoFailureDialogProps> = (
  props,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.ioFailure.title')}</DialogTitle>
          <DialogContent>
            <p>
              {t('dialogues.ioFailure.message')}
            </p>
            <p>{props.message?.toString()}</p>
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
