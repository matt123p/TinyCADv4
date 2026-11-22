import React from 'react';
import { makeStyles, Tab, TabList, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  header: {
    padding: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  tabs: {
    display: 'flex',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '6px',
  },
  tab: {
    flex: 1,
    minWidth: 0,
    padding: '6px 4px',
    '& .fui-Tab__content': {
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
      textAlign: 'center',
      fontSize: '12px',
      lineHeight: '16px',
    },
  },
});

export function LibraryBrowserHeader({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <div className={styles.header}>{children}</div>;
}

export function LibrarySourceTabs<Source extends string>({ label, selected, sources, onSelect }: {
  label: string;
  selected: Source;
  sources: { value: Source; id: string; panelId: string; label: string; icon?: React.ReactElement }[];
  onSelect: (source: Source) => void;
}) {
  const styles = useStyles();
  return <TabList className={styles.tabs} size="small" appearance="subtle" selectTabOnFocus
    aria-label={label} selectedValue={selected} onTabSelect={(_, { value }) => onSelect(value as Source)}>
    {sources.map(({ value, id, panelId, label, icon }) => (
      <Tab key={value} className={styles.tab} icon={icon} value={value} id={id} aria-controls={panelId}>
        {label}
      </Tab>
    ))}
  </TabList>;
}
