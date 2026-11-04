import assert from 'node:assert/strict';
import React from 'react';
import { loadComponent } from './load-component.mjs';

const sent = [];
const dispatched = [];
const previousWindow = globalThis.window;
globalThis.window = { electronAPI: { sendAppClosingResponse: (value) => sent.push(value) } };
let saving = false;
const { UnsavedChangesDialog } = loadComponent('src/components/dialogues/unsavedChangesDlg.tsx', {
  react: { ...React, useEffect() {}, useState: (value) => [value, () => {}] },
  'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
  'react-redux': {
    useDispatch: () => (action) => dispatched.push(action),
    useSelector: (selector) => selector({
      docStore: { present: { drawingVersion: 1, editLibrary: null } },
      altStore: { savedVersion: 0, saveInProgress: saving },
    }),
  },
  '../../state/dispatcher/AppDispatcher': { actionCancelDialog: () => ({ type: 'cancel-dialog' }) },
});
function children(tree) {
  return [tree, ...React.Children.toArray(tree?.props?.children).flatMap(children)];
}
try {
  for (const type of ['app-close', 'file-new', 'file-open']) {
    const tree = UnsavedChangesDialog({ pendingAction: { type } });
    const cancel = children(tree).find((node) => node.props?.children === 'common.cancel');
    const before = sent.length;
    cancel.props.onClick();
    assert.equal(sent.length - before, type === 'app-close' ? 1 : 0);
    if (type === 'app-close') assert.equal(sent.at(-1), false);
    const beforeDismiss = sent.length;
    tree.props.onOpenChange({}, { open: false });
    assert.equal(sent.length - beforeDismiss, type === 'app-close' ? 1 : 0);
    const beforeOpen = dispatched.length;
    tree.props.onOpenChange({}, { open: true });
    assert.equal(dispatched.length, beforeOpen, 'opening must not cancel the dialog');
  }
  saving = true;
  const tree = UnsavedChangesDialog({ pendingAction: { type: 'app-close' } });
  const before = sent.length;
  tree.props.onOpenChange({}, { open: false });
  assert.equal(sent.length, before, 'dismissal during save must not cancel the pending close');
  console.log('Issue #14 regression checks passed.');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}
