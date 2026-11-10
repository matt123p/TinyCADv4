import React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import type { tclib, tclibLibraryEntry } from '../../model/tclib';
import { symbolFolderTree, SymbolFolderNode } from '../../model/symbolFolders';

const useStyles = makeStyles({
  folder: {
    listStyle: 'none',
    margin: '4px 0',
    color: tokens.colorNeutralForeground1,
  },
  summary: {
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
    overflowWrap: 'anywhere',
  },
  children: { listStyle: 'none', padding: '0 0 0 12px', margin: 0 },
  count: {
    marginLeft: '8px',
    fontWeight: 400,
    color: tokens.colorNeutralForeground3,
  },
});

export function SymbolFolderTree(props: {
  library: tclib;
  entries: tclibLibraryEntry[];
  filter?: string;
  activeFolder?: string;
  renderEntries(entries: tclibLibraryEntry[]): React.ReactNode;
}) {
  const styles = useStyles();
  const count = (node: SymbolFolderNode): number =>
    node.entries.length +
    [...node.folders.values()].reduce(
      (total, child) => total + count(child),
      0,
    );
  const render = (node: SymbolFolderNode): React.ReactNode => (
    <>
      {[...node.folders.values()].map((folder) => (
        <li className={styles.folder} key={folder.path}>
          <details
            open={
              !!props.filter ||
              props.activeFolder === folder.path ||
              props.activeFolder?.startsWith(folder.path + '/') ||
              undefined
            }
          >
            <summary className={styles.summary}>
              {folder.name}
              <span className={styles.count}>{count(folder)}</span>
            </summary>
            <ul className={styles.children}>{render(folder)}</ul>
          </details>
        </li>
      ))}
      {props.renderEntries(node.entries)}
    </>
  );
  return (
    <>{render(symbolFolderTree(props.library, props.entries, !props.filter))}</>
  );
}
