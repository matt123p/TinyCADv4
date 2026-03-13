import React, { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export interface LoginErrorProps {
  error: string;
}

export const LoginError: FunctionComponent<LoginErrorProps> = (
  props: LoginErrorProps,
) => {
  const { t } = useTranslation();

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="page-content">
        <h1>{t('pages.loginErrorTitle')}</h1>
        <p>
          {t('pages.loginErrorBody')}
        </p>
        <p>{t('pages.loginErrorChecklist')}</p>
        <ul>
          <li>
            {t('pages.loginErrorAdblock')}
          </li>
          <li>
            {t('pages.loginErrorPopup')}
          </li>
          <li>
            {t('pages.loginErrorCookies')}
          </li>
        </ul>
        <p>{t('pages.loginErrorPrefix')} {props.error}</p>
      </div>
    </div>
  );
};
