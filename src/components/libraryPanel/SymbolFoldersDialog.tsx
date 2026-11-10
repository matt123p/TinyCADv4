import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@fluentui/react-components';
import type { tclib } from '../../model/tclib';
import {
  changeSymbolFolders,
  getSymbolFolders,
  SymbolFolderChange,
} from '../../model/symbolFolders';
import { LibraryActionTypes } from '../../state/actions/libraryActions';

export function SymbolFoldersDialog(props: {
  library: tclib;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [selected, setSelected] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const folders = getSymbolFolders(props.library);
  const submit = (operation: 'create' | 'rename' | 'remove') => {
    const change: SymbolFolderChange =
      operation === 'rename'
        ? { operation, previous: selected, folder: value }
        : { operation, folder: operation === 'remove' ? selected : value };
    try {
      changeSymbolFolders(props.library, change);
      dispatch({ type: LibraryActionTypes.ChangeSymbolFolders, change });
      setError('');
      setSelected('');
      setValue('');
    } catch {
      setError(t('library.symbolFolderInvalid'));
    }
  };
  return (
    <Dialog open onOpenChange={props.onClose}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('library.symbolFolders')}</DialogTitle>
          <DialogContent>
            <Field label={t('library.symbolFolderSelect')}>
              <Select
                value={selected}
                onChange={(_, data) => {
                  setSelected(data.value);
                  setValue(data.value);
                  setError('');
                }}
              >
                <option value="">{t('library.unfiled')}</option>
                {folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('library.symbolFolderPath')}
              validationMessage={error || undefined}
              validationState={error ? 'error' : 'none'}
            >
              <Input
                value={value}
                onChange={(_, data) => {
                  setValue(data.value);
                  setError('');
                }}
              />
            </Field>
            <p>{t('library.removeSymbolFolderHint')}</p>
          </DialogContent>
          <DialogActions>
            <Button
              disabled={props.library.readOnly || !value.trim()}
              onClick={() => submit('create')}
            >
              {t('common.add')}
            </Button>
            <Button
              disabled={props.library.readOnly || !selected || !value.trim()}
              onClick={() => submit('rename')}
            >
              {t('common.rename')}
            </Button>
            <Button
              disabled={props.library.readOnly || !selected}
              onClick={() => submit('remove')}
            >
              {t('common.remove')}
            </Button>
            <Button appearance="primary" onClick={props.onClose}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
