import assert from 'node:assert/strict';
import React from 'react';
import { loadComponent } from './load-component.mjs';

const { DesignApp } = loadComponent('src/components/pages/designApp.tsx', {
  react: {
    ...React,
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect() {},
    useCallback: (callback) => callback,
  },
  '@fluentui/react-components': { makeStyles: () => () => ({}), Button: 'button' },
  'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
});
let cancellations = 0;
const props = { selected_sheet: 0, browserSheets: [], editSymbol: null,
  creating: true, dialogOpen: false, cancelCreation: () => cancellations++ };
function event(overrides = {}) {
  return { key: 'Escape', defaultPrevented: false,
    target: { closest: () => null },
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...overrides };
}
const tree = DesignApp(props);
assert.equal(typeof tree.props.onKeyDown, 'function', 'Escape must reach the app from toolbar buttons');
const escape = event();
tree.props.onKeyDown(escape);
assert.equal(cancellations, 1);
assert.equal(escape.defaultPrevented, true);
for (const ignored of [event({ key: 'Enter' }), event({ defaultPrevented: true }),
  event({ target: { closest: () => ({}) } })]) {
  tree.props.onKeyDown(ignored);
}
for (const state of [{ creating: false }, { dialogOpen: true }]) {
  DesignApp({ ...props, ...state }).props.onKeyDown(event());
}
assert.equal(cancellations, 1, 'text editors, dialogs and already-handled canvas keys retain their Escape behavior');
console.log('Issue #5 regression checks passed.');
