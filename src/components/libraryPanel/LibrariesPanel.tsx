import React, { Dispatch, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadLibraries, saveLibraryConfig } from '../../io/files';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import SymbolView from './SymbolView';
import {
  actionSelectDialog,
  actionSelectLibrarySymbol,
} from '../../state/dispatcher/AppDispatcher';
import { ioXML } from '../../io/ioXml';
import { XMLBuilder } from '../../util/xmlbuilder';
import LibraryView from './LibraryView';
import {
  Input,
  Button,
  makeStyles,
  mergeClasses,
  tokens,
  ToggleButton,
} from '@fluentui/react-components';
import {
  SearchRegular,
  GlobeRegular,
  FolderRegular,
  PanelLeftContractRegular,
  DocumentAddRegular,
  FolderAddRegular,
  ArrowClockwiseRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  EditRegular,
  ReOrderDotsVerticalRegular,
} from '@fluentui/react-icons';
import { docDrawing } from '../../state/undo/undo';
import OnlineView from './OnlineView';
import { Search, SearchResult, SearchSymbol, SelectSymbol } from './Search';
import { openCurrentAppUrl, openExternalUrl } from '../../util/navigation';
import {
  LibraryFolder,
  UserConfig,
} from '../../state/stores/altStoreReducer';
import { normalizeUserConfig, sortLibrariesByConfig } from '../../io/libraryConfig';

const ROOT_LIBRARY_FOLDER_ID = '__root__';

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
    gap: '8px',
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
  headerActions: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
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
  folderGroup: {
    margin: '0 4px 6px',
  },
  folderHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '32px',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorTransparentStroke}`,
    transition: 'background-color 0.15s ease, border-color 0.15s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  folderHeaderDropTarget: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  folderHeaderSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    '&:hover': {
      backgroundColor: tokens.colorBrandBackground2Hover,
    },
  },
  folderToggle: {
    width: '16px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'inherit',
  },
  folderName: {
    flex: 1,
    fontSize: '12px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  folderCount: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '10px',
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground4,
  },
  folderCountSelected: {
    color: tokens.colorBrandForeground2,
    backgroundColor: 'transparent',
  },
  folderActions: {
    display: 'flex',
    gap: '2px',
    marginLeft: '4px',
  },
  dragHandle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    cursor: 'grab',
    color: 'inherit',
    opacity: 0.8,
    '&:active': {
      cursor: 'grabbing',
    },
  },
  folderLibraries: {
    paddingTop: '4px',
  },
  emptyFolder: {
    padding: '8px 12px 8px 34px',
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
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
  config: UserConfig;
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
  selectedFolderId: string | null;
  hoveredFolderId: string | null;
  online: boolean;
  searchResult: SearchResult | null;
  expandedFolders: Record<string, boolean>;
  dragOverFolderId: string | null;
  draggedFolderId: string | null;
}

function isFolderOpen(
  expandedFolders: Record<string, boolean>,
  folderId: string,
) {
  return expandedFolders[folderId] === true;
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
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const isElectron = process.env.TARGET_SYSTEM === 'electron';
  const isFileSystem = process.env.TARGET_SYSTEM === 'filesystem';
  const canUseLibraryFolders = isElectron;
  const [state, setState] = useState<LibrariesPanelState>({
    findFilter: '',
    displaySymbol: null,
    displayName: null,
    displaySearchSymbol: null,
    selectedId: null,
    selectedFolderId: ROOT_LIBRARY_FOLDER_ID,
    hoveredFolderId: null,
    online: true,
    searchResult: null,
    expandedFolders: {},
    dragOverFolderId: null,
    draggedFolderId: null,
  });
  const config = normalizeUserConfig(props.config);
  const orderedLibraries = sortLibrariesByConfig(props.libraries, config);
  const libraryEntriesById = new Map(
    config.libraries.map((library) => [`${library.id}`, library]),
  );
  const unfiledLibraries = canUseLibraryFolders
    ? orderedLibraries.filter(
        (library) => !libraryEntriesById.get(`${library.fileId}`)?.folderId,
      )
    : orderedLibraries;
  const groupedFolders = canUseLibraryFolders
    ? config.libraryFolders.map((folder) => ({
        folder,
        libraries: orderedLibraries.filter(
          (library) =>
            libraryEntriesById.get(`${library.fileId}`)?.folderId === folder.id,
        ),
      }))
    : [];

  React.useEffect(() => {
    props.dispatch(loadLibraries);
  }, []);

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

  React.useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!canUseLibraryFolders || state.online || !state.selectedFolderId) {
        return;
      }

      const treeContainer = treeContainerRef.current;
      const target = event.target;
      if (!treeContainer || !(target instanceof Node)) {
        return;
      }

      if (treeContainer.contains(target)) {
        return;
      }

      setState((prev) => ({
        ...prev,
        selectedFolderId: null,
      }));
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
    };
  }, [canUseLibraryFolders, state.online, state.selectedFolderId]);

  const handleSearchChange = (value: string) => {
    const filterValue = value.toLocaleLowerCase();
    setState((prev) => ({ ...prev, findFilter: filterValue }));
    if (state.online) {
      Search(value).then((results) =>
        setState((prev) => ({
          ...prev,
          searchResult: results,
        })),
      );
    }
  };

  const handleSourceChange = (online: boolean) => {
    const resetSelection: Partial<LibrariesPanelState> = {
      displaySymbol: null,
      displayName: null,
      displaySearchSymbol: null,
      selectedId: null,
    };

    if (online) {
      Search(state.findFilter).then((results) =>
        setState((prev) => ({
          ...prev,
          ...resetSelection,
          online: true,
          searchResult: results,
        })),
      );
    } else {
      setState((prev) => ({
        ...prev,
        ...resetSelection,
        online: false,
        searchResult: null,
      }));
    }
  };

  const persistConfig = (nextConfig: UserConfig) => {
    props.dispatch(saveLibraryConfig(nextConfig) as any);
  };

  const getLibraryFolderId = (fileId: string | null) => {
    if (!canUseLibraryFolders || !fileId) {
      return ROOT_LIBRARY_FOLDER_ID;
    }

    return libraryEntriesById.get(fileId)?.folderId || ROOT_LIBRARY_FOLDER_ID;
  };

  const createFolder = () => {
    if (!canUseLibraryFolders) {
      return;
    }

    props.dispatch(
      actionSelectDialog('library_folder', {
        mode: 'create',
        config,
      }),
    );
  };

  const addLibraries = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!window.electronAPI?.loadLibrary) {
      return;
    }

    event?.currentTarget?.blur();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const selectedLibraryId = state.selectedId
      ? state.selectedId.substring(0, state.selectedId.lastIndexOf(':'))
      : null;
    const targetFolderId = canUseLibraryFolders
      ? state.selectedId
        ? getLibraryFolderId(selectedLibraryId)
        : state.selectedFolderId || ROOT_LIBRARY_FOLDER_ID
      : ROOT_LIBRARY_FOLDER_ID;

    window.setTimeout(() => {
      window.electronAPI?.loadLibrary({
        folderId: targetFolderId === ROOT_LIBRARY_FOLDER_ID ? null : targetFolderId,
      });
    }, 0);
  };

  const renameFolder = (folder: LibraryFolder) => {
    if (!canUseLibraryFolders) {
      return;
    }

    props.dispatch(
      actionSelectDialog('library_folder', {
        mode: 'rename',
        config,
        folder,
      }),
    );
  };

  const removeFolder = (folder: LibraryFolder) => {
    if (!canUseLibraryFolders) {
      return;
    }

    props.dispatch(
      actionSelectDialog('library_folder', {
        mode: 'delete',
        config,
        folder,
      }),
    );
  };

  const reorderFolder = (draggedFolderId: string, targetFolderId: string) => {
    if (!canUseLibraryFolders) {
      return;
    }

    if (draggedFolderId === targetFolderId) {
      return;
    }

    const draggedIndex = config.libraryFolders.findIndex(
      (item) => item.id === draggedFolderId,
    );
    const targetIndex = config.libraryFolders.findIndex(
      (item) => item.id === targetFolderId,
    );

    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const libraryFolders = [...config.libraryFolders];
    const [draggedFolder] = libraryFolders.splice(draggedIndex, 1);
  const insertIndex = draggedIndex < targetIndex ? targetIndex : targetIndex;
    libraryFolders.splice(insertIndex, 0, draggedFolder);

    persistConfig({
      ...config,
      libraryFolders,
    });
  };

  const moveLibraryToFolder = (fileId: string, folderId: string | null) => {
    if (!canUseLibraryFolders) {
      return;
    }

    const currentIndex = config.libraries.findIndex(
      (library) => `${library.id}` === fileId,
    );
    if (currentIndex < 0) {
      return;
    }

    const targetFolderId = folderId === ROOT_LIBRARY_FOLDER_ID ? null : folderId;
    const entry = config.libraries[currentIndex];
    if ((entry.folderId || null) === targetFolderId) {
      return;
    }

    const libraries = [...config.libraries];
    const [moved] = libraries.splice(currentIndex, 1);
    libraries.push({
      ...moved,
      folderId: targetFolderId,
    });
    persistConfig({
      ...config,
      libraries,
    });
    setState((prev) => ({
      ...prev,
      dragOverFolderId: null,
      expandedFolders: targetFolderId
        ? {
            ...prev.expandedFolders,
            [targetFolderId]: true,
          }
        : prev.expandedFolders,
    }));
  };

  const handleLibraryDrop = (
    event: React.DragEvent,
    folderId: string | null,
  ) => {
    event.preventDefault();
    const draggedFolderId = event.dataTransfer.getData('application/x-tinycad-folder');
    if (draggedFolderId) {
      if (folderId && folderId !== ROOT_LIBRARY_FOLDER_ID) {
        reorderFolder(draggedFolderId, folderId);
      }
      setState((prev) => ({
        ...prev,
        dragOverFolderId: null,
        draggedFolderId: null,
      }));
      return;
    }

    const fileId = event.dataTransfer.getData('text/plain');
    if (!fileId) {
      return;
    }

    moveLibraryToFolder(fileId, folderId);
  };

  const handleFolderDragLeave = (
    event: React.DragEvent,
    folderId: string,
  ) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setState((prev) => ({
      ...prev,
      dragOverFolderId:
        prev.dragOverFolderId === folderId ? null : prev.dragOverFolderId,
    }));
  };

  const handleFolderDragStart = (event: React.DragEvent, folderId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tinycad-folder', folderId);
    setState((prev) => ({
      ...prev,
      draggedFolderId: folderId,
    }));
  };

  const handleFolderDragEnd = () => {
    setState((prev) => ({
      ...prev,
      dragOverFolderId: null,
      draggedFolderId: null,
    }));
  };

  const renderLibraryList = (libraries: tclib[]) =>
    libraries.map((lib) => (
      <LibraryView
        lib={lib}
        key={lib.fileId + ''}
        selectedId={state.selectedId}
        findFilter={state.findFilter}
        draggable={canUseLibraryFolders}
        onLibraryClick={(selectedLibrary: tclib) => {
          const selectedFolderId = getLibraryFolderId(`${selectedLibrary.fileId}`);
          setState((prev) => ({
            ...prev,
            selectedFolderId,
            selectedId: null,
            displaySymbol: null,
            displayName: null,
            displaySearchSymbol: null,
          }));
        }}
        onDragStart={() => {
          setState((prev) => ({
            ...prev,
            dragOverFolderId: null,
          }));
        }}
        onSelect={(selectedLibrary: tclib, name: tclibLibraryEntry) => {
          const symbol = selectedLibrary.symbols.find(
            (s: tclibSymbol) => s.SymbolId == name.SymbolID,
          );
          const selectedFolderId = getLibraryFolderId(`${selectedLibrary.fileId}`);
          setState((prev) => ({
            ...prev,
            selectedId: `${selectedLibrary.fileId}:${name.NameID}`,
            selectedFolderId,
            displaySymbol: symbol,
            displayName: name,
            displaySearchSymbol: null,
          }));
        }}
        onSelected={(selectedLibrary: tclib, name: tclibLibraryEntry) => {
          props.dispatch(selectSymbol(selectedLibrary, name));
        }}
      />
    ));

  return (
    <div className={styles.container} ref={props.inputRef}>
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

      <div className={styles.content}>
        {!state.online && !isFileSystem && (
          <>
            <div className={styles.libraryHeader}>
              <span className={styles.libraryTitle}>{t('library.libraries')}</span>
              <div className={styles.headerActions}>
                {canUseLibraryFolders && (
                  <Button
                    className={styles.addButton}
                    appearance="subtle"
                    size="small"
                    icon={<FolderAddRegular />}
                    title={t('library.createFolder')}
                    onClick={createFolder}
                  >
                    <span
                      className={styles.buttonText}
                      data-expanding-text="true"
                    >
                      {t('library.folder')}
                    </span>
                  </Button>
                )}
                {isElectron ? (
                  <>
                    <Button
                      className={styles.addButton}
                      appearance="subtle"
                      size="small"
                      icon={<FolderAddRegular />}
                      title={t('library.addExistingLibrary')}
                      onClick={addLibraries}
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
            <div className={styles.treeContainer} ref={treeContainerRef}>
              {props.libraries.length === 0 && config.libraryFolders.length === 0 ? (
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
                <>
                  {canUseLibraryFolders && groupedFolders.map(({ folder, libraries }) => {
                    const open = isFolderOpen(state.expandedFolders, folder.id);

                    return (
                      <div className={styles.folderGroup} key={folder.id}>
                        <div
                          onDragOver={(event) => {
                            event.preventDefault();
                            setState((prev) => ({
                              ...prev,
                              dragOverFolderId: folder.id,
                            }));
                          }}
                          onDragLeave={(event) => handleFolderDragLeave(event, folder.id)}
                          onDrop={(event) => handleLibraryDrop(event, folder.id)}
                        >
                          <div
                            className={mergeClasses(
                              styles.folderHeader,
                              state.dragOverFolderId === folder.id
                                ? styles.folderHeaderDropTarget
                                : undefined,
                              state.selectedFolderId === folder.id
                                ? styles.folderHeaderSelected
                                : undefined,
                            )}
                            onMouseEnter={() => {
                              setState((prev) => ({
                                ...prev,
                                hoveredFolderId: folder.id,
                              }));
                            }}
                            onMouseLeave={() => {
                              setState((prev) => ({
                                ...prev,
                                hoveredFolderId:
                                  prev.hoveredFolderId === folder.id
                                    ? null
                                    : prev.hoveredFolderId,
                              }));
                            }}
                            onClick={() => {
                              setState((prev) => ({
                                ...prev,
                                selectedFolderId: folder.id,
                                selectedId: null,
                                displaySymbol: null,
                                displayName: null,
                                displaySearchSymbol: null,
                                expandedFolders: {
                                  ...prev.expandedFolders,
                                  [folder.id]: !open,
                                },
                              }));
                            }}
                          >
                            <span className={styles.folderToggle}>
                              {open ? <ChevronDownRegular /> : <ChevronRightRegular />}
                            </span>
                            <FolderRegular />
                            <span className={styles.folderName}>{folder.name}</span>
                            <span
                              className={mergeClasses(
                                styles.folderCount,
                                state.selectedFolderId === folder.id
                                  ? styles.folderCountSelected
                                  : undefined,
                              )}
                            >
                              {libraries.length}
                            </span>
                            {(state.hoveredFolderId === folder.id ||
                              state.selectedFolderId === folder.id) && (
                              <div className={styles.folderActions}>
                                <span
                                  className={styles.dragHandle}
                                  draggable={true}
                                  onClick={(event) => event.stopPropagation()}
                                  onDragStart={(event) => handleFolderDragStart(event, folder.id)}
                                  onDragEnd={handleFolderDragEnd}
                                  title={t('library.reorderFolder')}
                                >
                                  <ReOrderDotsVerticalRegular />
                                </span>
                                <Button
                                  appearance="subtle"
                                  size="small"
                                  icon={<EditRegular />}
                                  title={t('library.renameFolder')}
                                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                                    event.stopPropagation();
                                    renameFolder(folder);
                                  }}
                                />
                                <Button
                                  appearance="subtle"
                                  size="small"
                                  icon={<DeleteRegular />}
                                  title={t('library.removeFolder')}
                                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                                    event.stopPropagation();
                                    removeFolder(folder);
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          {open && (
                            <div className={styles.folderLibraries}>
                              {libraries.length > 0 ? (
                                renderLibraryList(libraries)
                              ) : (
                                <div className={styles.emptyFolder}>
                                  {t('library.dropLibrariesHere')}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canUseLibraryFolders && config.libraryFolders.length > 0 ? (
                    <div className={styles.folderGroup}>
                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          setState((prev) => ({
                            ...prev,
                            dragOverFolderId: ROOT_LIBRARY_FOLDER_ID,
                          }));
                        }}
                        onDragLeave={(event) =>
                          handleFolderDragLeave(event, ROOT_LIBRARY_FOLDER_ID)
                        }
                        onDrop={(event) => handleLibraryDrop(event, ROOT_LIBRARY_FOLDER_ID)}
                      >
                        <div
                          className={mergeClasses(
                            styles.folderHeader,
                            state.dragOverFolderId === ROOT_LIBRARY_FOLDER_ID
                              ? styles.folderHeaderDropTarget
                              : undefined,
                            state.selectedFolderId === ROOT_LIBRARY_FOLDER_ID
                              ? styles.folderHeaderSelected
                              : undefined,
                          )}
                          onClick={() => {
                            setState((prev) => ({
                              ...prev,
                              selectedFolderId: ROOT_LIBRARY_FOLDER_ID,
                              selectedId: null,
                              displaySymbol: null,
                              displayName: null,
                              displaySearchSymbol: null,
                            }));
                          }}
                        >
                          <span className={styles.folderToggle}>
                            <FolderRegular />
                          </span>
                          <span className={styles.folderName}>{t('library.unfiled')}</span>
                          <span
                            className={mergeClasses(
                              styles.folderCount,
                              state.selectedFolderId === ROOT_LIBRARY_FOLDER_ID
                                ? styles.folderCountSelected
                                : undefined,
                            )}
                          >
                            {unfiledLibraries.length}
                          </span>
                        </div>
                        <div className={styles.folderLibraries}>
                          {unfiledLibraries.length > 0 ? (
                            renderLibraryList(unfiledLibraries)
                          ) : (
                            <div className={styles.emptyFolder}>
                              {t('library.dropLibrariesHere')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    renderLibraryList(unfiledLibraries)
                  )}
                </>
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
                setState((prev) => ({
                  ...prev,
                  selectedId: `:${s.nameID}`,
                  displaySymbol: null,
                  displayName: null,
                  displaySearchSymbol: s,
                }));
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
