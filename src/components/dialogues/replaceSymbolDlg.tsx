import React, { FunctionComponent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Label,
  makeStyles,
  Radio,
  RadioGroup,
  tokens,
} from '@fluentui/react-components';
import { useDispatch, useSelector } from 'react-redux';
import {
  actionCancelDialog,
  actionReplaceSymbol,
  actionSelectDialog,
} from '../../state/dispatcher/AppDispatcher';
import { ReplaceSymbolScope } from '../../state/actions/symbolActions';
import { docDrawing } from '../../state/undo/undo';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../../model/tclib';
import { ioXML } from '../../io/ioXml';
import { XMLBuilder } from '../../util/xmlbuilder';
import { sortLibrariesByConfig } from '../../io/libraryConfig';
import SymbolView from '../libraryPanel/SymbolView';

interface ReplaceSymbolDialogProps {
  sourceUid: string;
  targetSymbolId: number;
  targetSheetIndex: number;
  initialSearch?: string;
}

interface ReplaceSymbolOption {
  key: string;
  library: tclib;
  name: tclibLibraryEntry;
  symbol: tclibSymbol | null;
}

const useStyles = makeStyles({
  surface: {
    width: 'min(760px, calc(100vw - 32px))',
    maxWidth: '760px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  search: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  scope: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  list: {
    maxHeight: '360px',
    overflowY: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    padding: '10px 12px',
    cursor: 'pointer',
    backgroundColor: tokens.colorNeutralBackground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowSelected: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  rowTitle: {
    fontWeight: 600,
  },
  preview: {
    flexShrink: 0,
    width: '96px',
    height: '72px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    minWidth: 0,
    flex: 1,
  },
  rowMeta: {
    marginTop: '4px',
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
  },
  empty: {
    padding: '16px 8px',
    color: tokens.colorNeutralForeground3,
  },
});

function loadSymbolData(library: tclib, name: tclibLibraryEntry) {
  const symbol = library.symbols.find((entry) => entry.SymbolId === name.SymbolID);
  if (!symbol) {
    return null;
  }

  const io = new ioXML();
  const xmlBuilder = new XMLBuilder();
  xmlBuilder.fromText(symbol.Data);
  const doc = io.from_dsn(xmlBuilder);
  return doc.sheets.map((sheet) => sheet.items);
}

export const ReplaceSymbolDialog: FunctionComponent<ReplaceSymbolDialogProps> = (
  props: ReplaceSymbolDialogProps,
) => {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const styles = useStyles();
  const libraries = useSelector((state: docDrawing) =>
    sortLibrariesByConfig(state.altStore.libraries, state.altStore.config).filter(
      (library) => !library.bad,
    ),
  );

  const [search, setSearch] = useState(props.initialSearch || '');
  const [keepFieldValues, setKeepFieldValues] = useState(true);
  const [scope, setScope] = useState<ReplaceSymbolScope>('all_symbols_on_sheet');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const options = useMemo<ReplaceSymbolOption[]>(() => {
    const query = search.trim().toLowerCase();
    return libraries.flatMap((library) =>
      library.names
        .filter((name) => {
          if (!query) {
            return true;
          }

          const haystack = [
            name.Name,
            name.Description,
            name.Reference,
            library.name,
          ]
            .filter((value) => !!value)
            .join('\n')
            .toLowerCase();
          return haystack.includes(query);
        })
        .map((name) => ({
          key: `${library.fileId}:${name.NameID}`,
          library,
          name,
          symbol:
            library.symbols.find((symbol) => symbol.SymbolId === name.SymbolID) ||
            null,
        })),
    );
  }, [libraries, search]);

  useEffect(() => {
    if (options.length === 0) {
      setSelectedKey(null);
      return;
    }

    if (selectedKey && options.some((option) => option.key === selectedKey)) {
      return;
    }

    const exactMatch = props.initialSearch
      ? options.find(
          (option) =>
            option.name.Name.toLowerCase() === props.initialSearch?.trim().toLowerCase(),
        )
      : null;
    setSelectedKey((exactMatch || options[0]).key);
  }, [options, props.initialSearch, selectedKey]);

  const selected =
    options.find((option) => option.key === selectedKey) || null;

  const handleReplace = () => {
    if (
      !selected ||
      !props.sourceUid ||
      props.targetSymbolId == null ||
      props.targetSheetIndex == null
    ) {
      return;
    }

    try {
      const symbolData = loadSymbolData(selected.library, selected.name);
      if (!symbolData) {
        dispatch(
          actionSelectDialog('io_failure', {
            message: 'Could not load the selected library symbol.',
          }),
        );
        return;
      }

      dispatch(
        actionReplaceSymbol(
          props.sourceUid,
          props.targetSymbolId,
          props.targetSheetIndex,
          scope,
          selected.name,
          symbolData,
          keepFieldValues,
        ),
      );
      dispatch(actionCancelDialog());
    } catch (error) {
      dispatch(
        actionSelectDialog('io_failure', {
          message: `Could not load the selected library symbol: ${error}`,
        }),
      );
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{t('dialogues.replaceSymbol.title')}</DialogTitle>
          <DialogContent className={styles.content}>
            <p>{t('dialogues.replaceSymbol.message')}</p>
            <div className={styles.search}>
              <Label htmlFor="replace-symbol-search">
                {t('dialogues.replaceSymbol.searchLabel')}
              </Label>
              <Input
                id="replace-symbol-search"
                value={search}
                onChange={(_, data) => setSearch(data.value)}
                placeholder={t('dialogues.replaceSymbol.searchPlaceholder')}
              />
            </div>
            <div className={styles.scope}>
              <Label>{t('dialogues.replaceSymbol.scopeLabel')}</Label>
              <RadioGroup
                value={scope}
                onChange={(_, data) => setScope(data.value as ReplaceSymbolScope)}
              >
                <Radio
                  value="single_symbol"
                  label={t('dialogues.replaceSymbol.thisSymbolOnly')}
                />
                <Radio
                  value="all_symbols_on_sheet"
                  label={t('dialogues.replaceSymbol.allSymbolsOnSheet')}
                />
              </RadioGroup>
            </div>
            <Checkbox
              checked={keepFieldValues}
              label={t('dialogues.replaceSymbol.keepFieldValues')}
              onChange={(_, data) => setKeepFieldValues(!!data.checked)}
            />
            <div className={styles.list}>
              {libraries.length === 0 ? (
                <div className={styles.empty}>{t('dialogues.replaceSymbol.noLibraries')}</div>
              ) : options.length === 0 ? (
                <div className={styles.empty}>{t('dialogues.replaceSymbol.noMatches')}</div>
              ) : (
                options.map((option) => {
                  const selectedRow = option.key === selectedKey;
                  return (
                    <div
                      key={option.key}
                      className={`${styles.row} ${selectedRow ? styles.rowSelected : ''}`}
                      onClick={() => setSelectedKey(option.key)}
                    >
                      <div className={styles.preview}>
                        <SymbolView
                          width={96}
                          height={72}
                          symbol={option.symbol}
                          name={option.name}
                          searchSymbol={null}
                        />
                      </div>
                      <div className={styles.details}>
                        <div className={styles.rowTitle}>{option.name.Name}</div>
                        <div className={styles.rowMeta}>
                          {option.library.name}
                          {option.name.Description ? `\n${option.name.Description}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={
                !selected ||
                !props.sourceUid ||
                props.targetSymbolId == null ||
                props.targetSheetIndex == null
              }
              onClick={handleReplace}
            >
              {t('dialogues.replaceSymbol.replace')}
            </Button>
            <Button appearance="secondary" onClick={() => dispatch(actionCancelDialog())}>
              {t('common.cancel')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
