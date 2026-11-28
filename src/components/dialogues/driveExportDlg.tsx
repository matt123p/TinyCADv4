import React, { useEffect, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';

export type DriveExportDialogProps = {
  filename: string;
  folderId?: string;
  load(): Promise<{
    folders: { id: string; name: string }[];
    preferred?: string;
  }>;
  save(name: string, folderId?: string): Promise<void>;
};

export function DriveExportDialog({
  filename,
  folderId,
  load,
  save,
}: DriveExportDialogProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [name, setName] = useState(filename);
  const [folder, setFolder] = useState(folderId ?? '');
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => dispatch(actionCancelDialog());

  useEffect(() => {
    let active = true;
    void load()
      .then(({ folders, preferred }) => {
        if (!active) return;
        setFolders(folders);
        if (
          !folderId &&
          preferred &&
          folders.some(({ id }) => id === preferred)
        )
          setFolder(preferred);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [folderId, load]);

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && !busy && close()}>
      <DialogSurface>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || loading || !name.trim()) return;
            setBusy(true);
            setError('');
            try {
              await save(name.trim(), folder || undefined);
              close();
            } catch (error) {
              setError(String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogBody>
            <DialogTitle>{t('toolbar.saveAs')}</DialogTitle>
            <DialogContent>
              <Field label="File name">
                <Input
                  value={name}
                  disabled={busy}
                  onChange={(_, data) => setName(data.value)}
                />
              </Field>
              <Field label="Google Drive folder">
                <Select
                  value={folder}
                  disabled={busy || loading}
                  onChange={(_, data) => setFolder(data.value)}
                >
                  <option value="">My Drive</option>
                  {folder && !folders.some(({ id }) => id === folder) && (
                    <option value={folder}>Previously selected folder</option>
                  )}
                  {folders.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
              {error && <p role="alert">{error}</p>}
            </DialogContent>
            <DialogActions>
              <Button
                type="submit"
                appearance="primary"
                disabled={busy || loading || !name.trim()}
              >
                {t('toolbar.save')}
              </Button>
              <Button disabled={busy} onClick={close}>
                {t('common.cancel')}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
