import React from 'react';
import { Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuDivider } from '@fluentui/react-components';
import type { ContextMenuItem } from '../../manipulators/updateInterfaces';

interface ContextMenuProps {
  hidden: boolean;
  target: { x: number; y: number } | null;
  items: ContextMenuItem[];
  onDismiss: () => void;
  onItemClick: (key: string) => void;
}

export const AnchoredContextMenu: React.FC<ContextMenuProps> = ({
  hidden,
  target,
  items,
  onDismiss,
  onItemClick,
}) => {
  if (hidden || !target || !items) {
    return null;
  }

  const renderItems = (menuItems: ContextMenuItem[]) => {
    return menuItems.map((item) => {
      if (item.itemType === 1) {
        return <MenuDivider key={item.key} />;
      }

      if (item.subMenuProps?.items?.length) {
        return (
          <Menu key={item.key} positioning="after" openOnHover>
            <MenuTrigger disableButtonEnhancement>
              <MenuItem disabled={item.disabled} hasSubmenu>
                {item.text}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>{renderItems(item.subMenuProps.items)}</MenuList>
            </MenuPopover>
          </Menu>
        );
      }

      return (
        <MenuItem
          key={item.key}
          disabled={item.disabled}
          onClick={() => onItemClick(item.key)}
        >
          {item.text}
        </MenuItem>
      );
    });
  };

  return (
    <Menu
      open={!hidden}
      onOpenChange={(e, data) => {
        if (!data.open) {
          onDismiss();
        }
      }}
      positioning={{
        target: {
          getBoundingClientRect: () => ({
            x: target.x,
            y: target.y,
            top: target.y,
            left: target.x,
            bottom: target.y,
            right: target.x,
            width: 0,
            height: 0,
            toJSON: () => ({}),
          }),
        },
      }}
    >
      <MenuPopover>
        <MenuList>{renderItems(items)}</MenuList>
      </MenuPopover>
    </Menu>
  );
};
