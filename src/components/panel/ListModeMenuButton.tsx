import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';

interface ListModeMenuButtonProps {
  listMode: 'symbols' | 'netlist';
  onListModeChange: (mode: 'symbols' | 'netlist') => void;
  className?: string;
  stopPropagation?: boolean;
}

export const ListModeMenuButton: React.FC<ListModeMenuButtonProps> = ({
  listMode,
  onListModeChange,
  className,
  stopPropagation = false,
}) => {
  const { t } = useTranslation();
  const listModeLabel =
    listMode === 'symbols'
      ? t('panel.listMode.symbols')
      : t('panel.listMode.netlist');

  const handleMouseEvent = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event.stopPropagation();
    }
  };

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          type="button"
          size="small"
          appearance="subtle"
          icon={<ChevronDownRegular />}
          iconPosition="after"
          className={className}
          onMouseDown={handleMouseEvent}
          onClick={handleMouseEvent}
        >
          {listModeLabel}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem onClick={() => onListModeChange('symbols')}>
            {listMode === 'symbols' ? '✓ ' : ''}
            {t('panel.listMode.symbols')}
          </MenuItem>
          <MenuItem onClick={() => onListModeChange('netlist')}>
            {listMode === 'netlist' ? '✓ ' : ''}
            {t('panel.listMode.netlist')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};
