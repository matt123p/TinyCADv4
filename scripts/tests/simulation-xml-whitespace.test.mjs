import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XMLFeatures from 'common-xml-features';
import { loadComponent } from './load-component.mjs';

const { XMLBuilder } = loadComponent('src/util/xmlbuilder.ts', {
  'common-xml-features': XMLFeatures,
});

test('XML attributes preserve SPICE line breaks, tabs and CRLF across save and reopen', () => {
  const value = 'R_A 1 0 1meg\r\nR_B 2 0 1meg\n* a\tb > "quoted" & value';
  const saved = new XMLBuilder();
  saved.createDoc('doc');
  saved.appendChild('FIELD', null, { value });
  const xml = saved.tostring();
  assert.match(xml, /&#13;&#10;/);
  assert.match(xml, /&#9;/);
  const reopened = new XMLBuilder();
  reopened.fromText(xml);
  assert.equal(reopened.getElementsByTagName('FIELD')[0].getAttribute('value'), value);
  reopened.fromText('<doc><FIELD value="R_A 1 0 1meg\nR_B 2 0 1meg"/></doc>');
  assert.equal(reopened.getElementsByTagName('FIELD')[0].getAttribute('value'), 'R_A 1 0 1meg\nR_B 2 0 1meg');
});

test('attribute whitespace handling leaves comments, CDATA and ordinary text alone', () => {
  const literal = 'value="first\nsecond"';
  const builder = new XMLBuilder();
  builder.fromText(`<doc><!--${literal}--><code><![CDATA[<FIELD ${literal}/>]]></code><text>${literal}</text></doc>`);
  assert.equal(builder.getElementsByTagName('code')[0].textContent, `<FIELD ${literal}/>`);
  assert.equal(builder.getElementsByTagName('text')[0].textContent, literal);
  const serialized = builder.tostring();
  assert.ok(serialized.includes(`<!--${literal}-->`));
  assert.ok(serialized.includes(`<![CDATA[<FIELD ${literal}/>]]>`));
});
