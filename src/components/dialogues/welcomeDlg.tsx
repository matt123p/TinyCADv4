import React, { useEffect, useId, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Link,
  Option,
  makeStyles,
  mergeClasses,
  Spinner,
  tokens,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ChevronRightRegular,
  DismissRegular,
  DocumentRegular,
  FolderOpenRegular,
  ImageRegular,
} from '@fluentui/react-icons';
import packageJson from '../../../package.json';
import type {
  ExampleCatalog,
  ExampleContent,
  ExampleGroup,
} from '../../../shared/bundledExamples';
import { helpLinks, manualLinks } from '../../../shared/helpLinks';
import {
  normalizeLanguageCode,
  persistLanguagePreference,
  SUPPORTED_LANGUAGES,
} from '../../i18n/languages';
import { exampleResources, ExampleImage, openExample } from '../../io/examples';
import { fileNew, fileOpen } from '../../io/files';
import { openExternalUrl } from '../../util/navigation';
import { ExampleDescription } from '../examples/ExampleDescription';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import type { CurrentFile } from '../../state/stores/altStoreReducer';
import type { docDrawing } from '../../state/undo/undo';
import {
  setShowWelcomeOnStartup,
  showWelcomeOnStartup,
} from '../../io/welcomePreferences';
import tinyCADIcon from 'url:../../../assets/TinyCAD.png';
import { WelcomeCircuit } from './WelcomeCircuit';
import { LanguageFlag } from '../controls/LanguageFlag';

const useStyles = makeStyles({
  surface: {
    width: 'min(96vw, 1120px)',
    height: 'min(94dvh, clamp(760px, 57vw, 800px))',
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
    padding: '10px clamp(14px, 2vw, 30px)',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: tokens.fontSizeBase600,
    padding: 0,
    margin: 0,
  },
  logo: { width: '32px', height: '32px', objectFit: 'contain' },
  version: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  languageDropdown: { minWidth: '132px' },
  languageOption: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    padding: 0,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    padding: 'clamp(14px, 2vw, 30px)',
    minWidth: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  heading: {
    fontSize: tokens.fontSizeBase600,
    lineHeight: tokens.lineHeightBase600,
    margin: '0 0 20px',
    overflowWrap: 'anywhere',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
    alignItems: 'center',
    gap: '20px 32px',
    padding: 'clamp(18px, 2.3vw, 26px)',
    marginBottom: '24px',
    borderRadius: '10px',
    overflow: 'hidden',
    color: '#152140',
    backgroundImage: 'linear-gradient(115deg, #e0f0fd, #eaf5ff 68%, #dfedfb)',
    '@media (max-width: 680px)': { gridTemplateColumns: '1fr' },
  },
  welcomeHeading: {
    fontSize: 'clamp(27px, 3.4vw, 42px)',
    fontWeight: 750,
    lineHeight: 1.08,
    letterSpacing: '-0.025em',
    margin: 0,
  },
  welcomeText: {
    fontSize: 'clamp(14px, 1.3vw, 18px)',
    lineHeight: 1.4,
    margin: '8px 0 16px',
  },
  heroActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px 14px',
  },
  heroButton: { minHeight: '38px', padding: '6px 14px', fontSize: '14px' },
  firstDrawingHelp: { margin: '12px 0 8px' },
  recentPanel: {
    minWidth: 0,
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: 'rgba(255, 255, 255, 0.76)',
    overflow: 'hidden',
    padding: '12px',
  },
  recentTitle: { margin: '0 0 6px', fontSize: tokens.fontSizeBase400 },
  recentList: {
    padding: 0,
    margin: 0,
    listStyleType: 'none',
    maxHeight: '138px',
    overflowY: 'auto',
  },
  recentButton: {
    width: '100%',
    justifyContent: 'flex-start',
    textAlign: 'left',
  },
  recentName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  heroArtwork: {
    width: '100%',
    height: 'clamp(126px, 16vw, 184px)',
    backgroundImage: 'radial-gradient(circle, #91baf3 1px, transparent 1.4px)',
    backgroundSize: '18px 18px',
  },
  sectionHeader: {
    marginBottom: '16px',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 'clamp(23px, 2.2vw, 36px)',
    lineHeight: 1.15,
    letterSpacing: '-0.02em',
  },
  helpLinks: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '14px',
    rowGap: '8px',
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    '& > li + li': {
      borderInlineStartWidth: '1px',
      borderInlineStartStyle: 'solid',
      borderInlineStartColor: tokens.colorNeutralStroke2,
      paddingInlineStart: '14px',
    },
  },
  groupGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '16px',
    '@media (max-width: 1030px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '@media (max-width: 490px)': { gridTemplateColumns: '1fr' },
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
  groupPreview: {
    height: 'clamp(104px, 14dvh, 154px)',
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0,
  },
  groupCardBody: {
    width: '100%',
    padding: '8px 12px 10px',
    boxSizing: 'border-box',
  },
  groupCardHeading: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: 0,
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    overflowWrap: 'anywhere',
  },
  groupCardArrow: { flexShrink: 0 },
  groupSummary: {
    margin: '5px 0 0',
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
  },
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
  detailMain: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflowY: 'hidden',
  },
  detail: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 38%) minmax(0, 1fr)',
    gridTemplateRows: 'minmax(0, 1fr)',
    gap: '24px',
    flex: 1,
    minHeight: 0,
    '@media (max-width: 800px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'minmax(0, 35%) minmax(0, 1fr)',
      gap: '12px',
    },
  },
  detailPreview: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    '@media (max-width: 800px)': {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(100px, 40%)',
      gridTemplateRows: 'auto minmax(0, 1fr)',
      columnGap: '12px',
    },
  },
  detailImage: {
    minHeight: 0,
    flexShrink: 1,
    boxSizing: 'border-box',
    '@media (max-width: 800px)': {
      gridColumn: '2',
      gridRow: '1 / span 2',
      height: '100%',
    },
  },
  detailDescription: {
    minWidth: 0,
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingRight: '12px',
  },
  heroPreview: {
    width: '100%',
    height: '300px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    '@media (max-width: 800px)': { height: '180px' },
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
    padding: '12px clamp(14px, 2vw, 30px)',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    gap: '12px',
    flexWrap: 'wrap',
  },
  exampleFooter: { justifyContent: 'flex-end' },
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

interface WelcomeDialogProps {
  groupId?: string;
  exampleId?: string;
}

const welcomeGroupSummaries = new Map([
  ['electronics', 'examples.electronicsSummary'],
  ['schematics', 'examples.schematicsSummary'],
  ['spice-tutorial', 'examples.spiceSummary'],
  ['xspice-tutorial', 'examples.xspiceSummary'],
]);

function HelpLink({
  url,
  children,
  description,
}: {
  url: string;
  children: string;
  description?: string;
}) {
  const link = (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        openExternalUrl(url);
      }}
    >
      {children}
    </Link>
  );
  return description ? (
    <Tooltip content={description} relationship="description">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function WelcomeHero({
  onNew,
  onOpen,
  recentFiles,
  onRecent,
  firstDrawingUrl,
  startupCheckbox,
}: {
  onNew: () => void;
  onOpen: () => void;
  recentFiles: CurrentFile[];
  onRecent: (file: CurrentFile) => void;
  firstDrawingUrl: string;
  startupCheckbox: React.ReactNode;
}) {
  const styles = useStyles();
  const { t } = useTranslation();

  return (
    <section className={styles.hero}>
      <div>
        <h2 className={styles.welcomeHeading}>{t('examples.welcomeTitle')}</h2>
        <p className={styles.welcomeText}>{t('examples.welcomeText')}</p>
        <div className={styles.heroActions}>
          {process.env.TARGET_SYSTEM !== 'google' && (
            <Button
              className={styles.heroButton}
              appearance="primary"
              icon={<FolderOpenRegular />}
              onClick={onOpen}
            >
              {t('examples.openFile')}
            </Button>
          )}
          <Button
            className={styles.heroButton}
            icon={<DocumentRegular />}
            onClick={onNew}
          >
            {t('examples.newDrawing')}
          </Button>
        </div>
        <p className={styles.firstDrawingHelp}>
          <HelpLink url={firstDrawingUrl}>
            {t('examples.helpFirstDrawing')}
          </HelpLink>
        </p>
        {startupCheckbox}
      </div>
      {recentFiles.length > 0 ? (
        <section
          className={styles.recentPanel}
          aria-label={t('toolbar.openRecent')}
        >
          <h3 className={styles.recentTitle}>{t('toolbar.openRecent')}</h3>
          <ul className={styles.recentList}>
            {recentFiles.map((file, index) => (
              <li
                key={
                  typeof file.id === 'string'
                    ? file.id
                    : `${index}/${file.name}`
                }
              >
                <Button
                  appearance="subtle"
                  className={styles.recentButton}
                  icon={<DocumentRegular />}
                  title={typeof file.id === 'string' ? file.id : file.name}
                  onClick={() => onRecent(file)}
                >
                  <span className={styles.recentName}>{file.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <WelcomeCircuit className={styles.heroArtwork} />
      )}
    </section>
  );
}

function WelcomeHelp({ language }: { language: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const docs = manualLinks(language);
  return (
    <>
      <ul className={styles.helpLinks}>
        <li>
          <HelpLink url={docs.simulation}>
            {t('examples.helpSimulation')}
          </HelpLink>
        </li>
        <li>
          <HelpLink url={docs.aiAssistant}>
            {t('examples.helpAiAssistant')}
          </HelpLink>
        </li>
      </ul>
      <ul className={styles.helpLinks}>
        <li>
          <HelpLink
            url={helpLinks.discord}
            description={t('examples.communityHelp')}
          >
            {t('examples.helpDiscord')}
          </HelpLink>
        </li>
        <li>
          <HelpLink url={helpLinks.issues}>{t('toolbar.reportIssue')}</HelpLink>
        </li>
      </ul>
    </>
  );
}

export default function WelcomeDialog(props: WelcomeDialogProps) {
  const styles = useStyles();
  const { t, i18n } = useTranslation();
  const language = normalizeLanguageCode(
    i18n.resolvedLanguage || i18n.language,
  );
  const languageName = SUPPORTED_LANGUAGES.find(
    ({ code }) => code === language,
  ).label;
  const languageValueId = useId();
  const dispatch = useDispatch();
  const recentFiles = useSelector(
    (state: docDrawing) => state.altStore.recentFiles,
  );
  const [showAtStartup, setShowAtStartup] = useState(showWelcomeOnStartup);
  const [catalog, setCatalog] = useState<ExampleCatalog | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
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
  const runFileAction = (
    action: ReturnType<typeof fileNew> | ReturnType<typeof fileOpen>,
  ) => {
    close();
    dispatch(action as any);
  };
  const groups = catalog?.groups ?? [];
  const group = catalog?.groups.find((group) => group.id === selection.groupId);
  const example = group?.examples.find(
    (example) => example.id === selection.exampleId,
  );
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
              <img className={styles.logo} src={tinyCADIcon} alt="" />
              TinyCAD{' '}
              <span className={styles.version}>v{packageJson.version}</span>
            </DialogTitle>
            <div className={styles.headerActions}>
              <Dropdown
                className={styles.languageDropdown}
                aria-label={t('language.label')}
                aria-describedby={languageValueId}
                inlinePopup
                value={languageName}
                selectedOptions={[language]}
                button={{
                  children: (
                    <span className={styles.languageOption}>
                      <LanguageFlag language={language} />
                      <span id={languageValueId} lang={language}>
                        {languageName}
                      </span>
                    </span>
                  ),
                }}
                onOptionSelect={(_, { optionValue }) => {
                  if (!optionValue) return;
                  persistLanguagePreference(optionValue);
                  void i18n.changeLanguage(optionValue);
                }}
              >
                {SUPPORTED_LANGUAGES.map(({ code, label }) => (
                  <Option key={code} value={code} text={label} lang={code}>
                    <span className={styles.languageOption}>
                      <LanguageFlag language={code} />
                      {label}
                    </span>
                  </Option>
                ))}
              </Dropdown>
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label={t('common.close')}
                onClick={close}
              />
            </div>
          </div>
          <DialogContent className={styles.content}>
            <main
              key={
                example ? `${group.id}/${example.id}` : group?.id ?? 'welcome'
              }
              className={mergeClasses(
                styles.main,
                example && styles.detailMain,
              )}
              aria-label={t('examples.browse')}
            >
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {example && group ? (
                <div
                  className={styles.detail}
                  key={`${group.id}/${example.id}`}
                >
                  <div className={styles.detailPreview}>
                    <Button
                      className={styles.back}
                      icon={<ArrowLeftRegular />}
                      onClick={() => selectGroup(group)}
                      disabled={opening}
                    >
                      {group.title}
                    </Button>
                    <h2 className={styles.heading}>{example.title}</h2>
                    <Preview
                      item={example}
                      className={mergeClasses(
                        styles.heroPreview,
                        styles.detailImage,
                      )}
                    />
                  </div>
                  <div
                    className={styles.detailDescription}
                    role="region"
                    aria-label={example.title}
                    tabIndex={0}
                  >
                    <ExampleDescription item={example} />
                  </div>
                </div>
              ) : group ? (
                <>
                  <Button
                    className={styles.back}
                    icon={<ArrowLeftRegular />}
                    onClick={() => selectGroup()}
                  >
                    {t('examples.allGroups')}
                  </Button>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>{group.title}</h2>
                  </div>
                  <div className={styles.overview}>
                    <Preview
                      item={group}
                      className={styles.heroPreview}
                      cover
                    />
                    <ExampleDescription item={group} />
                  </div>
                  <h3>{t('examples.drawings')}</h3>
                  <div className={styles.grid}>
                    {group.examples.map((item) => (
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
                        <Preview item={item} className={styles.cardPreview} />
                        <h4 className={styles.cardText}>{item.title}</h4>
                      </button>
                    ))}
                  </div>
                  {group.examples.length === 0 && <p>{t('examples.empty')}</p>}
                </>
              ) : (
                <>
                  <WelcomeHero
                    onNew={() => runFileAction(fileNew())}
                    onOpen={() => runFileAction(fileOpen())}
                    recentFiles={recentFiles}
                    onRecent={(file) => runFileAction(fileOpen(file))}
                    firstDrawingUrl={manualLinks(language).firstDrawing}
                    startupCheckbox={
                      <Checkbox
                        checked={showAtStartup}
                        label={t('examples.showWelcomeOnStartup')}
                        onChange={(_, { checked }) => {
                          const show = checked === true;
                          try {
                            setShowWelcomeOnStartup(show);
                            setShowAtStartup(show);
                          } catch (reason) {
                            setError(String(reason));
                          }
                        }}
                      />
                    }
                  />
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>
                      {t('examples.explore')}
                    </h2>
                  </div>
                  {!catalog ? (
                    <div className={styles.state}>
                      {error ? (
                        <Button
                          onClick={() => setRevision((value) => value + 1)}
                        >
                          {t('examples.retry')}
                        </Button>
                      ) : (
                        <Spinner label={t('examples.loading')} />
                      )}
                    </div>
                  ) : groups.length ? (
                    <div className={styles.groupGrid}>
                      {groups.map((item) => {
                        const summary = welcomeGroupSummaries.get(item.id);
                        return (
                          <button
                            type="button"
                            className={styles.card}
                            key={item.id}
                            aria-label={item.title}
                            onClick={() => selectGroup(item)}
                          >
                            <Preview
                              item={item}
                              className={styles.groupPreview}
                            />
                            <div className={styles.groupCardBody}>
                              <h3 className={styles.groupCardHeading}>
                                {item.title}
                                <ChevronRightRegular
                                  className={styles.groupCardArrow}
                                />
                              </h3>
                              {summary && (
                                <p className={styles.groupSummary}>
                                  {t(summary)}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p>{t('examples.empty')}</p>
                  )}
                </>
              )}
            </main>
          </DialogContent>
          <div
            className={mergeClasses(
              styles.footer,
              example && styles.exampleFooter,
            )}
          >
            {example ? (
              <Button
                appearance="primary"
                disabled={opening}
                onClick={() => {
                  void load();
                }}
              >
                {opening ? t('examples.opening') : t(example.project ? 'examples.openProject' : 'examples.openDrawing')}
              </Button>
            ) : (
              <WelcomeHelp language={language} />
            )}
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
