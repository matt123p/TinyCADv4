import React from 'react';
import { Menu, MenuList, MenuPopover, MenuTrigger, ToolbarButton } from '@fluentui/react-components';
import { ArrowRedoRegular, ArrowUndoRegular, DocumentRegular, SaveCopyRegular, SaveRegular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';

export function EditorFileMenu({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <ToolbarButton icon={<DocumentRegular />} aria-label={t('toolbar.file')} title={t('toolbar.fileMenu')} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>{children}</MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function EditorSaveButton({ saveAs, disabled, label, title, onClick }: {
  saveAs?: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
  onClick(): void;
}) {
  const { t } = useTranslation();
  const name = label ?? t(saveAs ? 'toolbar.saveAs' : 'toolbar.save');
  return (
    <ToolbarButton aria-label={name} title={title ?? name}
      icon={saveAs ? <SaveCopyRegular /> : <SaveRegular />} disabled={disabled} onClick={onClick} />
  );
}

export function EditorHistoryControls({ canUndo, canRedo, onUndo, onRedo, compactLabels }: {
  canUndo: boolean;
  canRedo: boolean;
  compactLabels?: boolean;
  onUndo(): void;
  onRedo(): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ToolbarButton aria-label={t(compactLabels ? 'toolbar.contextMenu.undo' : 'toolbar.undo')} title={t('toolbar.undo')} icon={<ArrowUndoRegular />}
        disabled={!canUndo} onClick={onUndo} />
      <ToolbarButton aria-label={t(compactLabels ? 'toolbar.contextMenu.redo' : 'toolbar.redo')} title={t('toolbar.redo')} icon={<ArrowRedoRegular />}
        disabled={!canRedo} onClick={onRedo} />
    </>
  );
}
