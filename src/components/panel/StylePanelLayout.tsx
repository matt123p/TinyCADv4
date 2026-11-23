import React from 'react';
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'row',
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    gap: '10px',
    padding: '8px 10px',
    background: '#fafafa',
    boxSizing: 'border-box',
    alignItems: 'flex-start',
  },
  section: {
    display: 'flex',
    flexDirection: 'row',
    background: 'white',
    borderRadius: '4px',
    padding: '4px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #d0d0d0',
    flexShrink: 0,
  },
  titleVertical: {
    writingMode: 'vertical-rl',
    transform: 'rotate(180deg)',
    background: 'linear-gradient(to bottom, #0078d4 0%, #005a9e 100%)',
    color: 'white',
    fontWeight: 600,
    fontSize: '11px',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '8px 4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '24px',
    height: 'auto',
    alignSelf: 'stretch',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
    marginRight: '8px',
    cursor: 'default',
    userSelect: 'none',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '4px',
    justifyContent: 'flex-start',
  },
});

export function StylePanelLayout({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <div className={styles.container}>{children}</div>;
}

export function StylePanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  return <div className={styles.section}>
    <div className={styles.titleVertical}>{title}</div>
    <div className={styles.content}>{children}</div>
  </div>;
}
