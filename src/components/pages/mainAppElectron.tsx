import React, { FunctionComponent, useEffect } from 'react';
import ContextmenuContainer from '../../state/containers/contextmenuContainer';
import DialogueContainer from '../../state/containers/dialogueContainer';
import DesignAppContainer from '../../state/containers/designAppContainer';
import { Dispatch } from 'redux';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { handleMenuCommand, handleMenuCommandWithData, initialise } from '../../io/files';
import { BrowserSheetData } from '../../model/dsnView';
import { CurrentFile } from '../../state/stores/altStoreReducer';

export interface MainAppElectronProps {
  selected_sheet: number;
  editSymbol: tclibLibraryEntry;
  editLibrary: tclib;
  browserSheets: BrowserSheetData[];
  dispatch: Dispatch;
  file: CurrentFile;
  saveNeeded: boolean;
}

//
// This class represents the MainAppElectron
//
export const MainAppElectron: FunctionComponent<MainAppElectronProps> = (
  props: MainAppElectronProps,
) => {
  let content = null;

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.setMenuMode) {
      window.electronAPI.setMenuMode(!!props.editLibrary);
    }
  }, [props.editLibrary]);

  useEffect(() => {
    props.dispatch(initialise() as any);
    const unsubscribe = window.electronAPI.onMenuCommand((command) => {
      props.dispatch(handleMenuCommand(command) as any);
    });
    const unsubscribeWithData = window.electronAPI.onMenuCommandWithData((command, data) => {
      props.dispatch(handleMenuCommandWithData(command, data) as any);
    });
    return () => {
      unsubscribe();
      unsubscribeWithData();
    };
  }, []);

  useEffect(() => {
    let name = '';
    if (props.file) {
      name = props.file.name;
    }
    if (name?.length > 0 && props.saveNeeded) {
      name = name + '*';
    }
    window.electronAPI.setTitle(`TinyCAD - ${name}`);
  }, [props.file, props.saveNeeded]);

  useEffect(() => {
    if (window.electronAPI?.onAppClosing) {
      const unsubscribe = window.electronAPI.onAppClosing(() => {
        window.electronAPI.sendAppClosingResponse(props.saveNeeded);
      });
      return unsubscribe;
    } else {
      const beforeUnloadListener = (event: BeforeUnloadEvent) => {
        if (props.saveNeeded) {
          event.preventDefault();
          return (event.returnValue =
            'Design not saved - are you sure you wish to leave?');
        }
      };
      addEventListener('beforeunload', beforeUnloadListener);
      return () => removeEventListener('beforeunload', beforeUnloadListener);
    }
  }, [props.saveNeeded]);

  content = <DesignAppContainer />;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {content}
      <DialogueContainer />
      <ContextmenuContainer />
    </div>
  );
};
