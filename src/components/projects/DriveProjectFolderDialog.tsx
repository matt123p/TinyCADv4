import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { projectRequest } from '../../io/projects';
import { projectFolderOpened } from '../../io/projectStorage';
import { recentDriveProjectFolders } from '../../io/projectMode';
import type { ProjectLocation } from '../../io/projectStorage';

export default function DriveProjectFolderDialog({
  account,
  onClose,
}: {
  account: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<ProjectLocation[]>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<ProjectLocation[]>();
  const [error, setError] = useState('');
  const [openingRecent, setOpeningRecent] = useState(false);
  const current = trail.at(-1);
  const recent = recentDriveProjectFolders(account);

  function choose(folder: ProjectLocation) {
    window.dispatchEvent(new CustomEvent(projectFolderOpened, { detail: folder }));
    onClose();
  }

  async function openRecent(id: string) {
    setOpeningRecent(true);
    setError('');
    try {
      choose(await projectRequest({ operation: 'open-recent-project-folder', id }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setOpeningRecent(false);
    }
  }

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
    <Dialog open onOpenChange={(_, data) => !data.open && !openingRecent && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('projects.openFolder')}</DialogTitle>
          <DialogContent>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button disabled={openingRecent}>{t('projects.recentProjects')}</Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {recent.length ? recent.map(({ id, name }) => (
                    <MenuItem key={id} onClick={() => { void openRecent(id); }}>{name}</MenuItem>
                  )) : <MenuItem disabled>{t('projects.noRecentProjects')}</MenuItem>}
                </MenuList>
              </MenuPopover>
            </Menu>
            <p>{trail.map(({ name }) => name).join(' / ')}</p>
            <Button
              disabled={openingRecent || trail.length === 1}
              onClick={() => setTrail(trail.slice(0, -1))}
            >
              {t('projects.up')}
            </Button>
            <ul aria-busy={!folders && !error}>
              {folders?.map((folder) => (
                <li key={folder.id}>
                  <Button disabled={openingRecent} onClick={() => setTrail([...trail, folder])}>
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
              disabled={openingRecent || !folders}
              onClick={() => choose(current)}
            >
              {t('projects.selectFolder')}
            </Button>
            <Button disabled={openingRecent} onClick={onClose}>{t('common.cancel')}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
