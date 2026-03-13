import React, { Dispatch } from 'react';
import { dsnPin, dsnSymbol } from '../../model/dsnItem';
import { tclib, tclibLibraryEntry } from '../../model/tclib';
import DetailedLibraryViewContainer from '../../state/containers/detailedLibraryViewContainer';
import EditLibraryViewContainer from '../../state/containers/editLibraryViewContainer';
import LibrariesPanelContainer from '../../state/containers/librariesPanelContainer';
import {
  Panels,
} from '../../state/dispatcher/AppDispatcher';

interface SidePanelProps {
  selectedSymbol: dsnSymbol;
  selectedPin: dsnPin;
  panel: Panels;
  saveInProgress: boolean;
  viewLibrary: tclib;
  editLibrary: tclib;
  editSymbol: tclibLibraryEntry;
  dispatch: Dispatch<any>;
  toggleSidePanel: () => void;
}

interface SidePanelState {}

export class SidePanel extends React.PureComponent<
  SidePanelProps,
  SidePanelState
> {
  private librariesRef = React.createRef<HTMLElement>();

  constructor(props: SidePanelProps) {
    super(props);
  }

  componentDidUpdate(prevProps: SidePanelProps) {
    if (this.props.panel !== prevProps.panel) {
      switch (this.props.panel) {
        case Panels.LibrariesPanel:
          (
            this.librariesRef.current?.getElementsByTagName(
              'INPUT',
            )[0] as HTMLInputElement
          )?.focus();
          break;
        case Panels.StylePanel:
          break;
        case Panels.SymbolPanel:
          break;
      }
    }
  }

  render() {
    return (
      <div className={'side-panel'}>
        <div className="panel">
          <div className="toolbar-group">
            {this.props.editLibrary ? (
              <EditLibraryViewContainer />
            ) : this.props.viewLibrary ? (
              <DetailedLibraryViewContainer />
            ) : (
              <LibrariesPanelContainer inputRef={this.librariesRef} toggleSidePanel={this.props.toggleSidePanel} />
            )}
          </div>
        </div>
      </div>
    );
  }
}
