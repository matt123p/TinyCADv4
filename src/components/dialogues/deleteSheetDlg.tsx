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
import {
  actionCancelDialog,
  actionSheetRemove,
} from '../../state/dispatcher/AppDispatcher';
import { useDispatch } from 'react-redux';

interface DeleteSheetDialogProps {
  name: string;
}

//
// This component represents the delete sheet dialogue
//
export const DeleteSheetDialog: FunctionComponent<DeleteSheetDialogProps> = (
  props: DeleteSheetDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.deleteSheet.title')}</DialogTitle>
          <DialogContent>
            <p>{t('dialogues.deleteSheet.message', { name: props.name })}</p>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => dispatch(actionSheetRemove())}
            >
              {t('common.delete')}
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
