import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { projectRequest } from '../../io/projects';
import { projectFolderOpened } from '../../io/projectStorage';
import type { ProjectLocation } from '../../io/projectStorage';

export default function DriveProjectFolderDialog({
  onClose,
}: {
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<ProjectLocation[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<ProjectLocation[]>();
  const [error, setError] = useState('');
  const current = trail.at(-1);

  useEffect(() => {
    let active = true;
    setFolders(undefined);
    setError('');
    projectRequest({ operation: 'list', folder: current.id })
      .then((result) => {
        if (active)
          setFolders(
            result
              .filter(({ folder, unsupported }) => folder && !unsupported)
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [current.id]);

  return (
    <Dialog open onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('projects.openFolder')}</DialogTitle>
          <DialogContent>
            <p>{trail.map(({ name }) => name).join(' / ')}</p>
            <Button
              disabled={trail.length === 1}
              onClick={() => setTrail(trail.slice(0, -1))}
            >
              {t('projects.up')}
            </Button>
            <ul aria-busy={!folders && !error}>
              {folders?.map((folder) => (
                <li key={folder.id}>
                  <Button onClick={() => setTrail([...trail, folder])}>
                    {folder.name}
                  </Button>
                </li>
              ))}
            </ul>
            {error && <p role="alert">{error}</p>}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={!folders}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent(projectFolderOpened, { detail: current }),
                );
                onClose();
              }}
            >
              {t('projects.selectFolder')}
            </Button>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
