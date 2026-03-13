import React from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { applyMiddleware, combineReducers, createStore } from 'redux';
import { Provider } from 'react-redux';
import ReduxThunk from 'redux-thunk';
import { DocStoreWithHistory } from './state/undo/undo';
import MainAppElectronContainer from './state/containers/mainAppElectronContainer';
import MainAppBrowserContainer from './state/containers/mainAppBrowserContainer';
import { AltStoreReducer } from './state/stores/altStoreReducer';
import {
  actionCopyEvent,
  actionCutEvent,
  actionMenuSetRecentFileList,
  actionPasteEvent,
} from './state/dispatcher/AppDispatcher';
import { imageFile } from './io/files';
import { initializeNetlistSync } from './io/netlists/netlistSync';
import i18n from './i18n';
import { buildNativeMenuTranslations } from './i18n/nativeMenu';

export const store = createStore(
  combineReducers({ docStore: DocStoreWithHistory, altStore: AltStoreReducer }),
  // window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__()
  applyMiddleware(ReduxThunk),
);

initializeNetlistSync(store as any);

const initializeGoogleAnalytics = () => {
  const analyticsId = process.env.GOOGLE_ANALYTICS_ID;
  if (!analyticsId || analyticsId.trim() === '' || process.env.TARGET_SYSTEM === 'electron') {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${analyticsId}`;
  document.head.appendChild(script);

  (window as any).dataLayer = (window as any).dataLayer || [];
  const gtag = function () {
    (window as any).dataLayer.push(arguments);
  } as (...args: any[]) => void;

  gtag('js', new Date());
  gtag('config', analyticsId);
};

initializeGoogleAnalytics();

const initializeNativeMenuTranslations = () => {
  if (process.env.TARGET_SYSTEM !== 'electron') {
    return;
  }

  let syncRequestId = 0;

  const syncNativeMenu = async () => {
    if (!window.electronAPI?.setMenuTranslations || !i18n.isInitialized) {
      return;
    }

    const requestId = ++syncRequestId;
    const language = i18n.resolvedLanguage || i18n.language;
    if (!language) {
      return;
    }

    await i18n.loadLanguages(language);
    await i18n.loadNamespaces('common');

    if (requestId !== syncRequestId) {
      return;
    }

    const t = i18n.getFixedT(language, 'common');
    window.electronAPI.setMenuTranslations(buildNativeMenuTranslations(t));
  };

  const queueNativeMenuSync = () => {
    void syncNativeMenu();
  };

  i18n.on('initialized', queueNativeMenuSync);
  i18n.on('languageChanged', queueNativeMenuSync);
  queueNativeMenuSync();
};

initializeNativeMenuTranslations();

document.addEventListener('paste', function (e) {
  // cancel paste
  e.preventDefault();

  // Check the clipboard for data
  for (const i in e.clipboardData.items) {
    if (e.clipboardData.items[i].kind == 'string') {
      var text = e.clipboardData.getData('text/plain');
      store.dispatch(actionPasteEvent(text, null));
    } else if (e.clipboardData.items[i].kind == 'file') {
      const file = e.clipboardData.items[i].getAsFile();
      switch (file.type) {
        case 'image/png':
          store.dispatch(imageFile(file, null, 'PNG') as any);
          break;
        case 'image/jpeg':
          // We can add this file as an image
          store.dispatch(imageFile(file, null, 'JPEG') as any);
          break;
      }
    }
  }

  return false;
});

document.addEventListener('cut', function (e) {
  // cancel paste
  e.preventDefault();
  store.dispatch(actionCutEvent());
  return false;
});

document.addEventListener('copy', function (e) {
  // cancel paste
  e.preventDefault();
  store.dispatch(actionCopyEvent());
  return false;
});

const container = document.getElementById('app');
const root = createRoot(container!);
root.render(
  <FluentProvider theme={webLightTheme}>
    <Provider store={store}>
      {process.env.TARGET_SYSTEM === 'electron' ? (
        <MainAppElectronContainer />
      ) : (
        <MainAppBrowserContainer />
      )}
    </Provider>
  </FluentProvider>,
);
