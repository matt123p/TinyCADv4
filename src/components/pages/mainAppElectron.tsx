import { closeProjectMode, confirmProjectClose, saveActiveProjectFile, saveProjectTabs } from '../../io/projectMode';
import { openLaunchedProject, openProjectFolder } from '../../io/projects';
import { useStore } from 'react-redux';
import type { docDrawing } from '../../state/undo/undo';
import React, { FunctionComponent, useEffect } from 'react';
import ContextmenuContainer from '../../state/containers/contextmenuContainer';
import DialogueContainer from '../../state/containers/dialogueContainer';
import DesignAppContainer from '../../state/containers/designAppContainer';
import { Dispatch } from 'redux';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { handleMenuCommand, handleMenuCommandWithData, initialise } from '../../io/files';
import { BrowserSheetData } from '../../model/dsnView';
import { CurrentFile } from '../../state/stores/altStoreReducer';
import { actionSelectDialog } from '../../state/dispatcher/AppDispatcher';

export interface MainAppElectronProps {
  hasExampleExplanation: boolean;
  exampleExplanationVisible: boolean;
  simulationPanelVisible: boolean;
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
  const store = useStore<docDrawing>();

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.setMenuMode) {
      window.electronAPI.setMenuMode(!!props.editLibrary);
    }
  }, [props.editLibrary]);

  useEffect(() => {
    window.electronAPI?.setViewMenuState?.({
      hasExampleExplanation: props.hasExampleExplanation,
      exampleExplanationVisible: props.exampleExplanationVisible,
      simulationPanelVisible: props.simulationPanelVisible,
    });
  }, [props.hasExampleExplanation, props.exampleExplanationVisible, props.simulationPanelVisible]);

  useEffect(() => {
    props.dispatch(initialise() as any);
    const params = new URLSearchParams(window.location.search);
    if (params.get('about') === '1') {
      props.dispatch(actionSelectDialog('about', null));
    }
    const openFolder = (id?: string, launch = false) => {
      void (launch ? openLaunchedProject() : openProjectFolder(id)).catch((error) => props.dispatch(actionSelectDialog('io_failure', {
        message: error instanceof Error ? error.message : String(error),
      })));
    };
    const unsubscribe = window.electronAPI.onMenuCommand((command) => {
      if (command === 'file-open-project-folder') openFolder();
      else if (command === 'file-open-project-launch') openFolder(undefined, true);
      else if (command === 'file-close-project') window.dispatchEvent(new Event(closeProjectMode));
      else if (command === 'file-save-all') window.dispatchEvent(new Event(saveProjectTabs));
      else if (command !== 'file-save' || window.dispatchEvent(new Event(saveActiveProjectFile, { cancelable: true })))
        props.dispatch(handleMenuCommand(command) as any);
    });
    const unsubscribeWithData = window.electronAPI.onMenuCommandWithData((command, data) => {
      if (command === 'file-open-recent-project') openFolder(data.id);
      else props.dispatch(handleMenuCommandWithData(command, data) as any);
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
        if (store.getState().schematicTabs?.enabled) {
          window.electronAPI.sendAppClosingResponse(
            window.dispatchEvent(new Event(confirmProjectClose, { cancelable: true })),
          );
          return;
        }
        if (props.saveNeeded) {
          props.dispatch(
            actionSelectDialog('unsaved_changes', {
              pendingAction: { type: 'app-close' },
            }),
          );
          return;
        }

        window.electronAPI.sendAppClosingResponse(true);
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
