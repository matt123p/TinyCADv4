import React, { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dispatch } from 'redux';
import { initialise } from '../../io/files';

export interface GoogleLoginProps {
  dispatch: Dispatch<any>;
}

export const GoogleLogin: FunctionComponent<GoogleLoginProps> = (
  props: GoogleLoginProps,
) => {
  const { t } = useTranslation();

  React.useEffect(() => {
    // Runs after the first render() lifecycle
    props.dispatch(initialise());
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="page-content">
        <h1>
          {t('pages.googleAuthTitle')}
        </h1>
        <p>
          {t('pages.googleAuthPopup')}
        </p>
        <p>
          {t('pages.googleAuthDrive')}
        </p>
      </div>
    </div>
  );
};
