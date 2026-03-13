import React, { Dispatch } from 'react';
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components';
import {
  actionCommand,
  actionSelectBottomPanel,
  BottomPanels,
  actionPasteEvent,
  actionSelectDialog,
} from '../dispatcher/AppDispatcher';
import { connect } from 'react-redux';
import { ActionCreators } from 'redux-undo';
import { docDrawing } from '../undo/undo';
import { ContextMenuItem } from '../../manipulators/updateInterfaces';

interface ContextMenuProps {
  hidden: boolean;
  target: { x: number; y: number } | null;
  items: ContextMenuItem[];
  onDismiss: () => void;
  onItemClick: (key: string) => void;
}

const ContextMenuComponent: React.FC<ContextMenuProps> = ({
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

const mapStateToProps = (state: docDrawing) => {
  let target = null;
  if (state.altStore.contextMenu?.position) {
    target = {
      x: state.altStore.contextMenu?.position[0],
      y: state.altStore.contextMenu?.position[1],
    };
  }
  const can_undo = state.docStore.past?.length > 0;
  const can_redo = state.docStore.future?.length > 0;
  let items = state.altStore.contextMenu?.items?.map((f) => {
    switch (f.key) {
      case 'undo':
        return { ...f, disabled: !can_undo };
      case 'redo':
        return { ...f, disabled: !can_redo };
      default:
        return f;
    }
  });

  return {
    hidden: state.altStore.contextMenu?.hidden,
    target: target,
    items: items,
  };
};

const mapDispatchToProps = (dispatch: Dispatch<any>) => {
  return {
    onDismiss: () => dispatch(actionCommand(null)),
    onItemClick: (key: string) => {
      if (key === 'undo') {
        dispatch(ActionCreators.undo());
      } else if (key === 'redo') {
        dispatch(ActionCreators.redo());
      } else if (key === 'style') {
        dispatch(actionSelectBottomPanel(BottomPanels.StylePanel));
      } else if (key === 'paste') {
        navigator.permissions
          .query({ name: 'clipboard-read' } as any)
          .then((result) => {
            // If permission to read the clipboard is granted or if the user will
            // be prompted to allow it, we proceed.
            if (result.state == 'granted' || result.state == 'prompt') {
              navigator.clipboard.readText().then((text) => {
                dispatch(actionPasteEvent(text, null));
              });
            } else {
              dispatch(actionSelectDialog('clipboard_failure', null));
            }
          })
          .catch((error) => {
            dispatch(actionSelectDialog('clipboard_failure', null));
          });
      } else {
        dispatch(actionCommand(key));
      }
    },
  };
};

const ContextmenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(ContextMenuComponent);

export default ContextmenuContainer;
