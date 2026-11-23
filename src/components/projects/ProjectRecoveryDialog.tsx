import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { useDispatch, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../../state/undo/undo';
import { openProjectDrawing } from '../../io/projects';
import type { ProjectRecoveryPrompt } from '../../io/projects';

export default function ProjectRecoveryDialog({
  prompt,
}: {
  prompt: ProjectRecoveryPrompt;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const store = useStore<docDrawing>();
  const close = () => {
    dispatch(actionCancelDialog());
    prompt.onComplete?.();
  };
  const open = (choice: 'restore' | 'discard') => {
    dispatch(actionCancelDialog());
    void openProjectDrawing(
      {
        type: 'file-open-project',
        location: prompt.location,
        recovery: { choice, token: prompt.token },
      },
      dispatch,
      store.getState,
    ).finally(() => prompt.onComplete?.());
  };
  return (
    <Dialog
      open
      onOpenChange={(_, { open }) => {
        if (!open) close();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('projects.recover')}</DialogTitle>
          <DialogContent>
            <p>
              {t('projects.recoverPrompt', {
                name: prompt.location.name,
                time: new Date(prompt.time).toLocaleString(),
              })}
            </p>
            <p>
              {t(
                prompt.conflict
                  ? 'projects.recoverConflict'
                  : 'projects.recoverLaterEdits',
              )}
            </p>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button onClick={() => open('discard')}>
              {t('projects.discardRecovery')}
            </Button>
            <Button appearance="primary" onClick={() => open('restore')}>
              {t(
                prompt.conflict
                  ? 'projects.recoverCopy'
                  : 'projects.restoreRecovery',
              )}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
