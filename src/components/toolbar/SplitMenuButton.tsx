import React from 'react';
import { makeStyles, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, tokens, ToolbarButton } from '@fluentui/react-components';
import { ChevronDownRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  splitButton: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  splitButtonMain: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  splitButtonMainHighlighted: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: tokens.colorBrandBackground2,
  },
  splitButtonMenu: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    minWidth: '24px',
    paddingLeft: '2px',
    paddingRight: '2px',
  },
});

// Split button with dropdown menu
export function SplitMenuButton<Item extends { key: string; text: string; image?: string; icon?: React.ReactElement }>({ text, buttonLabel, optionsSuffix, mainImage, icon, highlighted, disabled, onMainClick, menuItems, onMenuItemClick }: {
  text: string;
  buttonLabel?: string;
  optionsSuffix: string;
  mainImage?: string;
  icon?: React.ReactElement;
  disabled?: boolean;
  highlighted: boolean;
  onMainClick: () => void;
  menuItems: readonly Item[];
  onMenuItemClick: (item: Item) => void;
}) {
  const styles = useStyles();
  return (
    <div className={styles.splitButton}>
      <ToolbarButton
        disabled={disabled}
        aria-label={text}
        title={text}
        icon={icon ?? <img src={mainImage} width={18} height={18} alt="" />}
        onClick={onMainClick}
        className={highlighted ? styles.splitButtonMainHighlighted : styles.splitButtonMain}
      >{buttonLabel}</ToolbarButton>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <ToolbarButton
            disabled={disabled}
            aria-label={`${text} ${optionsSuffix}`}
            icon={<ChevronDownRegular />}
            className={styles.splitButtonMenu}
          />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {menuItems.map((item) => (
              <MenuItem
                key={item.key}
                icon={item.icon ?? (item.image ? <img src={item.image} width={18} height={18} alt="" /> : undefined)}
                onClick={() => onMenuItemClick(item)}
              >
                {item.text}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}
