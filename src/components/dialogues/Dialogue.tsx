import React, { FunctionComponent, memo } from 'react';
import EditSheetDialog from './editSheetDlg';
import DesignDetailsDialog from './designDetailsDlg';
import PageSizeDialog from './pageSizeDlg';
import SettingsDialog from './settingsDlg';
import ColoursDialog from './coloursDlg';
import DrcDialog from './drcDlg';
import AnnotateDialog from './annotateDlg';
import NetlistDialog from './netlistDlg';
import { DeleteSheetDialog } from './deleteSheetDlg';
import { ClipboardFailureDialog } from './clipboardFailureDlg';
import ColourPickerDialog from './colourPickerDlg';
import { IoFailureDialog } from './ioFailureDlg';
import { DeleteSymbolDialog } from './deleteSymbolDlg';
import PrintPreviewDialog from './printPreviewDlg';
import { AboutDialog } from './aboutDlg';
import { UnsavedChangesDialog } from './unsavedChangesDlg';
import NetlistTypeEditorDialog from './netlistTypeEditorDlg';
import { ImportSymbolPickerDialog } from './importSymbolPickerDlg';
import { ImportLibrarySymbolPickerDialog } from './importLibrarySymbolPickerDlg';
import { LibraryInfoDialog } from './libraryInfoDlg';
import { LibraryFolderDialog } from './libraryFolderDlg';
import { ReplaceSymbolDialog } from './replaceSymbolDlg';

interface TDialogueProps {
  show_dialogue: string;
  dialogue_props: any;
}

//
// This class represents a ribbon toolbar
//
const TDialogue: FunctionComponent<TDialogueProps> = (
  props: TDialogueProps,
) => {
  switch (props.show_dialogue) {
    case 'sheet_rename':
      return <EditSheetDialog name={props.dialogue_props.name} type="rename" />;
    case 'sheet_add':
      return <EditSheetDialog name={props.dialogue_props.name} type="add" />;
    case 'sheet_delete':
      return <DeleteSheetDialog name={props.dialogue_props.name} />;
    case 'page_size':
      return <PageSizeDialog page_size={props.dialogue_props} />;
    case 'design_details':
      return <DesignDetailsDialog details={props.dialogue_props} />;
    case 'settings':
      return <SettingsDialog details={props.dialogue_props} />;
    case 'colours':
      return <ColoursDialog options={props.dialogue_props} />;
    case 'drc':
      return <DrcDialog drc={props.dialogue_props} />;
    case 'annotate':
      return <AnnotateDialog annotate={props.dialogue_props} />;
    case 'clipboard_failure':
      return <ClipboardFailureDialog />;
    case 'io_failure':
      return <IoFailureDialog message={props.dialogue_props?.message} />;
    case 'colour_picker':
      return (
        <ColourPickerDialog
          target={props.dialogue_props.target}
          title={props.dialogue_props.title}
          settings={props.dialogue_props.settings}
        />
      );
    case 'netlist':
      return <NetlistDialog />;
    case 'netlist_type_editor':
      return <NetlistTypeEditorDialog />;
    case 'symbol_delete':
      return (
        <DeleteSymbolDialog
          name={props.dialogue_props.name}
          nameId={props.dialogue_props.nameId}
        />
      );
    case 'print_preview':
      return <PrintPreviewDialog />;
    case 'about':
      return <AboutDialog />;
    case 'unsaved_changes':
      return (
        <UnsavedChangesDialog
          pendingAction={props.dialogue_props.pendingAction}
        />
      );
    case 'import_symbol_picker':
      return <ImportSymbolPickerDialog symbols={props.dialogue_props.symbols} />;
    case 'import_library_symbol_picker':
      return <ImportLibrarySymbolPickerDialog symbols={props.dialogue_props.symbols} />;
    case 'replace_symbol':
      return (
        <ReplaceSymbolDialog
          sourceUid={props.dialogue_props?.sourceUid}
          targetSymbolId={props.dialogue_props?.targetSymbolId}
          targetSheetIndex={props.dialogue_props?.targetSheetIndex}
          initialSearch={props.dialogue_props?.initialSearch}
        />
      );
    case 'library_info':
      return (
        <LibraryInfoDialog
          name={props.dialogue_props?.name}
          path={props.dialogue_props?.path}
          bad={props.dialogue_props?.bad}
          loadError={props.dialogue_props?.loadError}
        />
      );
    case 'library_folder':
      return (
        <LibraryFolderDialog
          mode={props.dialogue_props?.mode}
          config={props.dialogue_props?.config}
          folder={props.dialogue_props?.folder}
        />
      );
  }

  // No dialogue to show
  return null;
};

export default memo(TDialogue);
