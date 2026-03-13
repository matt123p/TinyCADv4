import React, { Fragment, Dispatch, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
  Text,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import {
  ChevronDownRegular,
  RenameRegular,
  ChevronRightRegular,
  ChevronLeftRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import {
  actionSheetSelect,
  actionSelectDialog,
  actionSheetRight,
  actionSheetLeft,
  actionSheetMove,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';

const useStyles = makeStyles({
  sheetHeading: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    userSelect: 'none',
    whiteSpace: 'nowrap',
    backgroundColor: 'transparent',
    border: `1px solid transparent`,
    transition: 'background-color 0.1s ease, border-color 0.1s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  sheetHeadingOn: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopColor: tokens.colorNeutralStroke1,
    borderBottomColor: tokens.colorNeutralStroke1,
    borderLeftColor: tokens.colorNeutralStroke1,
    borderRightColor: tokens.colorNeutralStroke1,
    boxShadow: `0 1px 2px ${tokens.colorNeutralShadowAmbient}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  sheetHeadingIcon: {
    marginLeft: '4px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    color: tokens.colorNeutralForeground2,
    '&:hover': {
      color: tokens.colorNeutralForeground1,
    },
  },
  dragging: {
    opacity: 0.5,
  },
  dragOver: {
    borderLeft: `2px solid ${tokens.colorBrandForeground1}`,
  },
});

export interface MenuItemData {
  key: string;
  text: string;
  iconName?: string;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
}

interface SheetTabProps {
  name: string;
  index: number;
  selected: boolean;
  hierarchicalSymbol: boolean;
  dispatch: Dispatch<any>;
  menu?: MenuItemData[];
  canDelete: boolean;
  draggable?: boolean;
  onDragStart?: (index: number) => void;
  onDragOver?: (index: number) => void;
  onDragEnd?: () => void;
  onDrop?: (targetIndex: number) => void;
  isDragOver?: boolean;
}

const SheetTab: React.FC<SheetTabProps> = (props) => {
  const { t } = useTranslation();
  const styles = useStyles();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleClick = () => {
    props.dispatch(actionSheetSelect(props.index));
  };

  const handleSheetRename = () => {
    props.dispatch(
      actionSelectDialog('sheet_rename', { name: props.name }),
    );
  };

  const handleSheetRight = () => {
    props.dispatch(actionSheetRight());
  };

  const handleSheetLeft = () => {
    props.dispatch(actionSheetLeft());
  };

  const handleSheetDelete = () => {
    props.dispatch(
      actionSelectDialog('sheet_delete', {
        name: props.hierarchicalSymbol
          ? t('toolbar.sheetbar.hierarchicalSymbol')
          : props.name,
      }),
    );
  };

  const displayName = props.hierarchicalSymbol
    ? t('toolbar.sheetbar.hierarchicalSymbol')
    : props.name;

  // Default menu items for sheet tabs
  const defaultMenu: MenuItemData[] = props.hierarchicalSymbol
    ? [
        {
          key: 'delete',
          text: t('toolbar.sheetbar.menu.delete'),
          iconName: 'Delete',
          onClick: handleSheetDelete,
          disabled: !props.canDelete,
        },
      ]
    : [
        {
          key: 'rename',
          text: t('toolbar.sheetbar.menu.rename'),
          iconName: 'rename',
          onClick: handleSheetRename,
        },
        {
          key: 'divider_1',
          text: '',
          divider: true,
        },
        {
          key: 'right',
          text: t('toolbar.sheetbar.menu.moveRight'),
          iconName: 'ChevronRight',
          onClick: handleSheetRight,
        },
        {
          key: 'left',
          text: t('toolbar.sheetbar.menu.moveLeft'),
          iconName: 'ChevronLeft',
          onClick: handleSheetLeft,
        },
        {
          key: 'divider_3',
          text: '',
          divider: true,
        },
        {
          key: 'delete',
          text: t('toolbar.sheetbar.menu.delete'),
          iconName: 'Delete',
          onClick: handleSheetDelete,
          disabled: !props.canDelete,
        },
      ];

  const menuItems = props.menu ?? defaultMenu;
  const showMenu = !props.menu || props.menu.length > 0;

  const getIcon = (iconName?: string) => {
    switch (iconName) {
      case 'rename':
        return <RenameRegular />;
      case 'ChevronRight':
        return <ChevronRightRegular />;
      case 'ChevronLeft':
        return <ChevronLeftRegular />;
      case 'Delete':
        return <DeleteRegular />;
      case 'Cancel':
        return <DeleteRegular />;
      default:
        return undefined;
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!props.draggable) return;
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', props.index.toString());
    props.onDragStart?.(props.index);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    props.onDragEnd?.();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!props.draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    props.onDragOver?.(props.index);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!props.draggable) return;
    e.preventDefault();
    props.onDrop?.(props.index);
  };

  const dragProps = props.draggable ? {
    draggable: true,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  } : {};

  const classNames = mergeClasses(
    styles.sheetHeading,
    props.selected && styles.sheetHeadingOn,
    isDragging && styles.dragging,
    props.isDragOver && styles.dragOver,
    'sheet-heading',
    props.selected && 'sheet-heading-on'
  );

  if (props.selected) {
    return (
      <div className={classNames} {...dragProps}>
        <Text size={200}>{displayName}</Text>
        {showMenu && (
          <Menu open={menuOpen} onOpenChange={(e, data) => setMenuOpen(data.open)}>
            <MenuTrigger disableButtonEnhancement>
              <span className={styles.sheetHeadingIcon}>
                <ChevronDownRegular />
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {menuItems.map((item) =>
                  item.divider ? (
                    <MenuDivider key={item.key} />
                  ) : (
                    <MenuItem
                      key={item.key}
                      icon={getIcon(item.iconName)}
                      onClick={item.onClick}
                      disabled={item.disabled}
                    >
                      {item.text}
                    </MenuItem>
                  )
                )}
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </div>
    );
  } else {
    return (
      <div className={classNames} onClick={handleClick} {...dragProps}>
        <Text size={200}>{displayName}</Text>
      </div>
    );
  }
};

export default connect()(SheetTab);
