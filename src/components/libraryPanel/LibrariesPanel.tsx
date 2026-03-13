import React, { Dispatch, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLibraries } from '../../io/files';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import SymbolView from './SymbolView';
import { actionSelectLibrarySymbol } from '../../state/dispatcher/AppDispatcher';
import { ioXML } from '../../io/ioXml';
import { XMLBuilder } from '../../util/xmlbuilder';
import LibraryView from './LibraryView';
import {
  Input,
  Button,
  makeStyles,
  tokens,
  ToggleButton,
} from '@fluentui/react-components';
import {
  SearchRegular,
  GlobeRegular,
  FolderRegular,
  AddRegular,
  PanelLeftContractRegular,
  DocumentAddRegular,
  FolderAddRegular,
  ArrowClockwiseRegular,
} from '@fluentui/react-icons';
import { docDrawing } from '../../state/undo/undo';
import OnlineView from './OnlineView';
import { Search, SearchResult, SearchSymbol, SelectSymbol } from './Search';
import { openCurrentAppUrl, openExternalUrl } from '../../util/navigation';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    padding: '12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  searchContainer: {
    position: 'relative',
    display: 'flex',
    marginBottom: '12px',
    gap: '4px',
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
  sourceToggle: {
    display: 'flex',
    gap: '4px',
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '4px',
    borderRadius: '6px',
  },
  toggleButton: {
    flex: 1,
    minWidth: '0',
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  libraryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  libraryTitle: {
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: tokens.colorNeutralForeground3,
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
    padding: '4px 0',
  },
  symbolPreview: {
    flexShrink: 0,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    padding: '8px',
  },
  symbolPreviewInner: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground1,
    height: '180px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: '13px',
    marginTop: '8px',
  },
});

interface LibrariesPanelProps {
  libraries: tclib[];
  dispatch: Dispatch<any>;
  inputRef: any;
  toggleSidePanel?: () => void;
}

interface LibrariesPanelState {
  findFilter: string;
  displaySymbol: tclibSymbol | null;
  displayName: tclibLibraryEntry | null;
  displaySearchSymbol: SearchSymbol | null;
  selectedId: string | null;
  online: boolean;
  searchResult: SearchResult | null;
}

function selectSymbol(lib: tclib, name: tclibLibraryEntry) {
  return (dispatch: Dispatch<any>, getState: { (): docDrawing }) => {
    const symbol = lib.symbols.find((s) => s.SymbolId == name.SymbolID);
    const io = new ioXML();
    const xmlBuilder = new XMLBuilder();
    xmlBuilder.fromText(symbol.Data);
    const doc = io.from_dsn(xmlBuilder);
    const items = doc.sheets.map((sheet) => sheet.items);
    dispatch(actionSelectLibrarySymbol(name, items, null));
  };
}

export const LibrariesPanel: React.FunctionComponent<LibrariesPanelProps> = (
  props: LibrariesPanelProps,
) => {
  const styles = useStyles();
  const { t } = useTranslation();
  const isElectron = process.env.TARGET_SYSTEM === 'electron';
  const isFileSystem = process.env.TARGET_SYSTEM === 'filesystem';
  const [state, setState] = useState<LibrariesPanelState>({
    findFilter: '',
    displaySymbol: null,
    displayName: null,
    displaySearchSymbol: null,
    selectedId: null,
    online: true,
    searchResult: null,
  });

  React.useEffect(() => {
    props.dispatch(loadLibraries);
  }, []);

  // Update selected symbol when libraries are reloaded (refreshed)
  React.useEffect(() => {
    if (state.selectedId && !state.online) {
      const lastColonIndex = state.selectedId.lastIndexOf(':');
      if (lastColonIndex > 0) {
        const fileId = state.selectedId.substring(0, lastColonIndex);
        const nameId = parseInt(state.selectedId.substring(lastColonIndex + 1));

        const lib = props.libraries.find((l) => l.fileId + '' === fileId);
        if (lib) {
          const nameEntry = lib.names.find((n) => n.NameID === nameId);
          if (nameEntry) {
            const symbol = lib.symbols.find(
              (s) => s.SymbolId === nameEntry.SymbolID,
            );

            if (symbol) {
              setState((prev) => ({
                ...prev,
                displaySymbol: symbol,
                displayName: nameEntry,
              }));
            }
          }
        }
      }
    }
  }, [props.libraries, state.selectedId, state.online]);

  const handleSearchChange = (value: string) => {
    const filterValue = value.toLocaleLowerCase();
    setState(prev => ({ ...prev, findFilter: filterValue }));
    if (state.online) {
      Search(value).then((results) =>
        setState(prev => ({
          ...prev,
          searchResult: results,
        })),
      );
    }
  };

  const handleSourceChange = (online: boolean) => {
    // Deselect currently selected symbol when switching tabs
    const resetSelection: Partial<LibrariesPanelState> = {
      displaySymbol: null,
      displayName: null,
      displaySearchSymbol: null,
      selectedId: null,
    };

    if (online) {
      Search(state.findFilter).then((results) =>
        setState(prev => ({
          ...prev,
          ...resetSelection,
          online: true,
          searchResult: results,
        })),
      );
    } else {
      setState(prev => ({
        ...prev,
        ...resetSelection,
        online: false,
        searchResult: null,
      }));
    }
  };

  return (
    <div className={styles.container} ref={props.inputRef}>
      {/* Header with Search */}
      <div className={styles.header}>
        <div className={styles.searchContainer}>
          <div style={{ flex: 1, position: 'relative' }}>
            <SearchRegular className={styles.searchIcon} />
            <Input
              className={styles.searchInput}
              placeholder={state.online ? t('library.searchOnline') : t('library.searchLibraries')}
              value={state.findFilter}
              onChange={(e, data) => handleSearchChange(data.value)}
            />
          </div>
          {props.toggleSidePanel && (
            <Button
              appearance="subtle"
              icon={<PanelLeftContractRegular />}
              onClick={props.toggleSidePanel}
              title={t('library.hideSidePanel')}
            />
          )}
        </div>
        {!isFileSystem && (
          <div className={styles.sourceToggle}>
            <ToggleButton
              className={styles.toggleButton}
              checked={state.online}
              onClick={() => handleSourceChange(true)}
              icon={<GlobeRegular />}
              size="small"
              appearance={state.online ? 'primary' : 'subtle'}
            >
              {t('library.online')}
            </ToggleButton>
            <ToggleButton
              className={styles.toggleButton}
              checked={!state.online}
              onClick={() => handleSourceChange(false)}
              icon={<FolderRegular />}
              size="small"
              appearance={!state.online ? 'primary' : 'subtle'}
            >
              {t('library.myLibraries')}
            </ToggleButton>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className={styles.content}>
        {!state.online && !isFileSystem && (
          <>
            <div className={styles.libraryHeader}>
              <span className={styles.libraryTitle}>{t('library.libraries')}</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {isElectron ? (
                  <>
                    <Button
                      className={styles.addButton}
                      appearance="subtle"
                      size="small"
                      icon={<FolderAddRegular />}
                      title={t('library.addExistingLibrary')}
                      onClick={() => window.electronAPI.loadLibrary()}
                    >
                      <span
                        className={styles.buttonText}
                        data-expanding-text="true"
                      >
                        {t('library.add')}
                      </span>
                    </Button>
                    <Button
                      className={styles.addButton}
                      appearance="subtle"
                      size="small"
                      icon={<DocumentAddRegular />}
                      title={t('library.createNewLibrary')}
                      onClick={() => {
                        if (
                          window.electronAPI &&
                          window.electronAPI.openNewWindow
                        ) {
                          window.electronAPI.openNewWindow('new');
                        } else {
                          const qp = new URLSearchParams();
                          qp.set('action', 'new-library');
                          openCurrentAppUrl(qp);
                        }
                      }}
                    >
                      <span
                        className={styles.buttonText}
                        data-expanding-text="true"
                      >
                        {t('library.new')}
                      </span>
                    </Button>
                    {window.electronAPI && (
                      <Button
                        className={styles.addButton}
                        appearance="subtle"
                        size="small"
                        icon={<ArrowClockwiseRegular />}
                        title={t('library.refreshLibraries')}
                        onClick={() => window.electronAPI.refreshLibraries()}
                      >
                        <span
                          className={styles.buttonText}
                          data-expanding-text="true"
                        >
                          {t('library.refresh')}
                        </span>
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    className={styles.addButton}
                    appearance="subtle"
                    size="small"
                    icon={<ArrowClockwiseRegular />}
                    title={t('library.refreshLibraries')}
                    onClick={() => props.dispatch(loadLibraries)}
                  >
                    <span
                      className={styles.buttonText}
                      data-expanding-text="true"
                    >
                      {t('library.refresh')}
                    </span>
                  </Button>
                )}
              </div>
            </div>
            <div className={styles.treeContainer}>
              {props.libraries.length === 0 ? (
                <div className={styles.emptyState}>
                  {isElectron ? (
                    <>
                      <FolderRegular style={{ fontSize: '32px' }} />
                      <span className={styles.emptyStateText}>
                        {t('library.noLibrariesLine1')}<br />
                        {t('library.noLibrariesLine2')}
                      </span>
                    </>
                  ) : (
                    <span className={styles.emptyStateText}>
                      <a
                        href="https://www.tinycad.net/Online/Libraries"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: tokens.colorBrandForegroundLink }}
                        onClick={(event) => {
                          event.preventDefault();
                          openExternalUrl('https://www.tinycad.net/Online/Libraries');
                        }}
                      >
                        {t('library.learnAddLibraries1')}
                        <br />
                        {t('library.learnAddLibraries2')}
                      </a>
                    </span>
                  )}
                </div>
              ) : (
                props.libraries.map((lib) => (
                  <LibraryView
                    lib={lib}
                    key={lib.fileId + ''}
                    selectedId={state.selectedId}
                    findFilter={state.findFilter}
                    onSelect={(lib: tclib, name: tclibLibraryEntry) => {
                      const symbol = lib.symbols.find(
                        (s: tclibSymbol) => s.SymbolId == name.SymbolID,
                      );
                      setState({
                        ...state,
                        selectedId: `${lib.fileId}:${name.NameID}`,
                        displaySymbol: symbol,
                        displayName: name,
                        displaySearchSymbol: null,
                      });
                    }}
                    onSelected={(lib: tclib, name: tclibLibraryEntry) => {
                      props.dispatch(selectSymbol(lib, name));
                    }}
                  />
                ))
              )}
            </div>
          </>
        )}
        {!!((state.online || isFileSystem) && state.searchResult) && (
          <div className={styles.treeContainer}>
            <OnlineView
              searchResult={state.searchResult}
              selectedId={state.selectedId}
              onSelect={(s) => {
                setState({
                  ...state,
                  selectedId: `:${s.nameID}`,
                  displaySymbol: null,
                  displayName: null,
                  displaySearchSymbol: s,
                });
              }}
              onSelected={(s) => props.dispatch(SelectSymbol(s, null))}
            />
          </div>
        )}
        {(state.online || isFileSystem) && !state.searchResult && (
          <div className={styles.emptyState}>
            <GlobeRegular style={{ fontSize: '32px' }} />
            <span className={styles.emptyStateText}>
              Search TinyCAD.net for symbols<br />
              from the online library.
            </span>
          </div>
        )}
      </div>

      {/* Symbol Preview */}
      <div className={styles.symbolPreview}>
        <div className={styles.symbolPreviewInner}>
          <SymbolView
            width={160}
            height={160}
            symbol={state.displaySymbol}
            name={state.displayName}
            searchSymbol={state.displaySearchSymbol}
          />
        </div>
      </div>
    </div>
  );
};
