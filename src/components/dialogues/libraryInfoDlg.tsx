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
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  DismissRegular,
  EditRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { useDispatch } from 'react-redux';
import { removeLibrary } from '../../io/files';
import { tclibLoadError } from '../../model/tclib';
import { openCurrentAppUrl } from '../../util/navigation';

const useStyles = makeStyles({
  surface: {
    width: 'min(720px, calc(100vw - 32px))',
    maxWidth: '720px',
  },
  field: {
    margin: '0 0 12px',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  label: {
    fontWeight: 600,
  },
  errorPanel: {
    marginTop: '16px',
    padding: '16px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorStatusDangerBackground1,
    border: `1px solid ${tokens.colorStatusDangerBorder1}`,
    overflow: 'hidden',
  },
  errorSummary: {
    margin: 0,
    fontSize: tokens.fontSizeBase600,
    lineHeight: tokens.lineHeightBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorStatusDangerForeground1,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  errorDetailsLabel: {
    margin: '12px 0 6px',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  errorDetails: {
    margin: 0,
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase100,
    lineHeight: tokens.lineHeightBase200,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    maxHeight: '240px',
    overflow: 'auto',
  },
});

interface LibraryInfoDialogProps {
  name: string;
  path: string;
  bad?: boolean;
  loadError?: tclibLoadError;
}

export const LibraryInfoDialog: FunctionComponent<LibraryInfoDialogProps> = (
  props: LibraryInfoDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const styles = useStyles();
  const canOpenContainingFolder =
    !!window.electronAPI?.openContainingFolder && !!props.path;
  const canEdit = !props.bad && !!props.path;

  const editLibrary = () => {
    if (!canEdit) {
      return;
    }
    dispatch(actionCancelDialog());
    if (window.electronAPI && window.electronAPI.openNewWindow) {
      window.electronAPI.openNewWindow(props.path);
    } else {
      const qp = new URLSearchParams();
      qp.set('library', props.path);
      openCurrentAppUrl(qp);
    }
  };

  const removeFromList = () => {
    dispatch(actionCancelDialog());
    dispatch(removeLibrary(props.path) as any);
  };

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{t('dialogues.libraryInfo.title')}</DialogTitle>
          <DialogContent>
            <p className={styles.field}>
              <span className={styles.label}>{t('dialogues.libraryInfo.filename')}:</span>{' '}
              {props.name}
            </p>
            <p className={styles.field}>
              <span className={styles.label}>{t('dialogues.libraryInfo.path')}:</span>{' '}
              {props.path}
            </p>
            {props.loadError && (
              <div className={styles.errorPanel}>
                <p className={styles.errorSummary}>{props.loadError.summary}</p>
                {props.loadError.details && (
                  <>
                    <p className={styles.errorDetailsLabel}>
                      {t('dialogues.libraryInfo.errorDetails')}
                    </p>
                    <pre className={styles.errorDetails}>
                      {props.loadError.details}
                    </pre>
                  </>
                )}
              </div>
            )}
          </DialogContent>
          <DialogActions position="start">
              <Button
                appearance="secondary"
                icon={<EditRegular />}
                disabled={!canEdit}
                onClick={editLibrary}
              >
                {t('common.edit')}
              </Button>
              <Button
                appearance="secondary"
                icon={<DeleteRegular />}
                onClick={removeFromList}
              >
                {t('common.remove')}
              </Button>
              {canOpenContainingFolder && (
                <Button
                  appearance="secondary"
                  icon={<FolderOpenRegular />}
                  onClick={() => window.electronAPI.openContainingFolder(props.path)}
                >
                  {t('common.find')}
                </Button>
              )}
          </DialogActions>
          <DialogActions position="end">
            <Button
              appearance="primary"
              icon={<DismissRegular />}
              autoFocus
              onClick={() => dispatch(actionCancelDialog())}
            >
              {t('common.close')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
