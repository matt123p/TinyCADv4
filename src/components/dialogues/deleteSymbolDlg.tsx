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
  actionDeleteLibrarySymbol,
} from '../../state/dispatcher/AppDispatcher';
import { useDispatch } from 'react-redux';

interface DeleteSymbolDialogProps {
  name: string;
  nameId: number;
}

//
// This component represents the delete symbol dialogue
//
export const DeleteSymbolDialog: FunctionComponent<DeleteSymbolDialogProps> = (
  props: DeleteSymbolDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('dialogues.deleteSymbol.title')}</DialogTitle>
          <DialogContent>
            <p>{t('dialogues.deleteSymbol.message', { name: props.name })}</p>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => dispatch(actionDeleteLibrarySymbol(props.nameId))}
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
