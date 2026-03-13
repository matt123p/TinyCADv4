import React, { Dispatch, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { connect } from 'react-redux';
import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ChevronRightRegular,
  ChevronDownRegular,
  EditRegular,
  DocumentRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import {
  actionSelectDialog,
} from '../../state/dispatcher/AppDispatcher';

const useStyles = makeStyles({
  treeItemGroup: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  libraryItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    minHeight: '32px',
    cursor: 'pointer',
    margin: '2px 4px',
    borderRadius: '4px',
    // Default grey state
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    transition: 'background-color 0.1s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  libraryItemActive: {
    // Active blue state
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    '&:hover': {
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  libraryItemOpen: {
    borderBottom: 'none',
  },
  libraryItemBad: {
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
    '&:hover': {
      backgroundColor: tokens.colorStatusDangerBackground2,
    },
  },
  symbolItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px 6px 36px',
    cursor: 'pointer',
    fontSize: '12px',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'background-color 0.1s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  symbolItemActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    '&:hover': {
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  symbolItemLast: {
    marginBottom: '0',
  },
  toggleIcon: {
    width: '16px',
    height: '16px',
    marginRight: '6px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'inherit',
  },
  libraryName: {
    flex: 1,
    fontWeight: 600,
    fontSize: '12px',
    color: 'inherit',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  symbolIcon: {
    width: '14px',
    height: '14px',
    marginRight: '8px',
    flexShrink: 0,
  },
  symbolName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  symbolDescription: {
    marginLeft: '8px',
    color: tokens.colorNeutralForeground4,
    fontSize: '11px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  symbolDescriptionActive: {
    color: tokens.colorNeutralForegroundOnBrand,
    opacity: 0.8,
  },
  actionButtons: {
    display: 'flex',
    gap: '2px',
    marginLeft: '4px',
  },
  actionButton: {
    minWidth: '24px',
    height: '24px',
    color: tokens.colorNeutralForeground1, // Default color for grey bg
    '&:hover': {
        color: tokens.colorNeutralForeground1Hover,
    }
  },
  actionButtonActive: {
      color: 'white',
      '&:hover': {
          color: 'white',
      }
  },
  actionButtonDisabled: {
    color: tokens.colorNeutralForegroundDisabled,
  },
  matchCount: {
    fontSize: '10px',
    color: 'inherit',
    backgroundColor: 'rgba(128,128,128,0.2)', // Default for grey bg
    padding: '1px 6px',
    borderRadius: '10px',
    marginLeft: '8px',
  },
  matchCountActive: {
    color: 'white',
    backgroundColor: 'rgba(255,255,255,0.2)', // For blue bg
  },
  badLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    marginLeft: '8px',
    padding: 0,
    backgroundColor: 'transparent',
    color: tokens.colorPaletteDarkOrangeForeground2,
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    opacity: 0.9,
    '&:hover': {
      backgroundColor: 'transparent',
      color: tokens.colorPaletteDarkOrangeForeground1,
      opacity: 1,
    },
    '&:focus-visible': {
      outlineStyle: 'solid',
      outlineWidth: '1px',
      outlineColor: tokens.colorStrokeFocus2,
      borderRadius: tokens.borderRadiusSmall,
    },
  },
});

interface LibraryViewProps {
  dispatch: Dispatch<any>;
  lib: tclib;
  findFilter: string;
  selectedId: string;
  onSelect(lib: tclib, name: tclibLibraryEntry): void;
  onSelected(lib: tclib, name: tclibLibraryEntry): void;
}

interface LibraryViewState {
  open: boolean;
  hover: boolean;
}

const LibraryView: React.FunctionComponent<LibraryViewProps> = (
  props: LibraryViewProps,
) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const [state, setState] = useState<LibraryViewState>({
    open: false,
    hover: false,
  });

  const isBad = !!props.lib.bad;

  const openLibraryInfo = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    props.dispatch(
      actionSelectDialog('library_info', {
        name: props.lib.name || '',
        path: `${props.lib.fileId || ''}`,
        bad: isBad,
        loadError: props.lib.loadError,
      }),
    );
  };

  const names = isBad
    ? []
    : props.lib.names.filter(
    (n) =>
      props.findFilter?.length == 0 ||
      n.Name.toLocaleLowerCase().indexOf(props.findFilter) >= 0 ||
      n.Description.toLocaleLowerCase().indexOf(props.findFilter) >= 0,
  );

  if (!isBad && names?.length === 0 && props.findFilter?.length > 0) {
    return null;
  }

  return (
    <ul className={styles.treeItemGroup}>
      <li
        className={mergeClasses(
          styles.libraryItem,
          isBad && styles.libraryItemBad,
          state.open && styles.libraryItemActive,
          state.open && styles.libraryItemOpen,
        )}
        role="button"
        aria-pressed="false"
        onClick={() => {
          if (!isBad) {
            setState({ ...state, open: !state.open });
          }
        }}
        onMouseEnter={() => setState({ ...state, hover: true })}
        onMouseLeave={() => setState({ ...state, hover: false })}
      >
        <span className={styles.toggleIcon}>
          {!isBad && names?.length > 0 ? (
            state.open ? (
              <ChevronDownRegular />
            ) : (
              <ChevronRightRegular />
            )
          ) : null}
        </span>
        <span className={styles.libraryName}>
          {props.lib.name.replace(/\.tclib$/gi, '')}
        </span>
        {isBad && (
          <button
            type="button"
            className={styles.badLabel}
            title={t('library.libraryLoadErrorTooltip')}
            aria-label={t('library.libraryLoadErrorTooltip')}
            onClick={openLibraryInfo}
          >
            <WarningRegular fontSize={18} />
          </button>
        )}
        {!isBad && names?.length > 0 && (
          <span className={mergeClasses(styles.matchCount, state.open && styles.matchCountActive)}>{names.length}</span>
        )}
        {!isBad && (state.hover || state.open) && (
          <div className={styles.actionButtons}>
            <Button
              className={mergeClasses(
                styles.actionButton,
                state.open && styles.actionButtonActive,
              )}
              appearance="subtle"
              size="small"
              icon={<EditRegular />}
              title={t('library.libraryOptions')}
              onClick={openLibraryInfo}
            />
          </div>
        )}
      </li>
      {state.open &&
        names.map((n, index) => {
          const isActive = props.selectedId === `${props.lib.fileId}:${n.NameID}`;
          return (
            <li
              key={n.NameID}
              className={mergeClasses(
                styles.symbolItem,
                isActive && styles.symbolItemActive,
                index === names.length - 1 && styles.symbolItemLast,
              )}
              role="button"
              aria-pressed="false"
              onClick={() => props.onSelect(props.lib, n)}
              onDoubleClick={() => props.onSelected(props.lib, n)}
            >
              <DocumentRegular className={styles.symbolIcon} />
              <span className={styles.symbolName}>{n.Name}</span>
              {n.Description?.length > 0 && (
                <span className={mergeClasses(styles.symbolDescription, isActive && styles.symbolDescriptionActive)}>
                  {n.Description}
                </span>
              )}
            </li>
          );
        })}
    </ul>
  );
};

export default connect()(LibraryView);
