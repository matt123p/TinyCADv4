import React from 'react';
import { useTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import { makeStyles, tokens, mergeClasses } from '@fluentui/react-components';
import { DocumentRegular } from '@fluentui/react-icons';
import { SearchResult, SearchSymbol } from './Search';

const useStyles = makeStyles({
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
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
  itemActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    '&:hover': {
      backgroundColor: tokens.colorBrandBackgroundHover,
    },
  },
  icon: {
    width: '14px',
    height: '14px',
    marginRight: '8px',
    flexShrink: 0,
  },
  name: {
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  description: {
    marginLeft: '8px',
    color: tokens.colorNeutralForeground4,
    fontSize: '11px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  descriptionActive: {
    color: tokens.colorNeutralForegroundOnBrand,
    opacity: 0.8,
  },
  errorMessage: {
    padding: '16px',
    color: tokens.colorPaletteRedForeground1,
    textAlign: 'center',
    fontSize: '13px',
  },
  emptyMessage: {
    padding: '16px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
    fontSize: '13px',
  },
});

interface OnlineViewProps {
  searchResult: SearchResult;
  selectedId: string;
  onSelect(symbol: SearchSymbol): void;
  onSelected(symbol: SearchSymbol): void;
}

const OnlineView: React.FunctionComponent<OnlineViewProps> = (
  props: OnlineViewProps,
) => {
  const styles = useStyles();
  const { t } = useTranslation();

  if (props.searchResult.error) {
    return <div className={styles.errorMessage}>{props.searchResult.error}</div>;
  }

  if (!props.searchResult.symbols || props.searchResult.symbols.length === 0) {
    return <div className={styles.emptyMessage}>{t('library.noSymbolsFound')}</div>;
  }

  return (
    <ul className={styles.list}>
      {props.searchResult.symbols.map((n) => {
        const isActive = props.selectedId === `:${n.nameID}`;
        return (
          <li
            key={n.nameID}
            className={mergeClasses(styles.item, isActive && styles.itemActive)}
            role="button"
            aria-pressed="false"
            onClick={() => props.onSelect(n)}
            onDoubleClick={() => props.onSelected(n)}
          >
            <DocumentRegular className={styles.icon} />
            <span className={styles.name}>{n.name}</span>
            {n.description?.length > 0 && (
              <span className={mergeClasses(styles.description, isActive && styles.descriptionActive)}>
                {n.description}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default connect()(OnlineView);
