import assert from 'node:assert/strict';
import React from 'react';
import { loadComponent } from './load-component.mjs';

const { TSheet } = loadComponent('src/components/svg/Sheet.tsx', {
  '../../util/utilityService': {
    UtilityService: { singleSelectedItem: () => null },
  },
});

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

for (const showRulers of [false, true]) {
  const sheet = new TSheet({
    sheet_name: 'Sheet 1', zoom: 150, showRulers,
    page_size: [1000, 800], details: { grid: 10 },
    items: [], _selected_array: [], options: {}, dispatch() {},
  });

  // Re-render the same sheet after changing the setting and resetting it.
  for (const colour of ['#ffffff', '#202830', '#ffffff']) {
    sheet.props = { ...sheet.props, options: { color_background: colour, show_grid: true } };
    const elements = descendants(sheet.render());
    const pages = elements.filter(element => element.props.className === 'pageRectangle');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].props.style.fill, colour,
      `page must use the selected colour with rulers ${showRulers ? 'on' : 'off'}`);
    assert.equal(pages[0].props.width, 1500);
    assert.equal(pages[0].props.height, 1200);
    const content = elements.find(element => element.props.id === 'sheet-content-Sheet-1');
    assert.ok(descendants(content).some(element => element.props.className === 'pageRectangle'
      && element.props.style.fill === colour), 'the touch loupe must clone the coloured page');
    const margins = elements.filter(element => element.props.className === 'offPageArea');
    assert.equal(margins.length, 4);
    assert.ok(margins.every(element => !element.props.style?.fill && !element.props.fill),
      'off-page margins must retain their separate colour');
    assert.ok(elements.some(element => element.props.fill === 'url(#grid-pattern)'),
      'the grid must remain above the page fill');
  }
}

console.log('Issue #33 regression checks passed.');
