import React, { useState } from 'react';
import { tclib } from '../../model/tclib';
import { Dispatch } from 'redux';
import { Button, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowLeftRegular } from '@fluentui/react-icons';
import { actionViewLibrary } from '../../state/dispatcher/AppDispatcher';
import SymbolView from './SymbolView';

const useStyles = makeStyles({
  container: {
    padding: '8px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    margin: 0,
  },
});

interface DetailedLibraryViewProps {
  dispatch: Dispatch;
  viewLibrary: tclib;
}

interface DetailedLibraryViewState {
  selectedId: string;
}

export const DetailedLibraryView: React.FunctionComponent<DetailedLibraryViewProps> =
  (props: DetailedLibraryViewProps) => {
    const styles = useStyles();
    const [state, setState] = useState<DetailedLibraryViewState>({
      selectedId: null,
    });

    if (!props.viewLibrary) {
      return null;
    }

    const library = props.viewLibrary;
    const names = library?.names ?? [];

    return (
      <>
        <div className={styles.header}>
          <Button
            appearance="subtle"
            icon={<ArrowLeftRegular />}
            onClick={() => {
              props.dispatch(actionViewLibrary(null));
            }}
          />
          <h3 className={styles.title}>
            {library.name?.replace(/\.tclib$/gi, '')}
          </h3>
        </div>
        <div className={'view-library-container'}>
          <ul className="edit-library-tree">
            {names.map((n) => (
              <li
                key={n.NameID}
                className={
                  'edit-library-entry edit-library-entry-level1' +
                  (state.selectedId === `${n.NameID}`
                    ? ' edit-library-entry--active'
                    : '')
                }
                role="button"
                aria-pressed="false"
                onClick={() => {
                  setState({ ...state, selectedId: `${n.NameID}` });
                }}
              >
                {n.Name}
                {n.Description?.length > 0 ? ' - ' : null}
                {n.Description}
                <SymbolView
                  width={258}
                  height={150}
                  symbol={library.symbols.find((s) => s.SymbolId == n.SymbolID)}
                  name={n}
                  searchSymbol={null}
                />
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  };
