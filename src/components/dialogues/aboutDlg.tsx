import React, { FunctionComponent, useState, useEffect } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogContent,
  DialogBody,
  DialogActions,
  Button,
  makeStyles,
  tokens,
  Text,
  Spinner,
} from '@fluentui/react-components';
import { actionCancelDialog } from '../../state/dispatcher/AppDispatcher';
import { useDispatch } from 'react-redux';
import { openExternalUrl } from '../../util/navigation';
import { useTranslation } from 'react-i18next';
import packageJson from '../../../package.json';

const useStyles = makeStyles({
  surface: {
    maxWidth: '700px',
    maxHeight: '80vh',
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
  licenseContainer: {
    maxHeight: '400px',
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
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: '20px',
  },
  link: {
    color: tokens.colorBrandForeground1,
    textDecoration: 'none',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});

// The license text is embedded to ensure it's always available
const LICENSE_TEXT = `GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

Copyright (C) 2007 Free Software Foundation, Inc.
<https://fsf.org/>

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

PREAMBLE

The GNU General Public License is a free, copyleft license for
software and other kinds of works.

The licenses for most software and other practical works are designed
to take away your freedom to share and change the works. By contrast,
the GNU General Public License is intended to guarantee your freedom
to share and change all versions of a program--to make sure it remains
free software for all its users. We, the Free Software Foundation, use
the GNU General Public License for most of our software; it applies
also to any other work released this way by its authors. You can apply
it to your programs, too.

When we speak of free software, we are referring to freedom, not
price. Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

To protect your rights, we need to prevent others from denying you
these rights or asking you to surrender the rights. Therefore, you
have certain responsibilities if you distribute copies of the
software, or if you modify it: responsibilities to respect the freedom
of others.

For example, if you distribute copies of such a program, whether
gratis or for a fee, you must pass on to the recipients the same
freedoms that you received. You must make sure that they, too, receive
or can get the source code. And you must show them these terms so they
know their rights.

Developers that use the GNU GPL protect your rights with two steps:
(1) assert copyright on the software, and (2) offer you this License
giving you legal permission to copy, distribute and/or modify it.

For the developers' and authors' protection, the GPL clearly explains
that there is no warranty for this free software. For both users' and
authors' sake, the GPL requires that modified versions be marked as
changed, so that their problems will not be attributed erroneously to
authors of previous versions.

Some devices are designed to deny users access to install or run
modified versions of the software inside them, although the
manufacturer can do so. This is fundamentally incompatible with the
aim of protecting users' freedom to change the software. The
systematic pattern of such abuse occurs in the area of products for
individuals to use, which is precisely where it is most unacceptable.
Therefore, we have designed this version of the GPL to prohibit the
practice for those products. If such problems arise substantially in
other domains, we stand ready to extend this provision to those
domains in future versions of the GPL, as needed to protect the
freedom of users.

Finally, every program is threatened constantly by software patents.
States should not allow patents to restrict development and use of
software on general-purpose computers, but in those that do, we wish
to avoid the special danger that patents applied to a free program
could make it effectively proprietary. To prevent this, the GPL
assures that patents cannot be used to render the program non-free.

The precise terms and conditions for copying, distribution and
modification follow.

For the full license text, please visit:
https://www.gnu.org/licenses/gpl-3.0.html`;

//
// This component represents the About dialogue
//
export const AboutDialog: FunctionComponent = () => {
  const dispatch = useDispatch();
  const styles = useStyles();
  const { t } = useTranslation();
  const appVersion = packageJson.version ?? '0.0.0';

  const openTinyCadWebsite = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    openExternalUrl('https://www.tinycad.net');
  };

  return (
    <Dialog open={true} onOpenChange={() => dispatch(actionCancelDialog())}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{t('dialogues.about.title')}</DialogTitle>
          <DialogContent>
            <div className={styles.header}>
              <Text className={styles.title}>TinyCAD</Text>
              <Text className={styles.version}>{`${t('dialogues.about.version')} ${appVersion}`}</Text>
              <Text className={styles.description}>
                {t('dialogues.about.description')}
              </Text>
              <a 
                href="https://www.tinycad.net" 
                target="_blank" 
                rel="noopener noreferrer"
                className={styles.link}
                onClick={openTinyCadWebsite}
              >
                www.tinycad.net
              </a>
            </div>
            <div className={styles.licenseTitle}>{t('dialogues.about.licenseTitle')}</div>
            <div className={styles.licenseContainer}>
              <pre className={styles.licenseText}>{LICENSE_TEXT}</pre>
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
