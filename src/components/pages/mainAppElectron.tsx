import { chooseProjectFolder, closeProjectMode, saveProjectTabs } from '../../io/projectMode';
import { confirmBoardClose } from '../../io/boardWorkspaceEvents';
import React, { FunctionComponent, useEffect } from 'react';
import ContextmenuContainer from '../../state/containers/contextmenuContainer';
import DialogueContainer from '../../state/containers/dialogueContainer';
import DesignAppContainer from '../../state/containers/designAppContainer';
import { Dispatch } from 'redux';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import { handleMenuCommand, handleMenuCommandWithData, initialise } from '../../io/files';
import { BrowserSheetData } from '../../model/dsnView';
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
    window.electronAPI?.setViewMenuState?.({
      hasExampleExplanation: props.hasExampleExplanation,
      exampleExplanationVisible: props.exampleExplanationVisible,
      simulationPanelVisible: props.simulationPanelVisible,
    });
  }, [props.hasExampleExplanation, props.exampleExplanationVisible, props.simulationPanelVisible]);

  useEffect(() => {
    props.dispatch(initialise() as any);
    const params = new URLSearchParams(window.location.search);
    const openProject = (chooseFolder = false) => {
      void import('../../io/projects')
        .then(({ openLaunchedProject, chooseDesktopProjectFolder }) =>
          chooseFolder ? chooseDesktopProjectFolder() : openLaunchedProject(),
        )
        .catch((error) => props.dispatch(actionSelectDialog('io_failure', {
          message: error instanceof Error ? error.message : String(error),
        })));
    };
    const chooseFolder = () => openProject(true);
    window.addEventListener(chooseProjectFolder, chooseFolder);
    if (params.get('project') === '1') openProject();
    if (params.get('about') === '1') {
      props.dispatch(actionSelectDialog('about', null));
    }
    const unsubscribe = window.electronAPI.onMenuCommand((command) => {
      if (command === 'file-open-project-launch') openProject();
      else if (command === 'file-open-project-folder') openProject(true);
      else if (command === 'file-save-all') window.dispatchEvent(new Event(saveProjectTabs));
      else if (command === 'file-close-project') window.dispatchEvent(new Event(closeProjectMode));
      else props.dispatch(handleMenuCommand(command) as any);
    });
    const unsubscribeWithData = window.electronAPI.onMenuCommandWithData((command, data) => {
      props.dispatch(handleMenuCommandWithData(command, data) as any);
    });
    return () => {
      unsubscribe();
      unsubscribeWithData();
      window.removeEventListener(chooseProjectFolder, chooseFolder);
    };
  }, []);

  useEffect(() => {
    if (window.electronAPI?.onAppClosing) {
      const unsubscribe = window.electronAPI.onAppClosing(() => {
        if (!window.dispatchEvent(new Event(confirmBoardClose, { cancelable: true }))) {
          window.electronAPI.sendAppClosingResponse(false);
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
