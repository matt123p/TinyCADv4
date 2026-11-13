import React, { useEffect, useId, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Select, makeStyles, tokens } from '@fluentui/react-components';
import {
  BUNDLED_LIBRARY_PREFIX,
  bundledLibraries,
} from '../../io/bundledLibraries';
import { LibraryActionTypes } from '../../state/actions/libraryActions';
import type { tclib } from '../../model/tclib';

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: '8px',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  title: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: tokens.colorNeutralForeground3,
  },
  picker: { width: '100%', minWidth: 0 },
  description: {
    margin: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground2,
    overflowWrap: 'anywhere',
  },
  libraries: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 4px' },
  hint: {
    margin: '6px 8px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  error: {
    margin: '6px 8px',
    color: tokens.colorStatusDangerForeground1,
    overflowWrap: 'anywhere',
  },
});

export function BundledLibraries(props: {
  visible: boolean;
  toolbarActions?: React.ReactNode;
  renderLibraries(libraries: tclib[]): React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const descriptionId = useId();
  const [snapshot, setSnapshot] = useState(bundledLibraries.getSnapshot);
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

  const entries = snapshot.catalog?.libraries || [];
  const selected = entries.find((entry) => entry.id === snapshot.selected[0]);
  const library =
    selected &&
    snapshot.libraries.find(
      (lib) => lib.fileId === BUNDLED_LIBRARY_PREFIX + selected.id,
    );
  const loadError =
    selected &&
    Object.prototype.hasOwnProperty.call(snapshot.errors, selected.id)
      ? snapshot.errors[selected.id]
      : undefined;

  return (
    <section className={styles.section} aria-label={t('library.bundledTitle')}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <span className={styles.title}>{t('library.libraries')}</span>
          {props.toolbarActions}
        </div>
        <Select
          className={styles.picker}
          aria-label={t('library.bundledChooseTitle')}
          aria-describedby={selected?.description ? descriptionId : undefined}
          value={selected?.id || ''}
          disabled={
            !snapshot.catalog || entries.length === 0 || snapshot.saving
          }
          onChange={(_, data) => {
            void bundledLibraries.select(data.value ? [data.value] : []);
          }}
        >
          <option value="">{t('library.bundledNoneSelected')}</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        {selected?.description && (
          <p
            id={descriptionId}
            className={styles.description}
            title={selected.description}
          >
            {selected.description}
          </p>
        )}
      </div>
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
      <div className={styles.libraries}>
        {selected ? (
          <>
            {library && props.renderLibraries([library])}
            {snapshot.loading.includes(selected.id) && (
              <p role="status" className={styles.hint}>
                {t('library.bundledLoading')}
              </p>
            )}
            {loadError && (
              <div role="alert" className={styles.error}>
                {loadError}{' '}
                <Button
                  size="small"
                  onClick={() => {
                    void bundledLibraries.load(selected.id);
                  }}
                >
                  {t('library.bundledRetry')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className={styles.hint}>
            {t(
              entries.length === 0 && snapshot.catalog
                ? 'library.bundledEmpty'
                : 'library.bundledNoneSelected',
            )}
          </p>
        )}
      </div>
    </section>
  );
}
