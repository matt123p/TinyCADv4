import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Select,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkRegular, SearchRegular } from '@fluentui/react-icons';
import {
  BUNDLED_SPICE_SYMBOL,
  hasCustomSpiceTemplate,
  modelBinding,
  pinnedSpiceModelPack,
  symbolField,
  type SpiceModelPack,
} from '../../simulation/catalogBindings';
import {
  catalogModelPack,
  inspectSpiceModel,
  searchSpiceModels,
  spiceInstanceTemplate,
  type SpiceCatalogModel,
  type SpiceModelChange,
  type SpiceModelTarget,
} from '../../simulation/spiceModelCatalog';
import { spiceDefinitionText } from '../../simulation/spiceModelDefinitions';
import { openExternalUrl } from '../../util/navigation';

interface Props {
  symbol: SpiceModelTarget;
  packs?: SpiceModelPack[];
  onChange: (selection?: SpiceModelChange) => void;
  children: React.ReactNode;
}

const useStyles = makeStyles({
  surface: {
    width: 'min(840px, calc(100vw - 24px))',
    maxWidth: 'none',
    height: 'min(720px, calc(100dvh - 24px))',
    padding: '24px',
    '@media (max-width: 520px), (max-height: 620px)': { padding: '14px' },
  },
  body: { height: '100%', gridTemplateRows: 'auto minmax(0, 1fr) auto', rowGap: '14px' },
  content: {
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) minmax(0, 1.08fr)',
    gap: '12px',
    minHeight: 0,
    overflow: 'hidden',
    '@media (max-width: 520px)': {
      gridTemplateRows: 'auto minmax(0, 0.7fr) minmax(0, 1.3fr)',
    },
    '@media (max-height: 440px)': {
      gridTemplateRows: 'auto minmax(90px, 1fr) minmax(110px, 1.08fr)',
      overflowY: 'auto',
    },
  },
  actions: {
    flexWrap: 'wrap',
    '@media (max-width: 520px)': {
      gridColumnStart: 1,
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
  },
  validationError: { flexBasis: '100%' },
  scrollArea: {
    overflow: 'auto',
    border: '1px solid ' + tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusMedium,
  },
  table: {
    width: '100%',
    borderCollapse: 'separate',
    borderSpacing: 0,
    tableLayout: 'fixed',
    '& th, & td': { padding: '8px 12px', textAlign: 'left', verticalAlign: 'middle' },
    '& thead th': {
      position: 'sticky',
      top: 0,
      zIndex: 1,
      backgroundColor: tokens.colorNeutralBackground3,
      fontWeight: tokens.fontWeightSemibold,
      boxShadow: 'inset 0 -1px ' + tokens.colorNeutralStroke2,
    },
    '& tbody tr + tr td': { borderTop: '1px solid ' + tokens.colorNeutralStroke3 },
    '& th:first-child': { width: '30%' },
    '& th:nth-child(2)': { width: '20%' },
    '@media (max-width: 520px)': {
      '& th, & td': { paddingLeft: '8px', paddingRight: '8px' },
      '& th:first-child': { width: '55%' },
      '& th:nth-child(2)': { width: 'auto' },
      '& th:nth-child(3), & td:nth-child(3)': { display: 'none' },
    },
  },
  row: {
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    '&[data-selected=true]': { backgroundColor: tokens.colorBrandBackground2 },
    '&[data-selected=true] td:first-child': { boxShadow: 'inset 3px 0 ' + tokens.colorBrandStroke1 },
  },
  modelButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: 0,
    padding: 0,
    backgroundColor: 'transparent',
    font: 'inherit',
    color: 'inherit',
    fontWeight: tokens.fontWeightSemibold,
    textAlign: 'left',
    cursor: 'pointer',
    overflowWrap: 'anywhere',
    ':focus-visible': { outline: '2px solid ' + tokens.colorStrokeFocus2, outlineOffset: '3px' },
  },
  summaryCell: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: tokens.colorNeutralForeground2,
  },
  empty: { color: tokens.colorNeutralForeground3, padding: '12px 14px', margin: 0 },
  details: { padding: '12px 14px' },
  heading: { fontSize: tokens.fontSizeBase400, margin: 0 },
  metadata: { margin: '2px 0 8px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  description: { margin: '0 0 10px', color: tokens.colorNeutralForeground2 },
  fields: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 148px), 1fr))', gap: '8px 12px' },
  mapping: { backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium, padding: '5px 8px' },
  sectionHeading: { fontSize: tokens.fontSizeBase200, margin: '10px 0 5px', fontWeight: tokens.fontWeightSemibold },
  notice: { margin: '10px 0 0', color: tokens.colorNeutralForeground3 },
  attached: {
    maxWidth: '560px',
    padding: '10px 12px',
    border: '1px solid ' + tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
  definition: {
    marginTop: '8px',
    '& summary': {
      cursor: 'pointer',
      width: 'fit-content',
      color: tokens.colorBrandForegroundLink,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  code: {
    maxHeight: '240px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    padding: '10px',
    margin: '8px 0 0',
    border: '1px solid ' + tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
});

const optionKey = (model: SpiceCatalogModel) => model.packId + ':' + model.id;

function SourceLink({ name, url }: { name: string; url: string }) {
  if (!/^https:\/\/(?:github\.com\/|ngspice\.sourceforge\.io\/model-parameters\/)/.test(url)) return <>{name}</>;
  return (
    <Link href={url} onClick={(event: React.MouseEvent) => {
      event.preventDefault();
      openExternalUrl(url);
    }}>
      {name}
    </Link>
  );
}

function DefinitionPreview({ modelId, getPack, template }: {
  modelId: string;
  getPack: () => SpiceModelPack | undefined;
  template?: string;
}) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const code = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (expanded) code.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);
  let definition: string;
  let error: string;
  if (expanded) {
    try {
      const pack = getPack();
      if (!pack) throw new Error('The pinned SPICE model pack is missing.');
      definition = spiceDefinitionText(pack, modelId);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  return (
    <details className={styles.definition} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>View SPICE definition</summary>
      {error && <p role="alert">{error}</p>}
      {definition && (
        <pre ref={code} tabIndex={0} className={styles.code}>
          {template ? template + '\n\n' : ''}{definition}
        </pre>
      )}
    </details>
  );
}

export function SpiceModelPicker({ symbol, packs, onChange, children }: Props) {
  const styles = useStyles();
  const binding = modelBinding(symbol);
  const bundled = !!symbolField(symbol, BUNDLED_SPICE_SYMBOL);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SpiceCatalogModel>();
  const [pins, setPins] = useState<string[]>([]);
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'bundled' | 'custom'>('custom');
  const currentMode = binding ? 'bundled' : mode;
  const matches = useMemo(
    () => open ? searchSpiceModels(query, symbol) : [],
    [open, query, symbol],
  );
  const inspection = selected ? inspectSpiceModel(symbol, selected) : undefined;
  const parameterEntries = Object.entries(parameters);
  const replacing = !!binding || hasCustomSpiceTemplate(symbol);

  const closePicker = () => {
    setOpen(false);
    setError('');
  };
  const commit = (selection?: SpiceModelChange) => {
    try {
      onChange(selection);
      setMode(!selection || selection === 'custom' ? 'custom' : 'bundled');
      closePicker();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const findModel = () => {
    const available = searchSpiceModels('', symbol);
    if (!available.length) {
      setError('No bundled SPICE models are compatible with this symbol.');
      return;
    }
    const name = symbolField(symbol, 'Name') ?? '';
    setQuery(!bundled && name && searchSpiceModels(name, symbol).length ? name : '');
    setSelected(undefined);
    setError('');
    setOpen(true);
  };
  const selectRow = (model: SpiceCatalogModel) => {
    if (selected && optionKey(model) === optionKey(selected)) return;
    const next = inspectSpiceModel(symbol, model);
    setSelected(model);
    setPins(next.mapping);
    setParameters(next.parameters);
    setError('');
  };
  const findButton = (
    <Button size="small" appearance={binding ? 'secondary' : 'primary'} icon={<SearchRegular />} onClick={findModel}>
      Find SPICE model…
    </Button>
  );
  return (
    <>
      <Field label="SPICE definition" size="small">
        <RadioGroup
          layout="horizontal"
          value={currentMode}
          onChange={(_, { value }) => commit(value === 'bundled' ? 'bundled' : 'custom')}
        >
          <Radio value="bundled" label="Bundled" />
          <Radio value="custom" label="Custom" />
        </RadioGroup>
      </Field>
      {currentMode === 'custom' ? children : binding ? (
        <div className={styles.attached}>
          <div>
            <strong>{binding.modelId}</strong> ·{' '}
            <SourceLink name={binding.source?.archiveMember ?? binding.source?.name ?? binding.packId} url={binding.source?.url ?? ''} />
          </div>
          <DefinitionPreview
            key={binding.packId + ':' + binding.revision + ':' + binding.modelId}
            modelId={binding.modelId}
            getPack={() => pinnedSpiceModelPack(binding, packs)}
            template={symbolField(symbol, '$$SPICE')}
          />
          <div className={styles.toolbar}>
            {findButton}
            <Button size="small" appearance="subtle" onClick={() => commit()}>Remove attached model</Button>
          </div>
        </div>
      ) : <div>{findButton}</div>}
      {!open && error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) closePicker(); }}>
        <DialogSurface className={styles.surface}>
          <DialogBody className={styles.body}>
            <DialogTitle>Find SPICE model</DialogTitle>
            <DialogContent className={styles.content}>
              <Field label="Part number, alias or device family">
                <Input
                  value={query}
                  placeholder="Search bundled models"
                  contentBefore={<SearchRegular />}
                  data-autofocus
                  onChange={(_, data) => {
                    setQuery(data.value);
                    setSelected(undefined);
                    setError('');
                  }}
                />
              </Field>
              <div className={styles.scrollArea}>
                <table className={styles.table} aria-label="Search results">
                  <thead>
                    <tr><th scope="col">Model</th><th scope="col">Source</th><th scope="col">Description</th></tr>
                  </thead>
                  <tbody>
                    {matches.map((model, index) => {
                      const active = !!selected && optionKey(selected) === optionKey(model);
                      return (
                        <tr key={optionKey(model)} className={styles.row} data-selected={active} onClick={() => selectRow(model)}>
                          <td>
                            <button
                              type="button"
                              aria-pressed={active}
                              tabIndex={(selected ? active : index === 0) ? 0 : -1}
                              className={styles.modelButton}
                              onKeyDown={(event) => {
                                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                                event.preventDefault();
                                const row = event.currentTarget.closest('tr');
                                const adjacent = event.key === 'ArrowDown' ? row?.nextElementSibling : row?.previousElementSibling;
                                const button = adjacent?.querySelector('button');
                                button?.focus();
                                button?.click();
                              }}
                            >
                              {model.id}{active && <CheckmarkRegular aria-hidden="true" />}
                            </button>
                          </td>
                          <td>{model.source.name}</td>
                          <td className={styles.summaryCell}>{model.description}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!matches.length && (
                  <p className={styles.empty} role="status">
                    {bundled ? 'No compatible model matches this search.' : 'No models match this search.'}
                  </p>
                )}
              </div>
              <section
                key={selected ? optionKey(selected) : 'empty'}
                className={styles.scrollArea}
                aria-label="Model details"
              >
                {selected && inspection ? (
                  <div className={styles.details}>
                    <h2 className={styles.heading}>{selected.id}</h2>
                    <p className={styles.metadata}>
                      <SourceLink name={selected.source.archiveMember ?? selected.source.name} url={selected.source.url} /> · Typical approximation
                    </p>
                    <p className={styles.description}>{selected.description}</p>
                    <h3 className={styles.sectionHeading}>{inspection.preverified ? 'Verified pin mapping' : 'Pin mapping'}</h3>
                    <div className={styles.fields}>
                      {selected.terminals.map((terminal, i) => inspection.preverified ? (
                        <div key={i} className={styles.mapping}>{terminal.role} → pin {inspection.mapping[i]}</div>
                      ) : (
                        <Field key={i} label={terminal.role} size="small">
                          <Select value={pins[i] ?? ''} onChange={(_, data) =>
                            setPins((current) => current.map((pin, index) => index === i ? data.value : pin))
                          }>
                            <option value="">Select a pin</option>
                            {inspection.pins.map((pin) => (
                              <option key={pin.number} value={pin.number}>{pin.number}{pin.name ? ' · ' + pin.name : ''}</option>
                            ))}
                          </Select>
                        </Field>
                      ))}
                    </div>
                    {parameterEntries.length > 0 && (
                      <>
                        <h3 className={styles.sectionHeading}>Model parameters</h3>
                        <div className={styles.fields}>
                          {parameterEntries.map(([name, value]) => (
                            <Field key={name} label={name} size="small">
                              <Input value={value} onChange={(_, data) =>
                                setParameters((current) => ({ ...current, [name]: data.value }))
                              } />
                            </Field>
                          ))}
                        </div>
                      </>
                    )}
                    {!inspection.preverified && inspection.pins.length < selected.terminals.length && (
                      <p className={styles.notice} role="status">This model requires more pins than are available for mapping.</p>
                    )}
                    {replacing && <p className={styles.notice}>Selecting this model replaces the active SPICE template for this symbol.</p>}
                    <DefinitionPreview
                      modelId={selected.id}
                      getPack={() => catalogModelPack(selected)}
                      template={spiceInstanceTemplate(selected, pins, parameters)}
                    />
                  </div>
                ) : <p className={styles.empty}>Select a row to see model details and pin mapping.</p>}
              </section>
            </DialogContent>
            <DialogActions className={styles.actions}>
              {error && (
                <MessageBar intent="error" className={styles.validationError}>
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
              <Button onClick={closePicker}>Cancel</Button>
              <Button
                appearance="primary"
                disabled={!selected || !inspection?.compatible || pins.some((pin) => !pin) || new Set(pins).size !== pins.length}
                onClick={() => commit({
                  modelId: selected.id,
                  packId: selected.packId,
                  revision: selected.revision,
                  pins,
                  parameters,
                  replaceExisting: replacing,
                })}
              >
                Select SPICE model
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
