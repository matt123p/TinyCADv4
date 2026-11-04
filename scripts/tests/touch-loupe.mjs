import assert from 'node:assert/strict';
import React from 'react';
import { loadComponent } from './load-component.mjs';

const { TSheet } = loadComponent('src/components/svg/Sheet.tsx', {});
const sheet = new TSheet({ zoom: 100, dispatch() {} });
sheet.setState = (patch) => Object.assign(sheet.state, patch);
const events = [];
sheet.dispatchEditorPointerEvent = (...args) => events.push(args);
const rect = { left: 20, top: 30, x: 20, y: 30, width: 800, height: 600 };
sheet._div = {
  clientWidth: 800, clientHeight: 600,
  getBoundingClientRect: () => rect,
};
sheet.scroll = [120, 90];
const touch = (clientX, clientY, identifier = 1) => ({ clientX, clientY, identifier });
const event = (touches, extra = {}) => ({
  touches, changedTouches: [], cancelable: true,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});

sheet.handleToggleButtonClick();
assert.equal(sheet.state.touchActive, true);
assert.deepEqual(events.pop(), ['mousemove', 420, 330, 0]);
assert.equal(sheet.state.touchSvgX, 520);
const start = event([touch(200, 200)]);
sheet.ontouchstart(start);
assert.equal(start.defaultPrevented, true, 'native touch input suppresses compatibility mouse clicks');
sheet.ontouchmove(event([touch(300, 250)]));
assert.deepEqual(events.pop(), ['mousemove', 450, 345, 0], 'precision movement must reach the editor hover/creation logic');
sheet.ontouchmove(event([touch(10000, 10000)]));
assert.equal(sheet._virtual_client_x, 819);
assert.equal(sheet._virtual_client_y, 629);
sheet.ontouchend(event([]));

sheet.handleVirtualDragToggle();
assert.equal(sheet.state.touchDragActive, true);
sheet.handleVirtualClick();
assert.equal(sheet.state.touchDragActive, false, 'clicking during a held drag drops it');
assert.equal(events.at(-1)[0], 'lbuttonup');
sheet.handleVirtualDragToggle();
sheet.ontouchcancel(event([], { cancelable: false }));
assert.equal(sheet.state.touchDragActive, false, 'interrupted touches must release a held mouse button');
assert.equal(events.at(-1)[0], 'lbuttonup');
sheet.handleVirtualDragToggle();
sheet.ontouchstart(event([touch(200, 200), touch(300, 200, 2)]));
assert.equal(sheet.state.touchDragActive, false, 'two-finger navigation must finish the held drag');
assert.equal(sheet._touch_mode, 'gesture');
sheet.ontouchend(event([touch(300, 200, 2)]));
assert.equal(sheet.state.isFingerDown, true);
assert.equal(sheet._touch_identifier, 2);

sheet.scroll = [300, 250];
sheet.syncTouchPointer();
assert.equal(sheet.state.touchSvgX, sheet._virtual_client_x - rect.left + 300);
assert.equal(sheet.state.touchSvgY, sheet._virtual_client_y - rect.top + 250);
assert.equal(events.at(-1)[0], 'mousemove');
const mode = sheet._touch_mode;
sheet.ontouchstart(event([touch(10, 10)], { target: { closest: () => ({}) } }));
assert.equal(sheet._touch_mode, mode, 'loupe controls must not initiate canvas gestures');
sheet.handleVirtualClose();
assert.equal(sheet._touch_mode, 'none');
assert.equal(sheet.state.touchActive, false);

// Touch handlers must be removable when switching sheets or unmounting.
const listeners = new Map();
const div = {
  addEventListener(name, fn, options) { listeners.set(name, { fn, options }); },
  removeEventListener(name, fn) { if (listeners.get(name)?.fn === fn) listeners.delete(name); },
};
sheet.setTouchListeners(div, true);
assert.equal(listeners.size, 4);
assert.equal(listeners.get('touchstart').options.passive, false);
assert.equal(listeners.get('touchmove').options.passive, false);
sheet.setTouchListeners(div, false);
assert.equal(listeners.size, 0);

// Replacing the viewport (rulers on/off) must preserve the scroll origin.
sheet.scroll = [200, 150];
sheet._div = { ...div, clientWidth: 800, clientHeight: 600 };
sheet.attachResizeObserver();
assert.equal(sheet._div.scrollLeft, 200);
assert.equal(sheet._div.scrollTop, 150);
const oldViewport = sheet._div;
sheet._div = { ...div, clientWidth: 780, clientHeight: 580 };
sheet.attachResizeObserver();
assert.notEqual(sheet._div, oldViewport);
assert.equal(sheet._div.scrollLeft, 200);
assert.equal(sheet.state.scrollX, 200);
assert.equal(sheet.state.scrollY, 150);

const { TouchLoupe } = loadComponent('src/components/svg/TouchLoupe.tsx', {
  react: { ...React, useId: () => ':test:' },
  '../../i18n': { __esModule: true, default: { t: (key) => key } },
});
let clicks = 0;
const props = { touchSvgX: 400, touchSvgY: 300, scrollX: 100, scrollY: 50,
  canvasWidth: 800, canvasHeight: 600, sheetName: 'Sheet 1',
  onLeftClick: () => clicks++, onDragToggle() {}, onRightClick() {}, onClose() {} };
const tree = TouchLoupe(props);
assert.equal(tree.props.transform, TouchLoupe({ ...props, touchSvgX: 700 }).props.transform,
  'lens and buttons must stay still while aiming');
const controls = tree.props.children.at(-1);
assert.equal(controls.length, 4);
const click = controls[0];
assert.equal(click.props.role, 'button');
assert.equal(click.props.children[0].props.width, 44);
assert.equal(click.props.children[0].props.height, 48);
click.props.onTouchStart({ stopPropagation() {} });
assert.equal(clicks, 0, 'actions commit on release so a user can move off to cancel');
click.props.onTouchEnd(event([], { changedTouches: [touch(20, 20)],
  currentTarget: { getBoundingClientRect: () => ({ left: 0, right: 44, top: 0, bottom: 48 }) } }));
assert.equal(clicks, 1);
click.props.onTouchEnd(event([], { changedTouches: [touch(100, 100)],
  currentTarget: { getBoundingClientRect: () => ({ left: 0, right: 44, top: 0, bottom: 48 }) } }));
assert.equal(clicks, 1, 'sliding off a control cancels its action');
console.log('Touch loupe regression checks passed.');
