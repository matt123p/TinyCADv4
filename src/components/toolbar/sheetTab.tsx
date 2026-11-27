import React, { Dispatch, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
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
  CopyRegular,
} from '@fluentui/react-icons';
import {
  actionSheetSelect,
  actionSelectDialog,
  actionSheetRight,
  actionSheetLeft,
  actionSheetMove,
} from '../../state/dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { SheetTabLabel } from './sheetTabStrip';

const useStyles = makeStyles({
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
  additionalMenuItems?: MenuItemData[];
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

  const menuItems = props.menu ?? [...(props.additionalMenuItems || []), ...defaultMenu];
  const showMenu = !props.menu || props.menu.length > 0;

  const getIcon = (iconName?: string) => {
    switch (iconName) {
      case 'Copy':
        return <CopyRegular />;
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
    isDragging && styles.dragging,
    props.isDragOver && styles.dragOver,
  );

  if (props.selected) {
    return (
      <SheetTabLabel
        className={classNames}
        label={displayName}
        selected
        {...dragProps}
      >
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
      </SheetTabLabel>
    );
  } else {
    return (
      <SheetTabLabel
        className={classNames}
        label={displayName}
        selected={false}
        onClick={handleClick}
        {...dragProps}
      />
    );
  }
};

export default connect()(SheetTab);
