import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { Dispatch } from 'redux';
import {
  Button,
  Input,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  DeleteRegular,
  CopyRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import {
  actionAddLibrarySymbol,
  actionSelectDialog,
  actionEditLibrarySymbol,
  actionDuplicateLibrarySymbol,
} from '../../state/dispatcher/AppDispatcher';
import SymbolView from './SymbolView';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: tokens.colorNeutralBackground2,
    overflow: 'hidden',
  },
  libraryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    zIndex: 2,
    flex: '0 0 auto',
  },
  libraryTitle: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerActions: {
    display: 'flex',
    gap: '4px',
  },
  addButton: {
    fontSize: '12px',
    minWidth: 'auto',
    paddingLeft: '8px',
    paddingRight: '8px',
    ':hover': {
      '& [data-expanding-text="true"]': {
        maxWidth: '60px',
        opacity: 1,
        marginLeft: '4px',
      },
    },
  },
  buttonText: {
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    maxWidth: '0px',
    opacity: 0,
    verticalAlign: 'bottom',
    transitionProperty: 'max-width, opacity, margin-left',
    transitionDuration: '0.3s',
    transitionTimingFunction: 'ease',
  },
  treeContainer: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '8px',
  },
  filterBar: {
    padding: '10px 12px 0',
    backgroundColor: tokens.colorNeutralBackground1,
    flex: '0 0 auto',
  },
  searchWrapper: {
    position: 'relative',
  },
  searchIcon: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: tokens.colorNeutralForeground3,
    pointerEvents: 'none',
    zIndex: 1,
  },
  searchInput: {
    width: '100%',
    '& input': {
      paddingLeft: '32px',
    },
  },
  treeList: {
    padding: 0,
    margin: 0,
  },
  actionButtons: {
    display: 'flex',
    gap: '4px',
    position: 'absolute',
    right: '8px',
    top: '8px',
    zIndex: 100,
    padding: '3px',
    borderRadius: '999px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
  },
  actionButton: {
    minWidth: '24px',
    height: '24px',
    color: tokens.colorNeutralForeground1,
    '&:hover': {
      color: tokens.colorNeutralForeground1Hover,
    },
  },
  deleteActionButton: {
    '&:hover': {
      color: tokens.colorStatusDangerForeground1,
    },
  },
  entryContainer: {
    position: 'relative',
    padding: '14px 14px 12px',
    marginBottom: '10px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    listStyle: 'none',
    overflow: 'hidden',
    transitionProperty: 'background-color, border-color, box-shadow, transform',
    transitionDuration: '0.16s',
    transitionTimingFunction: 'ease',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '10px',
      bottom: '10px',
      width: '4px',
      borderRadius: '0 999px 999px 0',
      backgroundColor: tokens.colorBrandBackground,
      opacity: 0,
      transition: 'opacity 0.16s ease',
    },
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      borderTopColor: tokens.colorNeutralStroke1,
      borderRightColor: tokens.colorNeutralStroke1,
      borderBottomColor: tokens.colorNeutralStroke1,
      borderLeftColor: tokens.colorNeutralStroke1,
      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.08)',
      transform: 'translateY(-1px)',
    },
  },
  entryActive: {
    borderTopColor: tokens.colorBrandBackground,
    borderRightColor: tokens.colorBrandBackground,
    borderBottomColor: tokens.colorBrandBackground,
    borderLeftColor: tokens.colorBrandBackground,
    backgroundColor: tokens.colorNeutralBackground1Selected,
    boxShadow: '0 12px 28px rgba(10, 88, 202, 0.14)',
    '&::before': {
      opacity: 1,
    },
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Selected,
      borderTopColor: tokens.colorBrandBackground,
      borderRightColor: tokens.colorBrandBackground,
      borderBottomColor: tokens.colorBrandBackground,
      borderLeftColor: tokens.colorBrandBackground,
      boxShadow: '0 12px 28px rgba(10, 88, 202, 0.18)',
      transform: 'translateY(-1px)',
    },
  },
  symbolHeader: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: '10px',
    paddingRight: '64px',
  },
  symbolName: {
    fontSize: '13px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.3,
  },
  symbolDescription: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    marginTop: '4px',
    lineHeight: 1.35,
  },
  previewFrame: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground2,
    overflow: 'hidden',
    height: '150px',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    '& .symbol-svg': {
      width: '100%',
      height: '100%',
      display: 'block',
    },
  },
  previewFrameActive: {
    borderTopColor: tokens.colorBrandBackground,
    borderRightColor: tokens.colorBrandBackground,
    borderBottomColor: tokens.colorBrandBackground,
    borderLeftColor: tokens.colorBrandBackground,
  },
  emptyState: {
    padding: '24px 16px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    borderRadius: '12px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

interface EditLibraryViewProps {
  dispatch: Dispatch;
  editLibrary: tclib;
  editSymbol: tclibLibraryEntry;
}

export const EditLibraryView: React.FunctionComponent<EditLibraryViewProps> = (
  props: EditLibraryViewProps,
) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [filterText, setFilterText] = useState('');

  if (!props.editLibrary) {
    return null;
  }

  const library = props.editLibrary;
  const names = library?.names ?? [];
  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const filteredNames = normalizedFilter.length === 0
    ? names
    : names.filter((entry) => {
      const attributeText = (entry.Attributes ?? [])
        .flatMap((attribute) => [attribute.AttName, attribute.AttValue])
        .join(' ')
        .toLocaleLowerCase();

      const searchable = [
        entry.Name,
        entry.Description,
        entry.Reference,
        attributeText,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();

      return searchable.includes(normalizedFilter);
    });

  const handleDelete = (symbol: tclibLibraryEntry) => {
    props.dispatch(
      actionSelectDialog('symbol_delete', {
        name: symbol.Name,
        nameId: symbol.NameID,
      }),
    );
  };

  const handleDuplicate = (symbol: tclibLibraryEntry) => {
    props.dispatch(
      actionDuplicateLibrarySymbol(symbol.NameID),
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!filteredNames.length) return;

    const currentIndex = filteredNames.findIndex(
      (n) => n.NameID === props.editSymbol?.NameID,
    );

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex < filteredNames.length - 1 ? currentIndex + 1 : 0;
      const targetIndex = currentIndex === -1 ? 0 : nextIndex;
      props.dispatch(actionEditLibrarySymbol(filteredNames[targetIndex]));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredNames.length - 1;
      const targetIndex = currentIndex === -1 ? filteredNames.length - 1 : prevIndex;
      props.dispatch(actionEditLibrarySymbol(filteredNames[targetIndex]));
    } else if (e.key === 'Delete') {
      if (props.editSymbol) {
        e.preventDefault();
        handleDelete(props.editSymbol);
      }
    }
  };

  return (
    <div
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.libraryHeader}>
        <span className={styles.libraryTitle}>{library?.name ?? library?.fileId}</span>
        <div className={styles.headerActions}>
          <Button
            className={styles.addButton}
            appearance="subtle"
            size="small"
            icon={<AddRegular />}
            onClick={() => props.dispatch(actionAddLibrarySymbol())}
            title={t('library.newSymbol')}
          >
            <span
              className={styles.buttonText}
              data-expanding-text="true"
            >
              {t('library.new')}
            </span>
          </Button>
        </div>
      </div>

      <div className={styles.filterBar}>
        <div className={styles.searchWrapper}>
          <SearchRegular className={styles.searchIcon} />
          <Input
            className={styles.searchInput}
            placeholder={t('library.searchLibraries')}
            value={filterText}
            onChange={(e, data) => setFilterText(data.value)}
          />
        </div>
      </div>

      <div className={styles.treeContainer}>
        <ul className={styles.treeList}>
          {filteredNames.map((n) => (
            <li
              key={n.NameID}
              className={mergeClasses(
                styles.entryContainer,
                props.editSymbol?.NameID === n.NameID && styles.entryActive
              )}
              role="button"
              aria-pressed={props.editSymbol?.NameID === n.NameID}
              onClick={() => props.dispatch(actionEditLibrarySymbol(n))}
              onMouseEnter={() => setHoveredId(n.NameID)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className={styles.symbolHeader}>
                <div className={styles.symbolName}>{n.Name}</div>
                {n.Description?.length > 0 && (
                  <div className={styles.symbolDescription}>{n.Description}</div>
                )}
              </div>
              <div
                className={mergeClasses(
                  styles.previewFrame,
                  props.editSymbol?.NameID === n.NameID && styles.previewFrameActive,
                )}
              >
                <SymbolView
                  width={400}
                  height={150}
                  symbol={library.symbols.find((s) => s.SymbolId == n.SymbolID)}
                  name={n}
                  searchSymbol={null}
                />
              </div>
              {(hoveredId === n.NameID || props.editSymbol?.NameID === n.NameID) && (
                <div className={styles.actionButtons}>
                  <Button
                    className={mergeClasses(styles.actionButton, styles.deleteActionButton)}
                    appearance="subtle"
                    size="small"
                    icon={<DeleteRegular />}
                    title={t('library.deleteSymbol')}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(n);
                    }}
                  />
                  <Button
                    className={styles.actionButton}
                    appearance="subtle"
                    size="small"
                    icon={<CopyRegular />}
                    title={t('library.duplicateSymbol')}
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDuplicate(n);
                    }}
                  />
                </div>
              )}
            </li>
          ))}
          {filteredNames.length === 0 && (
            <li className={styles.emptyState}>{t('library.noSymbolsFound')}</li>
          )}
        </ul>
      </div>
    </div>
  );
};
