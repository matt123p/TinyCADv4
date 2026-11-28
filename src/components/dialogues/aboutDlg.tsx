import { tinycadUrl } from '../../io/apiServer';
import React, { FunctionComponent, useEffect, useId, useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { useDispatch } from 'react-redux';
import { openExternalUrl } from '../../util/navigation';
import { useTranslation } from 'react-i18next';
import { type LicenseNotice, loadLicenseIndex, loadLicenseText } from '../../io/licenses';
import packageJson from '../../../package.json';

const useStyles = makeStyles({
  surface: {
    maxWidth: '700px',
    maxHeight: '90vh',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: tokens.colorBrandForeground1,
  },
  version: {
    fontSize: '14px',
    color: tokens.colorNeutralForeground2,
  },
  description: {
    fontSize: '14px',
    color: tokens.colorNeutralForeground1,
    textAlign: 'center',
    marginBottom: '8px',
  },
  licensePicker: {
    display: 'grid',
    gap: '6px',
  },
  select: {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: '32px',
    padding: '4px 8px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  licenseContainer: {
    maxHeight: 'min(220px, 25vh)',
    overflow: 'auto',
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '16px',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  licenseText: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '1.5',
    margin: 0,
  },
  licenseTitle: {
    fontWeight: 600,
    fontSize: '14px',
    marginBottom: '8px',
  },
  link: {
    color: tokens.colorBrandForeground1,
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});

function LicenseText({ file }: { file: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadLicenseText(file).then(
      (body) => { if (active) setText(body); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [file]);

  if (failed) return <Text role="alert">{t('dialogues.about.licenseUnavailable')}</Text>;
  if (text === undefined) return <Text role="status">{t('dialogues.about.licenseLoading')}</Text>;
  return (
    <div className={styles.licenseContainer} tabIndex={0}>
      <pre className={styles.licenseText}>{text}</pre>
    </div>
  );
}

export const AboutDialog: FunctionComponent = () => {
  const dispatch = useDispatch();
  const styles = useStyles();
  const { t } = useTranslation();
  const appVersion = packageJson.version ?? '0.0.0';
  const selectId = useId();
  const [notices, setNotices] = useState<LicenseNotice[]>();
  const [selected, setSelected] = useState('');
  const [indexFailed, setIndexFailed] = useState(false);
  const [chromiumFailed, setChromiumFailed] = useState(false);
  const file = selected === '' ? 'tinycad.txt' : notices?.[Number(selected)]?.file;

  useEffect(() => {
    let active = true;
    loadLicenseIndex().then(
      (index) => { if (active) setNotices(index); },
      () => { if (active) setIndexFailed(true); },
    );
    return () => { active = false; };
  }, []);

  const openTinyCadWebsite = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    openExternalUrl('https://www.tinycad.net');
  };

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface className={styles.surface} aria-label="TinyCAD">
        <DialogBody>
          <DialogContent>
            <div className={styles.header}>
              <Text className={styles.title}>TinyCAD</Text>
              <Text className={styles.version}>{`${t('dialogues.about.version')} ${appVersion}`}</Text>
              <Text className={styles.description}>
                {t('dialogues.about.description')}
              </Text>
              <a 
                href={tinycadUrl('/')}
                target="_blank" 
                rel="noopener noreferrer"
                className={styles.link}
                onClick={openTinyCadWebsite}
              >
                www.tinycad.net
              </a>
            </div>
            <div className={styles.licensePicker}>
              <label className={styles.licenseTitle} htmlFor={selectId}>
                {t('dialogues.about.licensePicker')}
              </label>
              <select
                className={styles.select}
                id={selectId}
                value={selected}
                aria-describedby={`${selectId}-help`}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setChromiumFailed(false);
                }}
              >
                <option value="">{t('dialogues.about.tinycadLicense')}</option>
                {notices?.map(({ name, version, license }, index) => (
                  <option key={index} value={index}>
                    {[name, version].filter(Boolean).join(' ')}{license ? ` (${license})` : ''}
                  </option>
                ))}
              </select>
              <Text size={200} id={`${selectId}-help`}>{t('dialogues.about.licensePickerHelp')}</Text>
              {indexFailed && <Text role="alert">{t('dialogues.about.licenseUnavailable')}</Text>}
              {!indexFailed && !notices && <Text role="status">{t('dialogues.about.licenseLoading')}</Text>}
              {file === 'tinycad.txt' && <Text>{packageJson.copyright}</Text>}
              {file === 'chromium' ? (
                <>
                  <Button onClick={() => {
                    setChromiumFailed(false);
                    void window.electronAPI.openChromiumLicenses().catch(() => setChromiumFailed(true));
                  }}>{t('dialogues.about.openChromiumLicenses')}</Button>
                  {chromiumFailed && <Text role="alert">{t('dialogues.about.licenseUnavailable')}</Text>}
                </>
              ) : file && <LicenseText key={file} file={file} />}
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              onClick={() => dispatch(actionCancelDialog())}
            >
              {t('common.close')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
