import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Button,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import {
  ChevronLeftRegular,
  ChevronRightRegular,
  Dismiss12Regular,
  Pin12Filled,
  SaveCopyRegular,
} from '@fluentui/react-icons';

type Tab = { key: string; name: string; dirty: boolean; select(): void };

export default function ProjectFileTabs({
  tabs,
  selection,
  preview,
  pinned,
  disabled,
  saveAll,
  closeTabs,
  moveTab,
  keepOpen,
  togglePin,
}: {
  tabs: Tab[];
  selection?: string;
  preview?: string;
  pinned: string[];
  disabled: boolean;
  saveAll(): void;
  closeTabs(keys: string[]): void;
  moveTab(index: number, offset: -1 | 1): void;
  keepOpen(key: string): void;
  togglePin(key: string): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: false, right: false });
  const updateScroll = () => {
    const { scrollLeft, scrollWidth, clientWidth } = list.current;
    const left = scrollLeft > 1;
    const right = scrollLeft + clientWidth + 1 < scrollWidth;
    setScroll((previous) =>
      previous.left === left && previous.right === right
        ? previous
        : { left, right },
    );
  };

  useLayoutEffect(() => {
    const observer = new ResizeObserver(updateScroll);
    observer.observe(list.current);
    observer.observe(track.current);
    updateScroll();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const active = track.current.querySelector('.project-file-tab.selected');
    if (!active) return;
    const view = list.current.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < view.left) list.current.scrollLeft += tab.left - view.left;
    else if (tab.right > view.right)
      list.current.scrollLeft += tab.right - view.right;
  }, [selection, scroll.left || scroll.right]);

  function scrollTabs(direction: -1 | 1) {
    list.current.scrollBy({ left: direction * list.current.clientWidth * 0.8 });
  }

  return (
    <div className="project-file-tabs" aria-label="Open files">
      <div className="project-tab-list" ref={list} onScroll={updateScroll}>
        <div className="project-tab-track" ref={track}>
          {tabs.map(({ key, name, dirty, select }, index) => {
            const selected = key === selection;
            const appearance = selected ? 'primary' : 'subtle';
            const isPinned = pinned.includes(key);
            const unpinned = (items: Tab[]) =>
              items
                .filter((tab) => !pinned.includes(tab.key))
                .map((tab) => tab.key);
            const left = unpinned(tabs.slice(0, index));
            const right = unpinned(tabs.slice(index + 1));
            const others = [...left, ...right];
            const all = isPinned ? others : [...others, key];
            return (
              <Menu key={key} openOnContext>
                <MenuTrigger disableButtonEnhancement>
                  <div
                    className={
                      selected
                        ? 'project-file-tab selected'
                        : 'project-file-tab'
                    }
                    onKeyDown={(event) => {
                      if (
                        (event.shiftKey && event.key === 'F10') ||
                        event.key === 'ContextMenu'
                      ) {
                        event.preventDefault();
                        event.currentTarget.dispatchEvent(
                          new MouseEvent('contextmenu', {
                            bubbles: true,
                            clientX:
                              event.currentTarget.getBoundingClientRect().left,
                            clientY:
                              event.currentTarget.getBoundingClientRect()
                                .bottom,
                          }),
                        );
                      }
                    }}
                  >
                    <Button
                      size="small"
                      className={
                        key === preview
                          ? 'project-file-tab-name preview'
                          : 'project-file-tab-name'
                      }
                      appearance={appearance}
                      icon={isPinned ? <Pin12Filled /> : undefined}
                      aria-pressed={selected}
                      title={name}
                      disabled={disabled}
                      onClick={select}
                      onDoubleClick={() => keepOpen(key)}
                    >
                      {name}
                      {dirty ? ' •' : ''}
                    </Button>
                    <Button
                      size="small"
                      className="project-file-tab-close"
                      appearance={appearance}
                      icon={<Dismiss12Regular />}
                      aria-label={`Close ${name}`}
                      title={`Close ${name}`}
                      disabled={disabled}
                      onClick={() => closeTabs([key])}
                    />
                  </div>
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem
                      disabled={disabled}
                      onClick={() => closeTabs([key])}
                    >
                      Close
                    </MenuItem>
                    <MenuItem
                      disabled={disabled || !index}
                      onClick={() => moveTab(index, -1)}
                    >
                      Move Left
                    </MenuItem>
                    <MenuItem
                      disabled={disabled || index === tabs.length - 1}
                      onClick={() => moveTab(index, 1)}
                    >
                      Move Right
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      disabled={disabled || !left.length}
                      onClick={() => closeTabs(left)}
                    >
                      Close All to the Left
                    </MenuItem>
                    <MenuItem
                      disabled={disabled || !right.length}
                      onClick={() => closeTabs(right)}
                    >
                      Close All to the Right
                    </MenuItem>
                    <MenuItem
                      disabled={disabled || !others.length}
                      onClick={() => closeTabs(others)}
                    >
                      Close All but This
                    </MenuItem>
                    <MenuItem
                      disabled={disabled || !all.length}
                      onClick={() => closeTabs(all)}
                    >
                      Close All
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      disabled={disabled}
                      onClick={() => togglePin(key)}
                    >
                      {isPinned ? 'Unpin' : 'Pin'}
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            );
          })}
        </div>
      </div>
      {(scroll.left || scroll.right) && (
        <div className="project-tab-scroll">
          <Button
            size="small"
            appearance="subtle"
            icon={<ChevronLeftRegular />}
            aria-label="Scroll tabs left"
            title="Scroll tabs left"
            disabled={!scroll.left}
            onClick={() => scrollTabs(-1)}
          />
          <Button
            size="small"
            appearance="subtle"
            icon={<ChevronRightRegular />}
            aria-label="Scroll tabs right"
            title="Scroll tabs right"
            disabled={!scroll.right}
            onClick={() => scrollTabs(1)}
          />
        </div>
      )}
      <Button
        size="small"
        appearance="subtle"
        className="project-save-all"
        icon={<SaveCopyRegular />}
        title="Save All"
        disabled={disabled}
        onClick={saveAll}
      >
        Save All
      </Button>
    </div>
  );
}
