import { Button } from '@fluentui/react-components';
import React, { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dispatch } from 'redux';
import { login } from '../../io/files';

export interface GithubLoginProps {
  dispatch: Dispatch<any>;
}

export const GithubLogin: FunctionComponent<GithubLoginProps> = (
  props: GithubLoginProps,
) => {
  const { t } = useTranslation();

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="page-content">
        <h1>{t('pages.githubAuthTitle')}</h1>
        <p>
          {t('pages.githubAuthBody')}
        </p>
        <p>{t('pages.githubAuthPrompt')}</p>
        <div>
          <div>
            <Button
              appearance="primary"
              onClick={() => {
                props.dispatch(login);
              }}
            >
              {t('pages.githubLoginButton')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
