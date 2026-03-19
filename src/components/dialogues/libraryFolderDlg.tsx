import React, { FunctionComponent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  Field,
  Input,
} from '@fluentui/react-components';
import { useDispatch } from 'react-redux';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { LibraryFolder, UserConfig } from '../../state/stores/altStoreReducer';
import { saveLibraryConfig } from '../../io/files';
import { get_global_id } from '../../util/global_id';

interface LibraryFolderDialogProps {
  mode: 'create' | 'rename' | 'delete';
  config: UserConfig;
  folder?: LibraryFolder;
}

export const LibraryFolderDialog: FunctionComponent<LibraryFolderDialogProps> = (
  props: LibraryFolderDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [value, setValue] = useState(props.folder?.name ?? t('library.newFolderDefault'));

  const title = useMemo(() => {
    switch (props.mode) {
      case 'create':
        return t('library.createFolder');
      case 'rename':
        return t('library.renameFolder');
      case 'delete':
        return t('library.removeFolder');
    }
  }, [props.mode, t]);

  const close = () => {
    dispatch(actionCancelDialog());
  };

  const submit = () => {
    if (props.mode === 'delete') {
      if (!props.folder) {
        close();
        return;
      }

      dispatch(
        saveLibraryConfig({
          ...props.config,
          libraryFolders: props.config.libraryFolders.filter(
            (item) => item.id !== props.folder.id,
          ),
          libraries: props.config.libraries.map((library) =>
            library.folderId === props.folder.id
              ? { ...library, folderId: null }
              : library,
          ),
        }) as any,
      );
      close();
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }

    if (props.mode === 'create') {
      const folderId = `folder-${get_global_id()}`;
      dispatch(
        saveLibraryConfig({
          ...props.config,
          libraryFolders: [
            ...props.config.libraryFolders,
            { id: folderId, name: trimmed },
          ],
        }) as any,
      );
      close();
      return;
    }

    if (!props.folder || trimmed === props.folder.name) {
      close();
      return;
    }

    dispatch(
      saveLibraryConfig({
        ...props.config,
        libraryFolders: props.config.libraryFolders.map((item) =>
          item.id === props.folder.id ? { ...item, name: trimmed } : item,
        ),
      }) as any,
    );
    close();
  };

  return (
    <Dialog open={true} onOpenChange={close}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            {props.mode === 'delete' ? (
              <p>{t('library.removeFolderConfirm')}</p>
            ) : (
              <Field label={t('library.folderNamePrompt')}>
                <Input
                  type="text"
                  value={value}
                  onChange={(_, data) => setValue(data.value)}
                />
              </Field>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={submit}>
              {props.mode === 'create'
                ? t('common.add')
                : props.mode === 'rename'
                  ? t('common.rename')
                  : t('common.delete')}
            </Button>
            <Button appearance="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};