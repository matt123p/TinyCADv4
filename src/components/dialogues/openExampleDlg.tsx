import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  makeStyles,
  mergeClasses,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  DismissRegular,
  ImageRegular,
  SearchRegular,
} from '@fluentui/react-icons';
import type {
  ExampleCatalog,
  ExampleContent,
  ExampleGroup,
} from '../../../shared/bundledExamples';
import { exampleResources, ExampleImage, openExample } from '../../io/examples';
import {
  renderExampleMarkdown,
  ExampleMarkdown,
} from '../../io/exampleMarkdown';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { openExternalUrl } from '../../util/navigation';

const useStyles = makeStyles({
  surface: {
    width: '80vw',
    height: '80vh',
    maxWidth: 'none',
    maxHeight: 'none',
    padding: 0,
    zIndex: 1000001,
    overflow: 'hidden',
  },
  backdrop: { zIndex: 1000000 },
  body: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    gap: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 20px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  title: { padding: 0, margin: 0 },
  search: { width: '100%' },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    padding: 0,
    overflow: 'hidden',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '220px minmax(0, 1fr)',
    width: '100%',
    minHeight: 0,
    '@media (max-width: 800px)': {
      gridTemplateColumns: '1fr',
      gridTemplateRows: 'auto minmax(0, 1fr)',
    },
  },
  sidebar: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    overflowY: 'auto',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    '@media (max-width: 800px)': {
      maxHeight: '150px',
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
  },
  nav: {
    width: '100%',
    justifyContent: 'flex-start',
    textAlign: 'left',
    minHeight: '44px',
    columnGap: '8px',
  },
  navTitle: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' },
  navPreview: {
    width: '36px',
    height: '36px',
    flexShrink: 0,
    borderRadius: '4px',
  },
  main: {
    padding: '24px',
    minWidth: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    '@media (max-width: 800px)': { padding: '12px' },
  },
  heading: {
    fontSize: tokens.fontSizeBase600,
    lineHeight: tokens.lineHeightBase600,
    margin: '0 0 20px',
    overflowWrap: 'anywhere',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
    gap: '16px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    minWidth: 0,
    textAlign: 'left',
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ':hover': {
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ':focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  cardPreview: { height: '152px', width: '100%', flexShrink: 0 },
  cardText: {
    padding: '12px 16px',
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    overflowWrap: 'anywhere',
  },
  preview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden',
    color: tokens.colorNeutralForeground3,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cover: { objectFit: 'cover' },
  overview: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 38%) minmax(0, 1fr)',
    gap: '24px',
    marginBottom: '24px',
    alignItems: 'start',
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' },
  },
  heroPreview: {
    width: '100%',
    height: '300px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    '@media (max-width: 800px)': { height: '180px' },
  },
  markdown: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    lineHeight: '1.6',
    '& > :first-child': { marginTop: 0 },
    '& img': { maxWidth: '100%', height: 'auto' },
    '& pre': {
      overflowX: 'auto',
      padding: '12px',
      backgroundColor: tokens.colorNeutralBackground3,
      borderRadius: '6px',
    },
    '& code': { fontFamily: 'monospace' },
    '& table': {
      borderCollapse: 'collapse',
      display: 'block',
      overflowX: 'auto',
      maxWidth: '100%',
    },
    '& th, & td': {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: '6px 10px',
    },
    '& blockquote': {
      marginLeft: 0,
      paddingLeft: '16px',
      borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    },
    '& a': { color: tokens.colorBrandForegroundLink },
  },
  state: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '32px',
    flex: 1,
    textAlign: 'center',
  },
  error: {
    color: tokens.colorStatusDangerForeground1,
    overflowWrap: 'anywhere',
    margin: '8px 0',
  },
  footer: {
    padding: '12px 20px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    gap: '12px',
  },
  hint: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    margin: 0,
  },
  back: { marginBottom: '16px' },
});

function Preview(props: {
  item: ExampleContent;
  className: string;
  cover?: boolean;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [url, setURL] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let image: ExampleImage | undefined;
    setURL('');
    setFailed(false);
    exampleResources
      .image(props.item.preview, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) result.dispose();
        else {
          image = result;
          setURL(result.url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      image?.dispose();
    };
  }, [props.item.preview]);
  return (
    <div className={mergeClasses(styles.preview, props.className)}>
      {failed ? (
        <span>{t('examples.previewUnavailable')}</span>
      ) : url ? (
        <img
          className={mergeClasses(styles.image, props.cover && styles.cover)}
          src={url}
          alt={props.item.title}
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageRegular aria-label={t('examples.loading')} />
      )}
    </div>
  );
}

function Description(props: { item: ExampleContent }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [html, setHTML] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let description: ExampleMarkdown | undefined;
    setHTML(null);
    setError('');
    renderExampleMarkdown(props.item, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) result.dispose();
        else {
          description = result;
          setHTML(result.html);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(String(reason.message || reason));
      });
    return () => {
      controller.abort();
      description?.dispose();
    };
  }, [props.item, revision]);
  if (error)
    return (
      <div role="alert" className={styles.error}>
        {error}{' '}
        <Button onClick={() => setRevision((value) => value + 1)}>
          {t('examples.retry')}
        </Button>
      </div>
    );
  if (html === null)
    return <Spinner size="small" label={t('examples.loading')} />;
  return (
    <div
      ref={container}
      className={styles.markdown}
      onClick={(event) => {
        const anchor = (event.target as Element).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#')) {
          event.preventDefault();
          let id: string;
          try {
            id = decodeURIComponent(href.slice(1));
          } catch {
            return;
          }
          [...(container.current?.querySelectorAll('[id]') || [])]
            .find((node) => node.id === id)
            ?.scrollIntoView({ block: 'start' });
        } else if (/^(https?:|mailto:)/i.test(href)) {
          event.preventDefault();
          openExternalUrl(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface OpenExampleDialogProps {
  groupId?: string;
  exampleId?: string;
}

export default function OpenExampleDialog(props: OpenExampleDialogProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [catalog, setCatalog] = useState<ExampleCatalog | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState({
    groupId: props.groupId,
    exampleId: props.exampleId,
  });
  const [opening, setOpening] = useState(false);
  const openingRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    setError('');
    exampleResources
      .catalog()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((reason) => {
        if (active) setError(String(reason.message || reason));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => () => openingRequest.current?.abort(), []);
  const close = () => {
    openingRequest.current?.abort();
    dispatch(actionCancelDialog());
  };
  const filter = query.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(filter);
  const groups = (catalog?.groups || []).filter(
    (group) =>
      matches(group.title) ||
      group.examples.some((example) => matches(example.title)),
  );
  const group = groups.find((group) => group.id === selection.groupId);
  const example = group?.examples.find(
    (example) => example.id === selection.exampleId,
  );
  const examples =
    group?.examples.filter(
      (example) => matches(group.title) || matches(example.title),
    ) || [];
  const selectGroup = (group?: ExampleGroup) => {
    setError('');
    setSelection({ groupId: group?.id, exampleId: undefined });
  };
  const load = async () => {
    if (!group || !example || opening) return;
    const request = new AbortController();
    openingRequest.current = request;
    setOpening(true);
    setError('');
    try {
      await dispatch(openExample(group.id, example.id, request.signal) as any);
    } catch (reason) {
      if (!request.signal.aborted)
        setError(String((reason as Error).message || reason));
    } finally {
      if (!request.signal.aborted) setOpening(false);
    }
  };
  return (
    <Dialog
      open
      modalType="modal"
      onOpenChange={(_, data) => {
        if (!data.open) close();
      }}
    >
      <DialogSurface
        className={styles.surface}
        backdrop={{ className: styles.backdrop }}
      >
        <DialogBody className={styles.body}>
          <div className={styles.header}>
            <DialogTitle className={styles.title} action={null}>
              {t('examples.openExample')}
            </DialogTitle>
            <Button
              appearance="subtle"
              icon={<DismissRegular />}
              aria-label={t('common.close')}
              onClick={close}
            />
          </div>
          <DialogContent className={styles.content}>
            {!catalog ? (
              <div className={styles.state}>
                {error ? (
                  <>
                    <p role="alert" className={styles.error}>
                      {error}
                    </p>
                    <Button onClick={() => setRevision((value) => value + 1)}>
                      {t('examples.retry')}
                    </Button>
                  </>
                ) : (
                  <Spinner label={t('examples.loading')} />
                )}
              </div>
            ) : catalog.groups.length === 0 ? (
              <div className={styles.state}>
                <ImageRegular fontSize={48} />
                <p>{t('examples.empty')}</p>
              </div>
            ) : (
              <div className={styles.layout}>
                <nav
                  className={styles.sidebar}
                  aria-label={t('examples.groups')}
                >
                  <Input
                    className={styles.search}
                    contentBefore={<SearchRegular />}
                    aria-label={t('examples.search')}
                    placeholder={t('examples.search')}
                    value={query}
                    disabled={opening}
                    onChange={(_, data) => setQuery(data.value)}
                  />
                  <Button
                    className={styles.nav}
                    appearance={!group ? 'primary' : 'subtle'}
                    onClick={() => selectGroup()}
                    disabled={opening}
                  >
                    {t('examples.allGroups')}
                  </Button>
                  {groups.map((item) => (
                    <Button
                      key={item.id}
                      className={styles.nav}
                      appearance={group?.id === item.id ? 'primary' : 'subtle'}
                      aria-label={item.title}
                      onClick={() => selectGroup(item)}
                      disabled={opening}
                    >
                      <Preview
                        item={item}
                        className={styles.navPreview}
                        cover
                      />
                      <span className={styles.navTitle}>{item.title}</span>
                    </Button>
                  ))}
                </nav>
                <main className={styles.main} aria-label={t('examples.browse')}>
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                  {example && group ? (
                    <>
                      <Button
                        className={styles.back}
                        icon={<ArrowLeftRegular />}
                        onClick={() => selectGroup(group)}
                        disabled={opening}
                      >
                        {group.title}
                      </Button>
                      <h2 className={styles.heading}>{example.title}</h2>
                      <div className={styles.overview}>
                        <Preview
                          item={example}
                          className={styles.heroPreview}
                        />
                        <Description item={example} />
                      </div>
                    </>
                  ) : group ? (
                    <>
                      <h2 className={styles.heading}>{group.title}</h2>
                      <div className={styles.overview}>
                        <Preview
                          item={group}
                          className={styles.heroPreview}
                          cover
                        />
                        <Description item={group} />
                      </div>
                      <h3>{t('examples.drawings')}</h3>
                      <div className={styles.grid}>
                        {examples.map((item) => (
                          <button
                            type="button"
                            className={styles.card}
                            key={item.id}
                            disabled={opening}
                            aria-label={item.title}
                            onClick={() => {
                              setError('');
                              setSelection({
                                groupId: group.id,
                                exampleId: item.id,
                              });
                            }}
                          >
                            <Preview
                              item={item}
                              className={styles.cardPreview}
                            />
                            <h4 className={styles.cardText}>{item.title}</h4>
                          </button>
                        ))}
                      </div>
                      {examples.length === 0 && (
                        <p>{t('examples.noResults')}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <h2 className={styles.heading}>{t('examples.groups')}</h2>
                      <div className={styles.grid}>
                        {groups.map((item) => (
                          <button
                            type="button"
                            className={styles.card}
                            key={item.id}
                            disabled={opening}
                            aria-label={item.title}
                            onClick={() => selectGroup(item)}
                          >
                            <Preview
                              item={item}
                              className={styles.cardPreview}
                              cover
                            />
                            <h3 className={styles.cardText}>{item.title}</h3>
                          </button>
                        ))}
                      </div>
                      {groups.length === 0 && <p>{t('examples.noResults')}</p>}
                    </>
                  )}
                </main>
              </div>
            )}
          </DialogContent>
          <div className={styles.footer}>
            <p className={styles.hint}>{t('examples.copyHint')}</p>
            <Button
              appearance="primary"
              disabled={!example || opening}
              onClick={() => {
                void load();
              }}
            >
              {opening ? t('examples.opening') : t('examples.openDrawing')}
            </Button>
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
