import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadComponent } from './load-component.mjs';

function resizeHandle(direction) {
  const refs = [];
  let index = 0;
  const effects = [];
  const deltas = [], changes = [], captured = new Set();
  const { ResizeHandle } = loadComponent('src/components/panel/ResizeHandle.tsx', {
    react: {
      ...React,
      useRef: value => refs[index++] ||= { current: value },
      useEffect: effect => effects.push(effect),
    },
    '@fluentui/react-components': { makeStyles: () => () => ({}) },
  });
  const props = { direction, onResize: delta => deltas.push(delta), onDragStateChange: value => changes.push(value) };
  const render = () => { index = 0; return ResizeHandle(props).props; };
  const target = {
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
  };
  const event = (position, pointerId = 1, button = 0) => ({
    pointerId, button, clientX: position, clientY: position,
    currentTarget: target, preventDefault() {}, stopPropagation() {},
  });
  return { render, event, props, deltas, changes, captured, effects };
}

for (const direction of ['horizontal', 'vertical']) {
  test(`${direction} panel drag tracks rapid moves before and after a render`, () => {
    const h = resizeHandle(direction);
    let handlers = h.render();
    handlers.onPointerDown(h.event(200));
    assert.ok(h.captured.has(1), 'capture keeps the drag away from instrument controls');
    for (let position = 199; position >= 140; --position)
      handlers.onPointerMove(h.event(position));
    assert.equal(h.deltas.length, 60);
    assert.ok(h.deltas.every(delta => delta === -1));
    handlers.onPointerMove(h.event(140));
    handlers.onPointerMove(h.event(100, 2));
    assert.equal(h.deltas.length, 60, 'ignore stationary events and other pointers');
    const updated = [];
    h.props.onResize = delta => updated.push(delta);
    handlers = h.render();
    handlers.onPointerMove(h.event(130));
    assert.deepEqual(updated, [-10], 'continue with the latest callback after a parent render');
    handlers.onPointerUp(h.event(130));
    handlers.onLostPointerCapture(h.event(130));
    handlers.onPointerMove(h.event(100));
    assert.deepEqual(updated, [-10]);
    assert.deepEqual(h.changes, [true, false]);
    assert.equal(h.captured.size, 0);
  });
}

test('panel drag ends on cancellation, lost capture and unmount', () => {
  for (const end of ['onPointerCancel', 'onLostPointerCapture', 'unmount']) {
    const h = resizeHandle('vertical');
    const handlers = h.render();
    const cleanup = h.effects[0]();
    handlers.onPointerDown(h.event(20, 1, 2));
    assert.equal(h.captured.size, 0, 'secondary mouse buttons do not start a drag');
    handlers.onPointerDown(h.event(20));
    if (end === 'unmount') cleanup();
    else {
      handlers[end](h.event(20));
      handlers.onPointerMove(h.event(10));
      assert.deepEqual(h.deltas, []);
    }
    assert.deepEqual(h.changes, [true, false], end);
  }
});

test('panel drag applies the release position when the last move was coalesced', () => {
  const h = resizeHandle('vertical');
  const handlers = h.render();
  handlers.onPointerDown(h.event(200));
  handlers.onPointerMove(h.event(190));
  handlers.onPointerUp(h.event(180));
  assert.deepEqual(h.deltas, [-10, -10]);
  assert.deepEqual(h.changes, [true, false]);
});
