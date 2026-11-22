import React from 'react';
import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, ToolbarButton } from '@fluentui/react-components';
import { ArrowRedoRegular, ArrowUndoRegular, DocumentAddRegular, DocumentRegular, LibraryRegular, SaveCopyRegular, SaveRegular } from '@fluentui/react-icons';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { handleMenuCommand } from '../../io/files';

export function EditorNewMenu({ submenu }: { submenu?: boolean }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const run = (command: string) => () => dispatch(handleMenuCommand(command) as any);
  const label = t('toolbar.new');
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        {submenu ? <MenuItem icon={<DocumentAddRegular />}>{label}</MenuItem> :
          <ToolbarButton icon={<DocumentAddRegular />} aria-label={label} title={label} />}
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<DocumentAddRegular />} onClick={run('file-new')}>{t('toolbar.newDesign')}</MenuItem>
          <MenuItem icon={<LibraryRegular />} onClick={run('tools-new-lib')}>{t('toolbar.newCustomSymbolLibrary')}</MenuItem>
          <MenuDivider />
          <MenuItem icon={<DocumentAddRegular />} onClick={run('file-new-pcb')}>{t('toolbar.newPcb')}</MenuItem>
          <MenuItem icon={<LibraryRegular />} onClick={run('file-new-footprint-library')}>{t('toolbar.newPcbFootprintLibrary')}</MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

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
