import React, { FunctionComponent } from 'react';
import ContextmenuContainer from '../../state/containers/contextmenuContainer';
import DialogueContainer from '../../state/containers/dialogueContainer';
import LoginErrorContainer from '../../state/containers/loginErrorContainer';
import GoogleLoginContainer from '../../state/containers/googleLoginContainer';
import TopbarContainer from '../../state/containers/topbarContainer';
import DesignAppContainer from '../../state/containers/designAppContainer';
import { Dispatch } from 'redux';
import { tclibLibraryEntry } from '../../model/tclib';
import { initialise } from '../../io/files';
import { BrowserError } from './browserError';

export interface MainAppBrowserProps {
  loginState: number;
  selected_sheet: number;
  editSymbol: tclibLibraryEntry;
  dispatch: Dispatch;
}

//
// This class represents the MainAppBrowser
//
export const MainAppBrowser: FunctionComponent<MainAppBrowserProps> = (
  props: MainAppBrowserProps,
) => {
  let content = null;

  switch (props.loginState) {
    case 1: // Please log in
      if (process.env.TARGET_SYSTEM === 'google') {
        content = <GoogleLoginContainer />;
      } else {
        if (process.env.TARGET_SYSTEM === 'filesystem') {
          props.dispatch(initialise() as any);
        }
      }
      break;
    case 3: // User is logged in
      content = <DesignAppContainer />;
      break;
    case 4:
      // User could not be logged in
      content = <LoginErrorContainer />;
      break;
    case 5:
      // User could not be logged in
      content = <BrowserError />;
      break;
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <TopbarContainer />
      {content}
      <DialogueContainer />
      <ContextmenuContainer />
    </div>
  );
};
