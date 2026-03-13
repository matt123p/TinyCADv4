import React, { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export const BrowserError: FunctionComponent = () => {
  const { t } = useTranslation();

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="page-content">
        <h1>{t('pages.browserErrorTitle')}</h1>
        <p>
          {t('pages.browserErrorBody')}
        </p>
        <p>{t('pages.browserErrorPrompt')}</p>
        <ul>
          <li>{t('pages.browserChrome')}</li>
          <li>{t('pages.browserEdge')}</li>
          <li>{t('pages.browserChromium')}</li>
        </ul>
      </div>
    </div>
  );
};
