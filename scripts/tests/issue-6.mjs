import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';

const commands = [];
const { TSheet } = loadComponent('src/components/svg/Sheet.tsx', {
  '../../state/dispatcher/AppDispatcher': {
    actionCommand: (command, factor) => ({ command, factor }),
    actionUnregisterTSheet: () => ({ command: 'unregister' }),
  },
});
function viewport() {
  const listeners = new Map();
  return { clientWidth: 800, clientHeight: 600, listeners,
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    removeEventListener(type, handler) {
      if (listeners.get(type)?.handler === handler) listeners.delete(type);
    } };
}
const sheet = new TSheet({ zoom: 100, dispatch: (action) => commands.push(action) });
sheet.setState = () => {};
sheet.setPendingZoomAnchor = () => {};
const first = viewport();
sheet._div = first;
sheet.attachResizeObserver();
assert.equal(first.listeners.get('wheel')?.options.passive, false,
  'canvas zoom must use a non-passive native wheel listener to prevent browser zoom');
const handler = first.listeners.get('wheel').handler;
function wheel(overrides = {}) {
  return { ctrlKey: true, shiftKey: false, deltaY: -10, clientX: 20, clientY: 30,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {}, ...overrides };
}
for (const deltaY of [-10000, -10, -1, 0, 1, 10, 10000]) {
  const event = wheel({ deltaY });
  handler(event);
  assert.equal(event.defaultPrevented, true);
  const { command, factor } = commands.at(-1);
  assert.equal(command, 'zoom_scale');
  assert.ok(factor >= 0.8 && factor <= 1.25);
}
const scroll = wheel({ ctrlKey: false });
const before = commands.length;
handler(scroll);
assert.equal(commands.length, before);
assert.equal(scroll.defaultPrevented, false, 'ordinary touchpad scrolling must stay native');
const shift = wheel({ ctrlKey: false, shiftKey: true });
handler(shift);
assert.equal(commands.at(-1).command, 'zoom_in');
assert.equal(shift.defaultPrevented, true);
const second = viewport();
sheet._div = second;
sheet.attachResizeObserver();
assert.equal(first.listeners.has('wheel'), false);
assert.equal(second.listeners.get('wheel').handler, handler);
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = { removeEventListener() {} };
globalThis.document = { removeEventListener() {} };
try {
  sheet.componentWillUnmount();
  assert.equal(second.listeners.has('wheel'), false);
  console.log('Issue #6 regression checks passed.');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
