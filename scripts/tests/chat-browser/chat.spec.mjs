import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { serveLayoutApp } from '../layout-browser/serve-app.mjs';
import PDFDocument from 'pdfkit';
import { createServer } from 'node:http';
import { installElectronBridge } from './electron-bridge.mjs';
let app;
const circuit =
  '<TinyCADSheets><TinyCAD><NAME>Main</NAME><WIRE a="10,10" b="30,10"/></TinyCAD><TinyCAD><NAME>Preserve me</NAME><WIRE a="50,50" b="70,50"/></TinyCAD></TinyCADSheets>';
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('chat-browser', 'electron', 'development');
});
test.afterAll(async () => {
  await app?.close();
});
test.beforeEach(async ({ page }) => {
  page.chatErrors = [];
  page.on('pageerror', (e) => page.chatErrors.push(e.message));
  await installElectronBridge(page);
  await page.goto(app.baseURL);
  await expect(
    page.getByRole('button', { name: 'Chat', exact: true }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(page.chatErrors).toEqual([]);
});
async function chooseProvider(page, provider, { account = false } = {}) {
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  if (!(await dialog.isVisible()))
    await page
      .getByRole('button', { name: 'AI settings', exact: true })
      .click();
  await expect(dialog).toBeVisible();
  while (!(await dialog.getByLabel('Provider', { exact: true }).isVisible()))
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog.getByLabel('Provider', { exact: true }).selectOption(provider);
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  if (provider === 'openai' && !account)
    await dialog
      .getByRole('radio', { name: 'Use API Key', exact: true })
      .check();
}
async function connectApiKey(page) {
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();

  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function setThinking(page, level) {
  const slider = page.getByRole('slider', {
    name: 'Thinking level',
    exact: true,
  });
  await slider.press('Home');
  const steps = {
    Minimal: 0,
    Low: 1,
    Medium: 2,
    High: 3,
    'Very high': 4,
    Max: Number(await slider.getAttribute('max')),
  }[level];
  for (let index = 0; index < steps; index++) await slider.press('ArrowRight');
}
async function selectModel(page, model, thinking) {
  await page
    .getByRole('button', {
      name: 'Select model and thinking level',
      exact: true,
    })
    .click();
  await page.getByRole('radio', { name: model, exact: true }).check();
  if (thinking) await setThinking(page, thinking);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}
const run = (page, name, args = {}) =>
  page.evaluate(({ name, args }) => window.chatTest.execute(name, args), {
    name,
    args,
  });
const snapshot = (page) => page.evaluate(() => window.chatTest.snapshot());

test('attachments show files immediately and invalid selections keep existing files', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-6.1-sol' }] } }),
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const upload = page.getByLabel('Attach PDF or image', { exact: true });
  await expect(upload).toBeDisabled();
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('private-test-key');
  await connectApiKey(page);
  await selectModel(page, 'GPT-6.1 Sol');
  await upload.setInputFiles({
    name: 'datasheet.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.locator('.chat-attachment-status')).toBeEmpty();
  await expect(page.locator('.chat-attachment')).toContainText(
    'datasheet.pdf (1 KiB)',
  );
  await upload.setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.locator('.chat-error')).toContainText(
    'Attach up to six files, totaling at most 10 MiB.',
  );
  await expect(page.locator('.chat-attachment')).toHaveCount(1);
  await upload.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('unsupported'),
  });
  await expect(page.locator('.chat-error')).toContainText(
    'notes.txt: Supported imports: PDF, PNG, JPEG and WebP.',
  );
  await upload.setInputFiles({
    name: 'circuit.png',
    mimeType: 'image/png',
    buffer: Buffer.from('image'),
  });
  await expect(page.locator('.chat-error')).toHaveCount(0);
  await expect(page.locator('.chat-attachment')).toHaveCount(2);
  await expect(page.locator('.chat-attachment-status')).toBeEmpty();
  await page
    .getByRole('button', { name: 'Remove datasheet.pdf', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove circuit.png', exact: true })
    .click();
  await expect(page.locator('.chat-attachment-status')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
});

test('Online library panel searches through the desktop bridge and displays a preview', async ({ page }) => {
  await page.route('https://www.tinycad.net/api/search/Search?*', route => {
    expect(new URL(route.request().url()).searchParams.get('key')).toBe('123');
    return route.fulfill({ json: {
      total: 1, pageSize: 25, symbols: [{ symbolID: 1951, nameID: 11150,
        name: 'SIEMENS', description: 'S7-1200 SM1231 Analog Inputs Module', labels: [] }],
    } });
  });
  await page.route('**/api/Search/Thumbnail?*', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64'),
  }));
  await page.getByRole('tab', { name: 'Online', exact: true }).click();
  await page.getByPlaceholder(/Search TinyCAD.net/i).fill('123');
  await page.getByText('SIEMENS', { exact: true }).click();
  await expect(page.getByRole('button', { name: /^SIEMENS S7-1200/ }).locator('img')).toHaveCount(0);
  const preview = page.locator('img[src*="/api/Search/Thumbnail"]');
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveAttribute('crossorigin');
  await expect.poll(() => preview.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByText(/Problem talking to server/)).toHaveCount(0);
});

test('real worker reads unsaved native state, renders vision images, adds and edits with Undo/Redo', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  const before = await snapshot(page);
  const read = (await run(page, 'read_drawing')).data;
  expect(read.metadata).toHaveLength(2);
  expect(read.definition).toContain('Preserve me');
  const added = await run(page, 'add_to_drawing', {
    baseRevision: read.revision,
    sheet: 1,
    fragment: '<WIRE a="30,10" b="50,10"/>',
  });
  expect(added.data.applied).toBe(true);
  expect((await snapshot(page)).xml).toContain('Preserve me');
  const after = await snapshot(page);
  expect(after.past).toBeGreaterThan(before.past);
  expect(before.file.name).toBe('Circuit.dsn');
  expect(after.file).toEqual(before.file);
  await page.evaluate(() => window.chatTest.undo());
  expect((await snapshot(page)).xml).toBe(before.xml);
  await page.evaluate(() => window.chatTest.redo());
  expect((await snapshot(page)).xml).toBe(after.xml);
  const stale = await run(page, 'read_drawing');
  await expect(
    run(page, 'edit_drawing', {
      baseRevision: read.revision,
      edits: [{ find: '<NAME>Main</NAME>', replace: '<NAME>Wrong</NAME>' }],
    }),
  ).rejects.toThrow(/changed/);
  const edited = await run(page, 'edit_drawing', {
    baseRevision: stale.data.revision,
    edits: [{ find: '<NAME>Main</NAME>', replace: '<NAME>Updated</NAME>' }],
  });
  expect(edited.data.applied).toBe(true);
  expect((await snapshot(page)).xml).toContain('Updated');
  const preview = await run(page, 'render_drawing', {
    format: 'both',
    pixels: 128,
  });
  expect(preview.data.svg).toContain('<svg');
  expect(preview.images[0].mime).toBe('image/png');
  expect(preview.images[0].data.length).toBeGreaterThan(100);
  expect((await run(page, 'read_netlist')).data.nets.length).toBeGreaterThan(0);
});

test('the chat UI runs a provider tool loop, applies edits, and keeps keys out of storage', async ({
  page,
}) => {
  let count = 0;
  await page.route(
    'https://api.openai.com/v1/chat/completions',
    async (route) => {
      const request = route.request().postDataJSON();
      if (request.messages.some((m) => m.role === 'tool')) {
        const last = request.messages.filter((m) => m.role === 'tool').at(-1);
        const data = JSON.parse(last.content);
        if (data.revision && !data.applied) {
          await route.fulfill({
            json: {
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: 'edit',
                        type: 'function',
                        function: {
                          name: 'add_to_drawing',
                          arguments: JSON.stringify({
                            baseRevision: data.revision,
                            sheet: 1,
                            fragment: '<WIRE a="10,10" b="20,10"/>',
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: 'Added an editable wire.',
                },
              },
            ],
          },
        });
        return;
      }
      count++;
      expect(
        request.tools.some((t) => t.function.name === 'read_netlist'),
      ).toBe(true);
      expect(request.messages[0].content).toContain(
        'Keep component symbols compact',
      );
      await route.fulfill({
        json: {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'read',
                    type: 'function',
                    function: { name: 'read_drawing', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        },
      });
    },
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-6.1-sol' }] } }),
  );
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0);
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('private-test-key');
  await connectApiKey(page);
  await selectModel(page, 'GPT-6.1 Sol');
  await page.getByLabel('Message', { exact: true }).fill('Add a wire');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Added an editable wire.', { exact: true }),
  ).toBeVisible();
  expect(count).toBe(1);
  expect((await snapshot(page)).xml).toContain('<WIRE');
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(storage).not.toContain('private-test-key');
  expect(storage).not.toContain('Add a wire');
  await page.screenshot({ path: test.info().outputPath('chat-ui.png') });
});

test('native component and SQLite library export create real usable download bytes', async ({
  page,
}) => {
  const created = await run(page, 'create_ic_symbol', {
    name: 'Chat IC',
    includeDefinition: true,
    pins: [
      { name: 'IN', number: '1', side: 'west', order: 1 },
      { name: 'OUT', number: '2', side: 'east', order: 1 },
    ],
    format: 'svg',
  });
  expect(created.data.definition).toContain('Chat IC');
  const exported = await run(page, 'export_file', {
    kind: 'library',
    filename: 'chat-part',
    definition: created.data.definition,
    name: 'Chat IC',
    reference: 'U?',
  });
  expect(exported.data.exported).toBe(true);
  const files = await page.evaluate(() => window.chatTest.downloads());
  expect(
    files.some((f) => f.name === 'chat-part.TCLib' && f.bytes > 1000),
  ).toBe(true);
});

test('PDF imports preserve native PDF for native providers and rasterize selected pages locally for compatible providers', async ({
  page,
}) => {
  const doc = new PDFDocument({ size: 'A5' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  doc.text('Circuit reference: R1 10k');
  doc.addPage().text('Page 2: U1 physical pins');
  doc.end();
  const bytes = Array.from(await done);
  const native = await page.evaluate(
    (bytes) => window.chatTest.importPdf(bytes, 'anthropic', ''),
    bytes,
  );
  expect(native).toHaveLength(1);
  expect(native[0].mime).toBe('application/pdf');
  const images = await page.evaluate(
    (bytes) => window.chatTest.importPdf(bytes, 'compatible', '2'),
    bytes,
  );
  expect(images).toHaveLength(1);
  expect(images[0].mime).toBe('image/png');
  expect(images[0].name).toContain('page 2');
  expect(images[0].data.length).toBeGreaterThan(1000);
});

test('a user edit during native validation wins over the pending AI write', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  const error = await page.evaluate(() => window.chatTest.raceEdit());
  expect(error).toContain('changed during validation');
  expect((await snapshot(page)).xml).toContain('User edit');
  expect((await snapshot(page)).xml).not.toContain('AI edit');
  const before = await snapshot(page);
  const read = (await run(page, 'read_drawing')).data;
  const invalid = await run(page, 'set_drawing', {
    baseRevision: read.revision,
    definition: '<TinyCAD><IMAGE/></TinyCAD>',
  });
  expect(invalid.error).toBe(true);
  expect((await snapshot(page)).xml).toBe(before.xml);
});

test('public-library REST search pagination and fetched source artwork are used by direct tools', async ({
  page,
}) => {
  const rows = Array.from({ length: 35 }, (_, i) => ({
    symbolID: i + 1,
    nameID: i + 101,
    name: `Part ${i + 1}`,
    description: 'Public source',
    downloads: 100 - i,
  }));
  await page.route('**/api/search/search?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe('https://www.tinycad.net');
    const params = url.searchParams;
    expect(params.get('orderBy')).toBe('d');
    const index = Number(params.get('page')) - 1;
    await route.fulfill({
      json: {
        symbols: rows.slice(index * 25, index * 25 + 25),
        total: 35,
        pageSize: 25,
      },
    });
  });
  const artwork =
    '<RECTANGLE a="0,0" b="12,8" style="1" fill="0"/><PIN pos="-4,4" which="0" elec="4" direction="3" part="0" number="1" show="3" length="20" number_pos="0" centre_name="0">IN</PIN>';
  const clipboard = `<TinyCAD><NAME></NAME><STYLE id="1"><STYLE>0</STYLE><COLOR>000000</COLOR><THICKNESS>1</THICKNESS></STYLE><SYMBOLDEF id="1"><NAME type="0">Part 21</NAME><REF type="0">U?</REF><DESCRIPTION>Public source</DESCRIPTION><PPP>1</PPP><TinyCAD>${artwork}</TinyCAD></SYMBOLDEF><SYMBOL id="1" pos="0,0"><FIELD description="Package" value="Verified source"/></SYMBOL></TinyCAD>`;
  await page.route('**/api/search/copy?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe('https://www.tinycad.net');
    const params = url.searchParams;
    expect(params.get('id')).toBe('21');
    expect(params.get('name')).toBe('Part 21');
    await route.fulfill({ contentType: 'application/xml', body: clipboard });
  });
  const search = await run(page, 'search_symbols', {
    query: 'part',
    page: 3,
    pageSize: 10,
  });
  expect(search.data.symbols.map((s) => s.symbolId)).toEqual([
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  ]);
  expect(search.data.hasMore).toBe(true);
  const fetched = await run(page, 'get_symbol', {
    symbolId: 21,
    nameId: 121,
    includeDefinition: true,
    pixels: 128,
  });
  expect(fetched.data.definition).toContain('number="1"');
  expect(fetched.data.definition).toContain('a="0,0" b="12,8"');
  expect(fetched.data.validation.valid).toBe(true);
  expect(fetched.images[0].mime).toBe('image/png');
  const revision = (await run(page, 'read_metadata')).data.revision;
  const placed = await run(page, 'place_component', {
    componentId: search.data.symbols[0].componentId,
    baseRevision: revision,
  });
  expect(placed.data.applied).toBe(true);
  expect(placed.data.pins[0].number).toBe('1');
  expect((await snapshot(page)).xml).toContain('Verified source');
  expect(fetched.data.attributes).toContainEqual({
    name: 'Package',
    value: 'Verified source',
  });
});

test('chat renders Markdown safely and sends the selected model and thinking effort', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({
      json: {
        data: [
          { id: 'gpt-6.1-sol' },
          { id: 'gpt-6-luna' },
          { id: 'gpt-6-astra' },
          { id: 'gpt-4o' },
          { id: 'gpt-6.1-terra' },
        ],
      },
    }),
  );
  await page.route(
    'https://api.openai.com/v1/chat/completions',
    async (route) => {
      const request = route.request().postDataJSON();
      expect(request.model).toBe('gpt-6.1-sol');
      expect(request.reasoning_effort).toBe('high');
      await route.fulfill({
        json: {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content:
                  '# Build result\n\n**Ready** and *editable*.\n\n- First item\n- Second item\n\n```xml\n<PIN number="1"/>\n```\n\n| Part | Value |\n| --- | --- |\n| R1 | 10k |\n\n[Datasheet](https://example.com/data) [unsafe](javascript:alert(1))\n\n<img src="https://example.com/tracker" onerror="window.markdownExecuted=true">\n\n![Reference](https://example.com/image.png)',
              },
            },
          ],
        },
      });
    },
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('test-private-key');
  await connectApiKey(page);
  await selectModel(page, 'GPT-6.1 Sol', 'High');
  await expect(
    page.getByLabel('Maximum output tokens', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.chat-connection')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('Explain the circuit');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const markdown = page.locator('.chat-markdown');
  await expect(
    markdown.getByRole('heading', { name: 'Build result' }),
  ).toBeVisible();
  await expect(markdown.locator('strong')).toHaveText('Ready');
  await expect(markdown.locator('li')).toHaveCount(2);
  await expect(markdown.locator('pre code')).toHaveText('<PIN number="1"/>');
  await expect(markdown.locator('table tbody td')).toHaveText(['R1', '10k']);
  await expect(
    markdown.getByRole('link', { name: 'Datasheet' }),
  ).toHaveAttribute('href', 'https://example.com/data');
  await expect(markdown.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(markdown.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined();
  await page
    .locator('#tinycad-chat')
    .getByRole('button', { name: 'AI settings', exact: true })
    .click();
  await expect(
    page.getByRole('slider', { name: 'Thinking level', exact: true }),
  ).toHaveAttribute('aria-valuetext', 'High');
  await page
    .getByRole('button', { name: 'Close AI settings', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Select model and thinking level',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('slider', { name: 'Thinking level', exact: true }),
  ).toHaveAttribute('aria-valuetext', 'High');
  await expect(
    page.locator('.chat-connection select[aria-label="Model"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
});

test('create then insert a symbol preserves the current circuit and supports wiring, editing and Undo', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  const before = await snapshot(page);
  const read = (await run(page, 'read_drawing')).data;
  const created = await run(page, 'create_ic_symbol', {
    name: 'Custom amplifier',
    pins: [
      { name: 'IN', number: '1', side: 'west', order: 1 },
      { name: 'OUT', number: '2', side: 'east', order: 1 },
    ],
    format: 'svg',
  });
  expect(created.data.definition).toBeUndefined();
  const inserted = await run(page, 'place_component', {
    baseRevision: read.revision,
    sheet: 1,
    componentId: created.data.componentId,
    name: 'Custom amplifier',
    reference: 'U1',
    x: 50,
    y: 40,
  });
  expect(inserted.data.applied).toBe(true);
  expect(inserted.data.pins.map((p) => p.number).sort()).toEqual(['1', '2']);
  const placed = await snapshot(page);
  expect(placed.xml).toContain('value="U1"');
  expect(placed.xml).toContain('Preserve me');
  expect(placed.xml).toContain('a="10,10" b="30,10"');
  expect(placed.file).toEqual(before.file);
  await page.evaluate(() => window.chatTest.undo());
  expect((await snapshot(page)).xml).toBe(before.xml);
  await page.evaluate(() => window.chatTest.redo());
  expect((await snapshot(page)).xml).toBe(placed.xml);
  const after = (await run(page, 'read_drawing')).data;
  const pin = inserted.data.pins.find((p) => p.number === '1');
  const wired = await run(page, 'add_to_drawing', {
    baseRevision: after.revision,
    sheet: 1,
    fragment: `<WIRE a="${pin.x - 10},${pin.y}" b="${pin.x},${pin.y}"/>`,
  });
  expect(wired.data.applied).toBe(true);
  const edited = await run(page, 'edit_drawing', {
    baseRevision: wired.data.revision,
    edits: [
      { find: '<NAME>Main</NAME>', replace: '<NAME>Updated circuit</NAME>' },
    ],
  });
  expect(edited.data.applied).toBe(true);
  const netlist = await run(page, 'read_netlist');
  expect(
    netlist.data.nets.some((net) =>
      net.nodes.some((node) => node.reference === 'U1' && node.pin === '1'),
    ),
  ).toBe(true);
  const validation = await run(page, 'validate_drawing');
  expect(validation.data.structurallyValid).toBe(true);
  expect((await snapshot(page)).xml).toContain('Preserve me');
});

test('reasoning, tool calls and viewed images stay inside one collapsed activity row', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-6.1-sol' }] } }),
  );
  let requests = 0,
    viewedImage;
  let finishLast;
  const finish = new Promise((resolve) => {
    finishLast = resolve;
  });
  await page.route(
    'https://api.openai.com/v1/chat/completions',
    async (route) => {
      requests++;
      const body = route.request().postDataJSON();
      if (requests === 1) {
        await route.fulfill({
          json: {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  reasoning_content: 'Checking circuitry supplied by the user.',
                  content: 'I will inspect the document and its image.',
                  tool_calls: [
                    {
                      id: 'read-activity',
                      type: 'function',
                      function: { name: 'read_drawing', arguments: '{}' },
                    },
                    {
                      id: 'render-activity',
                      type: 'function',
                      function: {
                        name: 'render_drawing',
                        arguments: '{"format":"both","pixels":128}',
                      },
                    },
                  ],
                },
              },
            ],
          },
        });
        return;
      }
      if (requests === 2) {
        viewedImage = body.messages
          .flatMap((message) =>
            Array.isArray(message.content) ? message.content : [],
          )
          .find((part) => part.type === 'image_url')?.image_url.url;
        expect(viewedImage).toMatch(/^data:image\/png;base64,/);
        const render = body.messages.find(
          (message) =>
            message.role === 'tool' &&
            message.tool_call_id === 'render-activity',
        );
        expect(JSON.parse(render.content).svg).toBeUndefined();
        await route.fulfill({
          json: {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  reasoning_content:
                    'The preview is available; checking the metadata.',
                  tool_calls: [
                    {
                      id: 'metadata-activity',
                      type: 'function',
                      function: { name: 'read_metadata', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          },
        });
        return;
      }
      await finish;
      await route.fulfill({
        json: {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'I reviewed your circuit.',
              },
            },
          ],
        },
      });
    },
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('private-key');
  await connectApiKey(page);
  await selectModel(page, 'GPT-6.1 Sol');
  await page.getByLabel('Message', { exact: true }).fill('Inspect my circuit');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => requests).toBe(3);
  const activity = page.locator('.chat-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).not.toHaveAttribute('open');
  await expect(activity.locator(':scope > summary')).toContainText(
    '3 tool calls',
  );
  await expect(activity.locator(':scope > summary')).toContainText(
    'Model viewed an image',
  );
  await expect(page.locator('.chat-transcript img')).toHaveCount(0);
  await expect(page.locator('.chat-tool pre')).toHaveCount(0);
  await expect(
    page.getByText('I will inspect the document and its image.', {
      exact: true,
    }),
  ).toHaveCount(0);
  await activity.locator(':scope > summary').click();
  await expect(activity.locator('.chat-tool')).toHaveCount(3);
  await expect(activity.locator('.chat-tool pre')).toHaveCount(0);
  const thinking = activity.locator('.chat-reasoning').first();
  await expect(thinking).not.toHaveAttribute('open');
  await thinking.locator('summary').click();
  await expect(thinking).toContainText(
    'Checking circuitry supplied by the user.',
  );
  const tool = activity.locator('.chat-tool').first();
  await tool.locator('summary').click();
  await expect(tool.locator('pre')).toHaveCount(2);
  const viewer = activity.locator('.chat-viewed-image');
  await expect(viewer).toHaveCount(1);
  await expect(viewer.locator('img')).toHaveCount(0);
  await viewer.locator('summary').click();
  await expect(viewer.locator('img')).toBeVisible();
  await expect(viewer.locator('img')).toHaveAttribute('src', viewedImage);
  await viewer.locator('summary').click();
  await expect(viewer.locator('img')).toHaveCount(0);
  finishLast();
  await expect(
    page.getByText('I reviewed your circuit.', { exact: true }),
  ).toBeVisible();
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('open', '');
  await activity.locator(':scope > summary').click();
  await expect(page.locator('.chat-transcript img')).toHaveCount(0);
  await expect(page.locator('.chat-tool')).toHaveCount(0);
  await expect(page.locator('.chat-files')).toHaveCount(0);
  await expect(page.locator('.chat-message')).toHaveCount(2);
  await page.screenshot({
    path: test.info().outputPath('compact-activity.png'),
  });
});

test('simple requests start with the full model allowance without a retry', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-6.1-sol' }] } }),
  );
  const budgets = [];
  await page.route(
    'https://api.openai.com/v1/chat/completions',
    async (route) => {
      budgets.push(route.request().postDataJSON().max_completion_tokens);
      await route.fulfill({
        json: {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'Recovered without changing your drawing.',
              },
            },
          ],
        },
      });
    },
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('private-key');
  await connectApiKey(page);
  await selectModel(page, 'GPT-6.1 Sol');
  const before = await snapshot(page);
  await page.getByLabel('Message', { exact: true }).fill('Review');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Recovered without changing your drawing.', { exact: true }),
  ).toBeVisible();
  expect(budgets).toEqual([128000]);
  expect((await snapshot(page)).xml).toBe(before.xml);
  await expect(page.locator('.chat-error')).toHaveCount(0);
  const activity = page.locator('.chat-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).not.toHaveAttribute('open');
  await activity.locator(':scope > summary').click();
  await expect(activity.locator('.chat-progress')).toHaveCount(0);
  await expect(activity.locator('.chat-tool')).toHaveCount(0);
});

test('model popup groups latest versions, remembers older selections and combines thinking', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({
      json: {
        data: [
          'gpt-6-sol',
          'gpt-6.1-sol',
          'gpt-6.1-astra',
          'gpt-6.1-luna',
          'gpt-4o',
        ].map((id) => ({ id })),
      },
    }),
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai');
  await page.getByLabel('API key', { exact: true }).fill('private-key');
  await connectApiKey(page);
  const trigger = page.getByRole('button', {
    name: 'Select model and thinking level',
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole('radio', { name: 'GPT-6.1 Sol', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GPT-6.1 Astra', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GPT-6.1 Luna', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GPT-6 Sol', exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole('radio', { name: 'gpt-4o', exact: true }),
  ).toHaveCount(0);
  await page.locator('.chat-more-models > summary').click();
  await page.getByRole('radio', { name: 'GPT-6 Sol', exact: true }).check();
  await setThinking(page, 'High');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await trigger.click();
  const recent = page.getByRole('group', {
    name: 'Recently selected',
    exact: true,
  });
  await expect(
    recent.getByRole('radio', { name: 'GPT-6 Sol', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('slider', { name: 'Thinking level', exact: true }),
  ).toHaveAttribute('aria-valuetext', 'High');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking', exact: true }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('live thinking appears in the active row before the model finishes and stops pulsing when done', async ({
  page,
}) => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,content-type',
    );
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    if (request.url === '/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'live-6.1' }] }));
      return;
    }
    response.setHeader('Content-Type', 'text/event-stream');
    response.write(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              reasoning_content:
                'Inspecting the current circuit and checking resistor values.',
            },
          },
        ],
      })}\n\n`,
    );
    await gate;
    response.end(
      `data: ${JSON.stringify({
        choices: [
          { delta: { content: 'Checked the circuit.' }, finish_reason: 'stop' },
        ],
      })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await chooseProvider(page, 'compatible');
    await page.getByLabel('API key', { exact: true }).fill('private-key');
    await page
      .getByLabel('API base URL', { exact: true })
      .fill(`http://127.0.0.1:${server.address().port}`);
    await connectApiKey(page);
    await selectModel(page, 'live-6.1');
    await page
      .getByLabel('Message', { exact: true })
      .fill('Check the resistors');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const activity = page.locator('.chat-activity');
    await expect(activity.locator(':scope > summary')).toContainText(
      'Inspecting the current circuit',
    );
    await expect(page.locator('.chat-activity-working')).toHaveCSS(
      'animation-name',
      'chat-working-ripple',
    );
    await activity.locator(':scope > summary').click();
    await expect(page.locator('.chat-live-progress')).toContainText(
      'checking resistor values',
    );
    await expect(page.locator('.chat-activity-log')).toContainText(
      'is responding',
    );
    await expect(
      page.getByText('Waiting for the model or its current tool…', {
        exact: true,
      }),
    ).toHaveCount(0);
    finish();
    await expect(
      page.getByText('Checked the circuit.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.chat-activity-working')).toHaveCount(0);
  } finally {
    finish();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function mockChatGPTSignIn(
  page,
  { sharing = true, chooseModel = true } = {},
) {
  let signedIn = false;
  let logoutCount = 0;
  const state = () => ({
    available: true,
    connected: signedIn,
    sharing: signedIn && sharing,
    pending: false,
    csrf: 'test-csrf',
    profileId: signedIn ? 'test-profile' : undefined,
    identity: signedIn ? { email: 'subscriber@example.test' } : undefined,
    profiles: signedIn
      ? [
          {
            id: 'test-profile',
            label: 'subscriber@example.test',
            connected: true,
          },
        ]
      : [],
  });
  await page.context().route('https://auth.openai.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<p>Signed in. Return to TinyCAD.</p>',
    }),
  );
  await page.route('**/api/chat/chatgpt/account', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { result: state() } });
    expect(route.request().headers()['x-tinycad-chatgpt']).toBe('test-csrf');
    const request = route.request().postDataJSON();
    if (request.operation === 'start') {
      signedIn = true;
      return route.fulfill({
        json: {
          result: {
            loginId: 'login-test',
            authUrl: 'https://auth.openai.com/api/accounts/authorize?test=1',
          },
        },
      });
    }
    if (request.operation === 'models')
      return route.fulfill({
        json: { result: ['gpt-6.1-sol', 'gpt-6.1-luna', 'gpt-6-sol'] },
      });
    if (request.operation === 'logout') {
      signedIn = false;
      logoutCount++;
    }
    return route.fulfill({ json: { result: state() } });
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai', { account: true });
  await page
    .getByRole('button', { name: 'Sign in with ChatGPT', exact: true })
    .click();
  if (sharing) {
    await page
      .getByRole('dialog', { name: 'AI settings', exact: true })
      .getByRole('button', { name: 'Finish', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', {
        name: 'Using your ChatGPT plan',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(page.locator('.chat-plan-indicator')).toContainText(
      'Using ChatGPT',
    );
    await expect(page.locator('.chat-plan-indicator')).not.toContainText(
      'subscriber@example.test',
    );
    if (chooseModel) await selectModel(page, 'GPT-6.1 Sol', 'High');
    if (chooseModel)
      await expect(page.locator('.chat-plan-indicator > span')).toHaveText(
        'Using ChatGPT Sol 6.1',
      );
  }
  return { logouts: () => logoutCount };
}

const responseSSE = (output) =>
  `data: ${JSON.stringify({
    type: 'response.completed',
    response: { id: 'response-test', status: 'completed', output },
  })}\n\n`;
test('ChatGPT account sign-in reads and edits the current circuit through Responses tools without an API key', async ({
  page,
}) => {
  // Electron's invoke reply can arrive before the separate stream-end event.
  await page.evaluate(() => {
    const subscribe = window.electronAPI.onChatGPTStream;
    window.electronAPI.onChatGPTStream = (callback) => subscribe((event) => {
      if (event.type === 'end') setTimeout(() => callback(event), 50);
      else callback(event);
    });
  });
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  let count = 0;
  await page.route('https://api.openai.com/**', () => {
    throw new Error(
      'Account mode must use the protected local runtime, not browser API credentials.',
    );
  });
  await page.route('**/api/chat/chatgpt/responses', async (route) => {
    count++;
    const body = route.request().postDataJSON();
    expect(body._profileId).toBe('test-profile');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.reasoning.effort).toBe('high');
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
    expect(body.tools[0].type).toBe('namespace');
    expect(body.tools[0].name).toBe('tinycad');
    expect(body.tools[0].tools.map((tool) => tool.name)).toContain(
      'insert_symbol',
    );
    expect(route.request().headers()['authorization']).toBeUndefined();
    let output;
    if (count === 1)
      output = [
        {
          type: 'reasoning',
          id: 'rs-test',
          encrypted_content: 'opaque-reasoning',
          summary: [
            { type: 'summary_text', text: 'Read the current drawing first.' },
          ],
        },
        {
          type: 'function_call',
          namespace: 'tinycad',
          name: 'read_drawing',
          call_id: 'call-read',
          arguments: '{}',
        },
      ];
    else if (count === 2) {
      expect(
        body.input.some(
          (item) => item.encrypted_content === 'opaque-reasoning',
        ),
      ).toBe(true);
      const result = body.input.find(
        (item) =>
          item.type === 'function_call_output' && item.call_id === 'call-read',
      );
      const drawing = JSON.parse(result.output[0].text);
      expect(drawing.definition).toContain('Preserve me');
      output = [
        {
          type: 'function_call',
          namespace: 'tinycad',
          name: 'add_to_drawing',
          call_id: 'call-add',
          arguments: JSON.stringify({
            baseRevision: drawing.revision,
            sheet: 1,
            fragment: '<WIRE a="30,10" b="50,10"/>',
          }),
        },
      ];
    } else
      output = [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Added the wire using your ChatGPT account.',
            },
          ],
        },
      ];
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        output
          .map((item, output_index) =>
            [
              `data: ${JSON.stringify({
                type: 'response.output_item.added',
                output_index,
                item: {
                  ...item,
                  ...(item.type === 'function_call'
                    ? { arguments: '', status: 'in_progress' }
                    : {}),
                },
              })}\n\n`,
              ...(item.type === 'function_call'
                ? [
                    `data: ${JSON.stringify({
                      type: 'response.function_call_arguments.delta',
                      output_index,
                      item_id: item.id,
                      delta: item.arguments,
                    })}\n\n`,
                    `data: ${JSON.stringify({
                      type: 'response.function_call_arguments.done',
                      output_index,
                      item_id: item.id,
                      arguments: item.arguments,
                    })}\n\n`,
                  ]
                : []),
              `data: ${JSON.stringify({
                type: 'response.output_item.done',
                output_index,
                item,
              })}\n\n`,
            ].join(''),
          )
          .join('') + responseSSE([]),
    });
  });
  await mockChatGPTSignIn(page);
  await page.getByLabel('Message', { exact: true }).fill('Extend the wire');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Added the wire using your ChatGPT account.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(count).toBe(3);
  const after = await snapshot(page);
  expect(after.xml).toContain('Preserve me');
  expect(after.xml).toContain('50,10');
  await expect(
    page
      .locator('.chat-plan-indicator')
      .getByRole('button', { name: 'Manage usage', exact: true }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).not.toMatch(/access_token|refresh_token|opaque-reasoning/);
  await page.screenshot({
    path: test.info().outputPath('chatgpt-connected.png'),
  });
  await page
    .locator('#tinycad-chat')
    .getByRole('button', { name: 'AI settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
});
test('ChatGPT identity without plan permission cannot send and retains API-key setup', async ({
  page,
}) => {
  await mockChatGPTSignIn(page, { sharing: false });
  await expect(
    page
      .getByText('ChatGPT plan usage is not enabled', { exact: false })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('API key', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Use API Key', exact: true }).check();
  await expect(page.getByLabel('API key', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-plan-indicator')).toHaveCount(0);
});
test('a ChatGPT usage error preserves the drawing and offers Manage usage without API-key fallback', async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.route('https://api.openai.com/**', () => {
    throw new Error('Must not fall back to API billing.');
  });
  await page.route('**/api/chat/chatgpt/responses', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          name: 'set_drawing',
          call_id: 'never-execute',
          arguments: '{}',
        },
      })}\n\ndata: ${JSON.stringify({
        type: 'response.failed',
        response: {
          error: { code: 'subscription_sharing_usage_limit_exceeded' },
        },
      })}\n\n`,
    }),
  );
  await mockChatGPTSignIn(page);
  await page.getByLabel('Message', { exact: true }).fill('Edit');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-error')).toContainText('Manage usage');
  await expect(
    page
      .locator('.chat-plan-indicator')
      .getByRole('button', { name: 'Manage usage', exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).xml).toBe(before.xml);
});

test('Gemini uses an API key to read and edit the circuit without Google sign-in', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  await page.route(
    'https://generativelanguage.googleapis.com/v1beta/models',
    (route) => {
      expect(route.request().headers()['x-goog-api-key']).toBe(
        'gemini-private-key',
      );
      expect(route.request().headers()['authorization']).toBeUndefined();
      expect(route.request().headers()['x-goog-user-project']).toBeUndefined();
      return route.fulfill({
        json: {
          models: [
            {
              name: 'models/gemini-4-argon',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-3.1-pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        },
      });
    },
  );
  let calls = 0;
  await page.route(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:streamGenerateContent?alt=sse',
    async (route) => {
      calls++;
      expect(route.request().headers()['x-goog-api-key']).toBe(
        'gemini-private-key',
      );
      expect(route.request().headers()['authorization']).toBeUndefined();
      expect(route.request().headers()['x-goog-user-project']).toBeUndefined();
      const body = route.request().postDataJSON();
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
      expect(
        body.tools[0].functionDeclarations.map((tool) => tool.name),
      ).toContain('insert_symbol');
      let parts;
      if (calls === 1)
        parts = [
          {
            functionCall: { id: 'google-read', name: 'read_drawing', args: {} },
            thoughtSignature: 'signed-google-call',
          },
        ];
      else if (calls === 2) {
        const response = body.contents
          .flatMap((content) => content.parts)
          .find((part) => part.functionResponse?.name === 'read_drawing');
        expect(
          body.contents.some((content) =>
            content.parts.some(
              (part) => part.thoughtSignature === 'signed-google-call',
            ),
          ),
        ).toBe(true);
        expect(response.functionResponse.response.result.definition).toContain(
          'Preserve me',
        );
        parts = [
          {
            functionCall: {
              id: 'google-add',
              name: 'add_to_drawing',
              args: {
                baseRevision:
                  response.functionResponse.response.result.revision,
                sheet: 1,
                fragment: '<WIRE a="30,10" b="50,10"/>',
              },
            },
          },
        ];
      } else parts = [{ text: 'Added the wire using Gemini OAuth.' }];
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({
          candidates: [{ content: { parts }, finishReason: 'STOP' }],
        })}\n\n`,
      });
    },
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'gemini');
  await expect(
    page.getByRole('radio', { name: 'Sign in with Google', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', {
      name: 'Use Google account for Gemini',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel('API key', { exact: true }).fill('gemini-private-key');
  await connectApiKey(page);
  await selectModel(page, 'gemini-4-argon', 'High');
  await expect(page.locator('.chat-plan-indicator')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('Extend the wire');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Added the wire using Gemini OAuth.', { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(3);
  const after = await snapshot(page);
  expect(after.xml).toContain('Preserve me');
  expect(after.xml).toContain('50,10');
  await page
    .locator('#tinycad-chat')
    .getByRole('button', { name: 'AI settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Clear API key', exact: true })
    .click();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
});
test('ChatGPT sign-in immediately enables typing and sending without manually selecting a model', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/chat/chatgpt/responses', (route) => {
    requests++;
    expect(route.request().postDataJSON().model).toBe('gpt-6.1-sol');
    return route.fulfill({
      contentType: 'text/event-stream',
      body: responseSSE([
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Ready to help.' }],
        },
      ]),
    });
  });
  await mockChatGPTSignIn(page, { chooseModel: false });
  const message = page.getByLabel('Message', { exact: true });
  await expect(message).toBeEnabled();
  await message.click();
  await expect(message).toBeFocused();
  await message.pressSequentially('Hello');
  await expect(message).toHaveValue('Hello');
  await expect(
    page.getByRole('button', {
      name: 'Select model and thinking level',
      exact: true,
    }),
  ).toHaveAttribute('title', /GPT-6.1 Sol/);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Ready to help.', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('custom endpoints require a selected model and a successful test before finishing setup', async ({
  page,
}) => {
  await page.route('http://localhost:11434/v1/models', (route) =>
    route.fulfill({ status: 404 }),
  );
  let tested = 0;
  await page.route('http://localhost:11434/v1/chat/completions', (route) => {
    tested++;
    expect(route.request().postDataJSON().model).toBe('local-model');
    return route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'OK' },
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'compatible');
  await page.getByLabel('API key', { exact: true }).fill('local-key');
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('does not list models');
  await expect(
    dialog.locator('.chat-wizard-steps [aria-current="step"]'),
  ).toContainText('Account or API key');
  await dialog.getByLabel('Model ID', { exact: true }).fill('local-model');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();

  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(tested).toBe(1);
});

test('a ChatGPT relay failure shows the failure in activity without claiming the model is responding', async ({
  page,
}) => {
  await page.route('**/api/chat/chatgpt/responses', (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: {
          code: 'invalid_stream',
          message:
            'ChatGPT returned no recognizable response stream. Upstream HTTP 200; content type: text/html.',
        },
      },
    }),
  );
  await mockChatGPTSignIn(page);
  await page.getByLabel('Message', { exact: true }).fill('Build an amplifier');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-error')).toContainText('Upstream HTTP 200');
  const summary = page.locator('.chat-activity > summary');
  await expect(summary).toContainText('Failed:');
  await expect(summary).not.toContainText('is responding');
  await summary.click();
  await expect(page.locator('.chat-activity-log')).toContainText(
    'content type: text/html',
  );
  await expect(page.locator('.chat-activity-log')).not.toContainText(
    'Receiving the ChatGPT response stream',
  );
});

test('component IDs place repeated instances without XML and direct layout applies with Undo', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  const created = await run(page, 'create_ic_symbol', {
    name: 'ID part',
    pins: [{ name: 'IN', number: '1', side: 'west', order: 1 }],
    format: 'svg',
  });
  expect(created.data.definition).toBeUndefined();
  let revision = (await run(page, 'read_metadata')).data.revision;
  const first = await run(page, 'place_component', {
    componentId: created.data.componentId,
    baseRevision: revision,
    x: 50,
    y: 40,
  });
  expect(first.data.reference).toBe('U1');
  const second = await run(page, 'place_component', {
    componentId: created.data.componentId,
    baseRevision: first.data.revision,
  });
  expect(second.data.reference).toBe('U2');
  expect(second.data.pins).toHaveLength(1);
  const placed = await snapshot(page);
  expect(placed.xml.match(/<SYMBOLDEF /g)).toHaveLength(1);
  expect(placed.xml.match(/<SYMBOL /g)).toHaveLength(2);
  const nets = await run(page, 'read_netlist');
  const layout = await run(page, 'auto_layout', {
    baseRevision: second.data.revision,
    maxEvaluations: 100,
    maxPasses: 1,
  });
  expect(layout.data.applied).toBe(true);
  expect(layout.data.definition).toBeUndefined();
  expect(layout.data.layout.connectivityPreserved).toBe(true);
  expect(layout.data.layout.serializationConnectivityPreserved).toBe(true);
  expect((await snapshot(page)).xml).toContain('Preserve me');
  await page.evaluate(() => window.chatTest.undo());
  expect((await snapshot(page)).xml).toBe(placed.xml);
  expect((await run(page, 'read_netlist')).data).toEqual(nets.data);
  expect(await page.evaluate(() => window.chatTest.downloads())).toHaveLength(
    0,
  );
});

test('library batch additions preserve unsaved artwork, reject stale edits and undo atomically', async ({
  page,
}) => {
  const pins = [{ name: 'IN', number: '1', side: 'west', order: 1 }];
  const existing = await run(page, 'create_ic_symbol', {
    name: 'Existing',
    pins,
    includeDefinition: true,
    format: 'svg',
  });
  await page.evaluate(
    (xml) => window.chatTest.openLibrary(xml),
    existing.data.definition,
  );
  const read = (await run(page, 'read_drawing')).data;
  expect(read.mode).toBe('library');
  const unsaved = await run(page, 'add_to_drawing', {
    baseRevision: read.revision,
    sheet: 1,
    fragment: '<RECTANGLE a="40,40" b="44,44" style="1" fill="0"/>',
  });
  expect(unsaved.data.applied).toBe(true);
  const before = await snapshot(page);
  const first = await run(page, 'create_ic_symbol', {
    name: 'New A',
    pins,
    format: 'svg',
  });
  const second = await run(page, 'create_ic_symbol', {
    name: 'New B',
    pins,
    format: 'svg',
  });
  const batch = {
    baseRevision: unsaved.data.revision,
    components: [
      { componentId: first.data.componentId, reference: 'Q?' },
      { componentId: second.data.componentId },
    ],
  };
  const added = await run(page, 'add_library_components', batch);
  expect(added.data.added.map((component) => component.name)).toEqual([
    'New A',
    'New B',
  ]);
  const inventory = (await run(page, 'read_library')).data;
  expect(inventory.components.map((component) => component.name)).toEqual([
    'Existing',
    'New A',
    'New B',
  ]);
  expect(inventory.activeNameId).toBe(added.data.added[1].nameId);
  const library = await page.evaluate(() => window.chatTest.library());
  expect(library.symbols[0].Data).toContain('40,40');
  expect(library.names[1].Reference).toBe('Q?');
  await expect(run(page, 'add_library_components', batch)).rejects.toThrow(
    /changed/,
  );
  await expect(
    run(page, 'place_component', {
      componentId: first.data.componentId,
      baseRevision: inventory.revision,
    }),
  ).rejects.toThrow(/circuit/);
  await expect(
    run(page, 'add_library_components', {
      baseRevision: inventory.revision,
      components: [
        { componentId: first.data.componentId, name: 'Unique' },
        { componentId: second.data.componentId, name: 'Existing' },
      ],
    }),
  ).rejects.toThrow(/already exists/);
  expect((await run(page, 'read_library')).data.components).toHaveLength(3);
  await page.evaluate(() => window.chatTest.undo());
  expect((await snapshot(page)).xml).toBe(before.xml);
  expect((await run(page, 'read_library')).data.components).toHaveLength(1);
  await page.evaluate(() => window.chatTest.redo());
  expect((await run(page, 'read_library')).data.components).toHaveLength(3);
  expect(await page.evaluate(() => window.chatTest.downloads())).toHaveLength(
    0,
  );
});

test('SPICE tools inspect local models and set requested definitions on generated components', async ({ page }) => {
  const skill = (await run(page, 'read_skill_reference', { path: 'references/spice-models.md' })).data.content;
  expect(skill).toContain('only when the user explicitly requests SPICE or simulation support');
  const found = (await run(page, 'search_spice_models', { query: '1N4148' })).data.models;
  const { id: modelId, packId, revision } = found.find(({ id }) => id === '1N4148_OJ');
  const model = { modelId, packId, revision };
  const details = (await run(page, 'inspect_spice_model', model)).data;
  expect(details.definition).toMatch(/\.model 1N4148_OJ/i);
  expect(details.source.url).toMatch(/^https:/);
  const created = (await run(page, 'create_ic_symbol', {
    name: 'Signal diode',
    reference: 'D?',
    pins: [
      { name: 'A', number: '2', side: 'west', order: 1 },
      { name: 'K', number: '1', side: 'east', order: 1 },
    ],
    includeDefinition: true,
    format: 'svg',
  })).data;
  const { componentId } = created;
  const target = (await run(page, 'inspect_spice_target', { componentId, ...model })).data;
  expect(target.mapping.mapping).toEqual(['2', '1']);
  expect(target.attachment).toBeUndefined();
  const plain = (await run(page, 'place_component', { componentId, baseRevision: target.revision })).data;
  const placed = (await run(page, 'inspect_spice_target', { reference: plain.reference })).data;
  expect(placed.template).toBeUndefined();
  const attached = (await run(page, 'attach_spice_model', {
    ...model, reference: plain.reference, sheet: 1, baseRevision: placed.revision, pins: ['2', '1'],
  })).data;
  const customSpice = {
    template: 'DTC_$(ref) %(2) %(1) TEST_DIODE',
    prologue: '* Test diode\n' + '* Standalone test definition\n'.repeat(50) + '.model TEST_DIODE D(IS=1n)',
  };
  const custom = (await run(page, 'place_component', {
    componentId, customSpice, baseRevision: attached.revision,
  })).data;
  expect(custom.applied).toBe(true);
  expect((await snapshot(page)).xml).toContain('TEST_DIODE');
  const customTarget = (await run(page, 'inspect_spice_target', { reference: custom.reference })).data;
  expect(customTarget.template).toBe(customSpice.template);
  expect(customTarget.prologue).toBe(customSpice.prologue);
  expect(customTarget.customTemplate).toBe(true);
  await page.evaluate(xml => window.chatTest.openLibrary(xml), created.definition);
  const library = (await run(page, 'read_library')).data;
  expect((await run(page, 'search_spice_models', { query: '1N4148', componentId })).data.total).toBeGreaterThan(0);
  await run(page, 'add_library_components', {
    baseRevision: library.revision,
    components: [
      { componentId, name: 'Linked diode', spiceModel: { ...model, pins: ['2', '1'] } },
      { componentId, name: 'Custom diode', customSpice },
    ],
  });
  const { components } = (await run(page, 'read_library')).data;
  const linked = components.find(({ name }) => name === 'Linked diode').attributes;
  const binding = linked.find(({ AttName }) => AttName === '$$CATALOG_MODEL');
  expect(binding.ShowAtt).toBe(2);
  expect(JSON.parse(binding.AttValue)).toMatchObject({ modelId, packId, pins: ['2', '1'] });
  const attributes = components.find(({ name }) => name === 'Custom diode').attributes;
  expect(attributes.find(({ AttName }) => AttName === '$$SPICE_PROLOG')).toMatchObject({
    AttValue: customSpice.prologue, ShowAtt: 2,
  });
});

test('ChatGPT web search shows inline citations and keeps search details collapsed', async ({
  page,
}) => {
  await page.route('**/api/chat/chatgpt/responses', (route) => {
    const body = route.request().postDataJSON();
    expect(body.tools.some((tool) => tool.type === 'web_search')).toBe(true);
    expect(body.instructions).toContain('Web search is enabled');
    const search = {
      id: 'ws-ui',
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', query: 'official transistor datasheet' },
    };
    const text = 'Verified pinout.';
    const message = {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text,
          annotations: [
            {
              type: 'url_citation',
              start_index: 0,
              end_index: text.length,
              url: 'https://manufacturer.example/datasheet',
              title: 'Datasheet',
            },
          ],
        },
      ],
    };
    return route.fulfill({
      contentType: 'text/event-stream',
      body:
        `data: ${JSON.stringify({
          type: 'response.output_item.done',
          item: search,
        })}\n\n` + responseSSE([search, message]),
    });
  });
  await mockChatGPTSignIn(page, { chooseModel: false });
  await page
    .getByLabel('Message', { exact: true })
    .fill('Search for the official datasheet');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '1', exact: true }),
  ).toHaveAttribute('href', 'https://manufacturer.example/datasheet');
  const activity = page.locator('.chat-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).not.toHaveAttribute('open');
  await expect(activity.locator(':scope > summary')).toContainText(
    'Searched the web',
  );
  await activity.locator(':scope > summary').click();
  const search = activity.locator('.chat-tool');
  await expect(search).toHaveCount(1);
  await expect(search).not.toHaveAttribute('open');
  await search.locator('summary').click();
  await expect(search.locator('pre')).toContainText(
    'official transistor datasheet',
  );
});

test('signed-out chat has icon controls and a centered sign-in prompt opening a modal wizard', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const prompt = page.getByRole('button', {
    name: 'Click here to Sign in to use AI',
    exact: true,
  });
  await expect(prompt).toBeVisible();
  const position = await prompt.boundingBox();
  const transcript = await page.locator('.chat-transcript').boundingBox();
  expect(
    Math.abs(
      position.x + position.width / 2 - transcript.x - transcript.width / 2,
    ),
  ).toBeLessThan(3);
  expect(
    Math.abs(
      position.y + position.height / 2 - transcript.y - transcript.height / 2,
    ),
  ).toBeLessThan(3);
  await expect(page.locator('label[for="chat-prompt"]')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  for (const name of ['New chat', 'AI settings']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toHaveText('');
    await expect(button.locator('svg')).toHaveCount(1);
  }
  await prompt.click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Step 1 — Choose provider', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Next', exact: true }),
  ).toBeDisabled();
  await chooseProvider(page, 'anthropic');
  await expect(
    dialog.getByRole('link', { name: 'Claude Console API keys' }),
  ).toHaveAttribute('href', 'https://platform.claude.com/settings/keys');
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(prompt).toBeFocused();
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'AI settings', exact: true }),
  ).toBeFocused();
});

test('setup automatically tests keys, hides entered secrets after Next and uses a Medium thinking slider', async ({
  page,
}) => {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({
      status:
        route.request().headers().authorization === 'Bearer invalid-key'
          ? 401
          : 200,
      json: { data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6.1-luna' }] },
    }),
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai');
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(
    dialog.getByRole('radio', { name: 'Use API Key', exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }),
  ).toHaveCount(0);
  const key = dialog.getByLabel('API key', { exact: true });
  await key.fill('invalid-key');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('401');
  await expect(
    dialog.locator('.chat-wizard-steps [aria-current="step"]'),
  ).toContainText('Account or API key');
  await key.fill('private-good-key');
  await dialog.getByLabel('Show API key', { exact: true }).check();
  await expect(key).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(
    'Step 3 — Pick Model',
  );
  await expect(
    dialog.getByRole('button', { name: 'Test connection', exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    'Medium',
  );
  expect(
    await dialog
      .locator('input')
      .evaluateAll((inputs) =>
        inputs.some((input) => input.value === 'private-good-key'),
      ),
  ).toBe(false);
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('type', 'password');
  await expect(
    dialog.getByLabel('Show API key', { exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog
    .getByRole('radio', { name: 'GPT-6.1 Luna', exact: true })
    .check();
  await setThinking(page, 'High');
  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const preferences = await page.evaluate(() =>
    localStorage.getItem('tinycad.chat.settings.v1'),
  );
  expect(JSON.parse(preferences)).toMatchObject({
    model: 'gpt-6.1-luna',
    thinkingLevel: 'high',
  });
  expect(preferences).not.toContain('private-good-key');
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(
    dialog.getByText('Connected using an API key', { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator('.chat-wizard-steps')).toHaveCount(0);
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Show API key', { exact: true })).toHaveCount(
    0,
  );
  expect(
    await dialog
      .locator('input')
      .evaluateAll((inputs) =>
        inputs.some((input) => input.value === 'private-good-key'),
      ),
  ).toBe(false);
  await setThinking(page, 'Max');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Keep this draft',
  );
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(dialog.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    'High',
  );
  await setThinking(page, 'Medium');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Clear API key', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Click here to Sign in to use AI',
      exact: true,
    }),
  ).toBeVisible();
});

test('account settings show the current email and require sign-out before connecting another provider', async ({
  page,
}) => {
  const account = await mockChatGPTSignIn(page, { chooseModel: false });
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(
    dialog.getByText('subscriber@example.test', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Provider', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Back', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(account.logouts()).toBe(0);
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect(account.logouts()).toBe(1);
  await expect(dialog).not.toBeVisible();
  await page.route('https://api.anthropic.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'claude-sonnet-5' }] } }),
  );
  await chooseProvider(page, 'anthropic');
  await page.getByLabel('API key', { exact: true }).fill('claude-private-key');
  await connectApiKey(page);
  await expect(page.locator('.chat-plan-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Anthropic Claude', exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Clear API key', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Click here to Sign in to use AI',
      exact: true,
    }),
  ).toBeVisible();
});

test('saved ChatGPT account offers only continue or replacement and hides API-key entry until selected', async ({
  page,
}) => {
  const account = {
    available: true,
    connected: true,
    sharing: true,
    profileId: 'single-account',
    csrf: 'test-csrf',
    identity: { email: 'saved@example.test' },
    profiles: [
      { id: 'single-account', label: 'saved@example.test' },
      { id: 'legacy-account', label: 'legacy@example.test' },
    ],
  };
  let starts = 0;
  await page.route('**/api/chat/chatgpt/account', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return route.fulfill({ json: { result: account } });
    const body = request.postDataJSON();
    if (body.operation === 'models')
      return route.fulfill({ json: { result: ['gpt-6.1-sol'] } });
    if (body.operation === 'start') starts++;
    return route.fulfill({ json: { result: account } });
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai', { account: true });
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(
    dialog.getByText('saved@example.test', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Add account', exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', {
      name: 'Sign in with a different account',
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveCount(0);
  await dialog
    .getByRole('button', {
      name: 'Continue as saved@example.test',
      exact: true,
    })
    .click();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(
    'Step 3 — Pick Model',
  );
  expect(starts).toBe(0);
});

test('a different ChatGPT sign-in replaces the remembered account and opens Pick Model automatically', async ({
  page,
}) => {
  let signedIn = true,
    email = 'first@example.test',
    replacing = false;
  const operations = [];
  const state = () => ({
    available: true,
    connected: signedIn,
    sharing: signedIn,
    profileId: replacing ? 'replacement' : 'first',
    csrf: 'test-csrf',
    identity: { email },
  });
  await page
    .context()
    .route('https://auth.openai.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: 'Signed in' }),
    );
  await page.route('**/api/chat/chatgpt/account', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { result: state() } });
    const request = route.request().postDataJSON();
    operations.push(request.operation);
    if (request.operation === 'logout') signedIn = false;
    if (request.operation === 'start') {
      expect(request.args.newAccount).toBe(true);
      signedIn = true;
      replacing = true;
      email = 'second@example.test';
      return route.fulfill({
        json: {
          result: {
            loginId: 'replacement-login',
            authUrl:
              'https://auth.openai.com/api/accounts/authorize?replacement=1',
          },
        },
      });
    }
    if (request.operation === 'models')
      return route.fulfill({ json: { result: ['gpt-6.1-sol'] } });
    return route.fulfill({ json: { result: state() } });
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'openai', { account: true });
  await page
    .getByRole('button', {
      name: 'Sign in with a different account',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(
    'Step 3 — Pick Model',
  );
  expect(operations.slice(0, 3)).toEqual(['logout', 'start', 'models']);
  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(
    dialog.getByText('second@example.test', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('first@example.test', { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
});

test('Chat is a native toolbar button with no floating launcher or overlapping controls', async ({
  page,
}) => {
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  await expect(chat).toHaveText('Chat');
  await expect(chat.locator('svg')).toHaveCount(1);
  await expect(chat).toHaveClass(/fui-Button/);
  await expect(page.locator('.chat-launcher')).toHaveCount(0);
  await expect(chat).toHaveAttribute('aria-expanded', 'false');
  for (const width of [1500, 900, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await chat.evaluate((button) => {
      const container = button.closest('.toolbar-container');
      container.scrollLeft = container.scrollWidth;
    });
    const layout = await chat.evaluate((button) => {
      const rectangle = button.getBoundingClientRect();
      const toolbar = button.closest('[role="toolbar"]');
      const hit = document.elementFromPoint(
        rectangle.x + rectangle.width / 2,
        rectangle.y + rectangle.height / 2,
      );
      return {
        inToolbar: !!toolbar,
        position: getComputedStyle(button).position,
        clickable: button.contains(hit),
        overlaps: Array.from(toolbar.querySelectorAll('button'))
          .filter((other) => {
            if (other === button) return false;
            const box = other.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              Math.min(rectangle.right, box.right) -
                Math.max(rectangle.left, box.left) >
                1 &&
              Math.min(rectangle.bottom, box.bottom) -
                Math.max(rectangle.top, box.top) >
                1
            );
          })
          .map((other) => other.getAttribute('aria-label')),
      };
    });
    expect(layout.inToolbar).toBe(true);
    expect(['absolute', 'fixed']).not.toContain(layout.position);
    expect(layout.clickable).toBe(true);
    expect(layout.overlaps).toEqual([]);
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await chat.click();
  await expect(chat).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByRole('complementary', {
      name: 'TinyCAD AI assistant',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close chat', exact: true }).click();
  await expect(chat).toHaveAttribute('aria-expanded', 'false');
  await chat.click();
  await chat.click();
  await expect(chat).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: test.info().outputPath('toolbar-chat.png') });
});

test('provider setup explains paid ChatGPT allowance, free Gemini and API-key instructions', async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem('tinycad.chat.settings.v1', JSON.stringify({
    provider: 'retired-provider', endpoint: 'https://retired.example/v1', model: 'old-model',
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  expect(await dialog.getByLabel('Provider', { exact: true }).locator('option').evaluateAll(
    options => options.map(option => option.value).filter(Boolean),
  )).toEqual(['openai', 'anthropic', 'gemini', 'compatible', 'ollama']);
  await expect(dialog.locator('.chat-provider-guidance')).toContainText(
    'If you pay for ChatGPT',
  );
  await expect(dialog.locator('.chat-provider-guidance')).toContainText(
    'free API option',
  );
  await expect(dialog.locator('.chat-provider-guidance')).toContainText(
    'API key from your preferred',
  );
  await chooseProvider(page, 'openai', { account: true });
  await expect(
    dialog.getByRole('region', { name: 'Sign in with ChatGPT', exact: true }),
  ).toContainText('eligible paid ChatGPT subscription');
  await expect(
    dialog.getByRole('region', { name: 'Sign in with ChatGPT', exact: true }),
  ).toContainText('uses your ChatGPT allowance');
  for (const [provider, link] of [
    ['anthropic', 'Claude Console API keys'],
    ['gemini', 'Get a Gemini API key'],
    ['compatible', 'create an OpenAI API key'],
  ]) {
    await chooseProvider(page, provider);
    await expect(
      dialog.getByRole('link', { name: new RegExp(link) }),
    ).toBeVisible();
    await expect(dialog.getByLabel('API key', { exact: true })).toBeVisible();
  }
});

test('Ollama connects locally without a key, runs drawing tools and can disconnect', async ({
  page,
}) => {
  await page.evaluate((xml) => window.chatTest.load(xml), circuit);
  let completions = 0;
  await page.route('http://localhost:11434/v1/models', (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { data: [{ id: 'local-tools' }] } });
  });
  await page.route('http://localhost:11434/v1/chat/completions', (route) => {
    completions++;
    expect(route.request().headers().authorization).toBeUndefined();
    const request = route.request().postDataJSON();
    expect(request.model).toBe('local-tools');
    expect(
      request.tools.some((tool) => tool.function.name === 'read_metadata'),
    ).toBe(true);
    let message;
    if (completions === 1)
      message = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'local-read',
            type: 'function',
            function: { name: 'read_metadata', arguments: '{}' },
          },
        ],
      };
    else if (completions === 2) {
      const result = JSON.parse(
        request.messages.filter((item) => item.role === 'tool').at(-1).content,
      );
      message = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'local-add',
            type: 'function',
            function: {
              name: 'add_to_drawing',
              arguments: JSON.stringify({
                baseRevision: result.revision,
                sheet: 1,
                fragment: '<WIRE a="30,10" b="50,10"/>',
              }),
            },
          },
        ],
      };
    } else
      message = {
        role: 'assistant',
        content: 'Added the wire with local Ollama.',
      };
    return route.fulfill({
      json: {
        choices: [
          {
            finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
            message,
          },
        ],
      },
    });
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await chooseProvider(page, 'ollama');
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('link', { name: 'Install Ollama', exact: true }),
  ).toHaveAttribute('href', 'https://ollama.com/download');
  await expect(dialog).toContainText('OLLAMA_ORIGINS');
  await expect(
    dialog.getByLabel('Ollama API URL', { exact: true }),
  ).toHaveValue('http://localhost:11434/v1');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText(
    'Step 3 — Pick Model',
  );
  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill('Extend the wire');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Added the wire with local Ollama.', { exact: true }),
  ).toBeVisible();
  expect(completions).toBe(3);
  expect((await snapshot(page)).xml).toContain('50,10');
  expect((await snapshot(page)).xml).toContain('Preserve me');
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await expect(
    dialog.getByText('Connected to local Ollama (no API key)', { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Disconnect Ollama', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Click here to Sign in to use AI',
      exact: true,
    }),
  ).toBeVisible();
});

test('IC generator titles fit within their editable text boxes without clipping', async ({
  page,
}) => {
  const pins = Array.from({ length: 38 }, (_, index) => ({
    name: `GPIO${index}`,
    number: String(index + 1),
    side: index < 19 ? 'west' : 'east',
    order: (index % 19) + 1,
  }));
  for (const name of ['ESP32-DevKitC-V4', 'ESP32_DevKitC **WROOM** (gyp)']) {
    const generated = await page.evaluate(
      ({ name, pins }) =>
        window.chatTest.native('create_ic_symbol', { name, pins }),
      { name, pins },
    );
    const measurements = await page.evaluate(
      async ({ svg, name, definition }) => {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:absolute;left:-10000px;top:0';
        const root = new DOMParser().parseFromString(
          svg,
          'image/svg+xml',
        ).documentElement;
        holder.appendChild(document.importNode(root, true));
        document.body.appendChild(holder);
        try {
          await document.fonts.ready;
          const title = [
            ...holder.querySelectorAll('[data-markdown="true"]'),
          ].find((node) => node.textContent === name);
          if (!title)
            throw new Error(
              'Generated component title is missing or not literal text.',
            );
          const xml = new DOMParser().parseFromString(
            definition,
            'application/xml',
          );
          const note = xml.querySelector('NOTE_TEXT');
          const [ax, ay] = note.getAttribute('a').split(',').map(Number);
          const [bx, by] = note.getAttribute('b').split(',').map(Number);
          return {
            width: Number(title.getAttribute('width')),
            height: Number(title.getAttribute('height')),
            lines: [
              ...new Set(
                [...title.querySelectorAll('text')].map((text) =>
                  text.getAttribute('y'),
                ),
              ),
            ].length,
            glyphs: [...title.querySelectorAll('text')].map((text) => {
              const box = text.getBBox();
              return {
                left: box.x,
                top: box.y,
                right: box.x + box.width,
                bottom: box.y + box.height,
              };
            }),
            center: [(ax + bx) / 2, (ay + by) / 2],
          };
        } finally {
          holder.remove();
        }
      },
      { svg: generated.svg, name, definition: generated.definition },
    );
    expect(measurements.lines).toBe(1);
    for (const glyph of measurements.glyphs) {
      expect(glyph.left).toBeGreaterThanOrEqual(0);
      expect(glyph.top).toBeGreaterThanOrEqual(0);
      expect(glyph.right).toBeLessThanOrEqual(measurements.width);
      expect(glyph.bottom).toBeLessThanOrEqual(measurements.height - 2);
    }
    expect(measurements.center[0]).toBeCloseTo(generated.width / 2);
    expect(measurements.center[1]).toBeCloseTo(generated.height / 2);
    expect(generated.pinPitch).toBe(2);
  }
});


test('bundled library search injects the catalog and places original SPICE symbols without online fetches', async ({ page }) => {
  const root = new URL('../../../', import.meta.url);
  const catalog = JSON.parse(await readFile(new URL('bundled-libraries/config.json', root), 'utf8'));
  catalog.libraries = catalog.libraries.filter(entry => ['spice', 'digital'].includes(entry.id));
  const requested = [];
  await page.route('**/bundled-libraries/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/config.json')) {
      await route.fulfill({ json: catalog });
      return;
    }
    const entry = catalog.libraries.find(entry => pathname.endsWith('/' + entry.path));
    if (!entry) { await route.abort(); return; }
    requested.push(entry.id);
    await route.fulfill({ body: await readFile(new URL('bundled-libraries/' + entry.path, root)), contentType: 'application/octet-stream' });
  });
  let online = 0;
  await page.route('**/api/search/**', async route => { online++; await route.abort(); });
  const skill = (await run(page, 'read_skill_reference', { path: 'SKILL.md' })).data.content;
  expect(skill).toContain('SPICE essentials');
  expect(skill).toContain('SPICE models when requested');
  expect(skill).toContain('Digital logic');
  expect(skill).toContain('search_bundled_symbols BEFORE the online search_symbols');
  expect(requested).toEqual([]); // The runtime catalog does not eagerly load SQLite.
  const before = await snapshot(page);
  const all = (await run(page, 'search_bundled_symbols', { query: 'resistor' })).data;
  expect(all.complete).toBe(true);
  expect(all.searchedLibraries.sort()).toEqual(['digital', 'spice']);
  const resistor = all.symbols.find(symbol => symbol.name === 'Resistor');
  expect(resistor.libraryId).toBe('spice');
  requested.length = 0;
  const scoped = (await run(page, 'search_bundled_symbols', { query: 'Resistor', libraryId: 'spice' })).data;
  expect(requested).toEqual(['spice']);
  expect(scoped.symbols.find(symbol => symbol.name === 'Resistor').componentId).toBe(resistor.componentId);
  const symbol = (await run(page, 'get_symbol', { componentId: resistor.componentId })).data;
  expect(symbol.validation.valid).toBe(true);
  expect(symbol.attributes.some(attribute => attribute.name === '$$SPICE')).toBe(true);
  expect(symbol.definition).toBeUndefined();
  expect((await snapshot(page)).xml).toBe(before.xml);
  const read = (await run(page, 'read_drawing')).data;
  const placed = (await run(page, 'place_component', { componentId: resistor.componentId, baseRevision: read.revision, sheet: 1 })).data;
  expect(placed.applied).toBe(true);
  expect((await snapshot(page)).xml).toContain('$$SPICE');
  await page.evaluate(() => window.chatTest.undo());
  expect((await snapshot(page)).xml).toBe(before.xml);
  expect(online).toBe(0);
});
