import React from 'react';
import {
  makeStyles,
  mergeClasses,
  Text,
  tokens,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: tokens.colorNeutralBackground3,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: '0 4px',
    gap: '0',
    height: '26px',
    minHeight: '26px',
    flexShrink: 0,
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    overflowX: 'auto',
    overflowY: 'hidden',
    flexShrink: 1,
    flexGrow: 0,
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
  },
  tabsWithActions: {
    maxWidth: 'calc(50% - 20px)',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    userSelect: 'none',
    whiteSpace: 'nowrap',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    transition: 'background-color 0.1s ease, border-color 0.1s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  selected: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopColor: tokens.colorNeutralStroke1,
    borderBottomColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    boxShadow: `0 1px 2px ${tokens.colorNeutralShadowAmbient}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
});

export function SheetTabStrip({
  children,
  actions,
  tabListLabel,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  tabListLabel?: string;
}) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.bar, 'sheetbar')}>
      <div
        className={mergeClasses(styles.tabs, actions && styles.tabsWithActions)}
        role={tabListLabel ? 'tablist' : undefined}
        aria-label={tabListLabel}
      >
        {children}
      </div>
      {actions}
    </div>
  );
}

export function SheetTabLabel({
  label,
  selected,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  selected: boolean;
}) {
  const styles = useStyles();
  return (
    <div
      {...props}
      className={mergeClasses(
        styles.tab,
        selected && styles.selected,
        className,
        'sheet-heading',
        selected && 'sheet-heading-on',
      )}
    >
      <Text size={200}>{label}</Text>
      {children}
    </div>
  );
}
