import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { bundledLibraries } from '../../io/bundledLibraries';
import { LibraryActionTypes } from '../../state/actions/libraryActions';
import type { BundledLibraryEntry } from '../../../shared/bundledLibraries';
import type { tclib } from '../../model/tclib';

const useStyles = makeStyles({
  section: {
    padding: '8px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
    maxHeight: '60%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 8px',
  },
  hint: {
    margin: '6px 8px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  folder: { marginLeft: '12px' },
  folderTitle: { padding: '6px 4px', cursor: 'pointer', fontWeight: 600 },
  entry: { margin: '8px 0' },
  description: { marginLeft: '32px', color: tokens.colorNeutralForeground2 },
  error: {
    margin: '6px 8px',
    color: tokens.colorStatusDangerForeground1,
    overflowWrap: 'anywhere',
  },
  content: { maxHeight: '60vh', overflowY: 'auto' },
});

interface Folder {
  name: string;
  folders: Map<string, Folder>;
  entries: BundledLibraryEntry[];
}

function libraryTree(entries: BundledLibraryEntry[]): Folder {
  const root: Folder = { name: '', folders: new Map(), entries: [] };
  for (const entry of entries) {
    let folder = root;
    for (const name of entry.folder?.split('/') || []) {
      if (!folder.folders.has(name))
        folder.folders.set(name, { name, folders: new Map(), entries: [] });
      folder = folder.folders.get(name)!;
    }
    folder.entries.push(entry);
  }
  return root;
}

export function BundledLibraries(props: {
  visible: boolean;
  findFilter: string;
  renderLibraries(libraries: tclib[]): React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [snapshot, setSnapshot] = useState(bundledLibraries.getSnapshot);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => {
      const next = bundledLibraries.getSnapshot();
      setSnapshot(next);
      dispatch({
        type: LibraryActionTypes.SetBundledLibraries,
        libraries: next.libraries,
      });
    };
    const unsubscribe = bundledLibraries.subscribe(update);
    update();
    void bundledLibraries.initialize();
    return unsubscribe;
  }, [dispatch]);

  if (!props.visible) return null;

  const renderTree = (folder: Folder, chooser: boolean): React.ReactNode => (
    <>
      {[...folder.folders.values()].map((child) => (
        <details
          key={child.name}
          className={styles.folder}
          open={chooser || !!props.findFilter || undefined}
        >
          <summary className={styles.folderTitle}>{child.name}</summary>
          {renderTree(child, chooser)}
        </details>
      ))}
      {folder.entries.map((entry) => {
        const selected = snapshot.selected.includes(entry.id);
        const loadError = Object.prototype.hasOwnProperty.call(
          snapshot.errors,
          entry.id,
        )
          ? snapshot.errors[entry.id]
          : undefined;
        const library = snapshot.libraries.find(
          (lib) => lib.fileId === 'bundled:' + entry.id,
        );
        return (
          <div key={entry.id} className={chooser ? styles.entry : undefined}>
            {chooser ? (
              <>
                <Checkbox
                  label={entry.name}
                  checked={selected}
                  disabled={snapshot.saving}
                  onChange={(_, data) =>
                    void bundledLibraries.select(
                      data.checked
                        ? [...snapshot.selected, entry.id]
                        : snapshot.selected.filter((id) => id !== entry.id),
                    )
                  }
                />
                {entry.description && (
                  <div className={styles.description}>{entry.description}</div>
                )}
              </>
            ) : library ? (
              props.renderLibraries([library])
            ) : (
              <div className={styles.hint}>{entry.name}</div>
            )}
            {snapshot.loading.includes(entry.id) && (
              <div role="status" className={styles.hint}>
                {t('library.bundledLoading')}
              </div>
            )}
            {loadError && (
              <div role="alert" className={styles.error}>
                {loadError}{' '}
                <Button
                  size="small"
                  onClick={() => {
                    void bundledLibraries.load(entry.id);
                  }}
                >
                  {t('library.bundledRetry')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  const entries = snapshot.catalog?.libraries || [];
  const selected = entries.filter((entry) =>
    snapshot.selected.includes(entry.id),
  );
  return (
    <section className={styles.section} aria-label={t('library.bundledTitle')}>
      <div className={styles.header}>
        <strong>{t('library.bundledTitle')}</strong>
        <Button size="small" onClick={() => setOpen(true)}>
          {t('library.bundledChoose')}
        </Button>
      </div>
      <p className={styles.hint}>{t('library.bundledReadOnly')}</p>
      {snapshot.error && (
        <div role="alert" className={styles.error}>
          {snapshot.error}{' '}
          {!snapshot.catalog && (
            <Button
              size="small"
              onClick={() => {
                void bundledLibraries.initialize();
              }}
            >
              {t('library.bundledRetry')}
            </Button>
          )}
        </div>
      )}
      {selected.length > 0 ? (
        renderTree(libraryTree(selected), false)
      ) : (
        <p className={styles.hint}>{t('library.bundledNoneSelected')}</p>
      )}
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('library.bundledChooseTitle')}</DialogTitle>
            <DialogContent className={styles.content}>
              <p>{t('library.bundledExplanation')}</p>
              {!snapshot.catalog ? (
                <p role="status">
                  {snapshot.error || t('library.bundledLoading')}
                </p>
              ) : entries.length === 0 ? (
                <p>{t('library.bundledEmpty')}</p>
              ) : (
                renderTree(libraryTree(entries), true)
              )}
              {snapshot.error && snapshot.catalog && (
                <p role="alert" className={styles.error}>
                  {snapshot.error}
                </p>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
