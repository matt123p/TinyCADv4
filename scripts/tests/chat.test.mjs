import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadComponent } from './load-component.mjs';
const thinkingModule = loadComponent('src/chat/thinking.ts', {});
const {
  providerRequest,
  parseProviderResponse,
  createTransport,
  byokAuth,
  listProviderModels,
} = loadComponent('src/chat/providers.ts', {
  './thinking': thinkingModule,
  './stream': loadComponent('src/chat/stream.ts', {}),
  './errors': loadComponent('src/chat/errors.ts', {}),
  './models': loadComponent('src/chat/models.ts', {}),
});
const { ChatSession } = loadComponent('src/chat/session.ts', {});
const { toolSpecs, checkArguments } = loadComponent(
  'src/chat/tool-specs.ts',
  {},
);
const context = vm.createContext({ console, TextEncoder });
vm.runInContext(
  fs.readFileSync(
    new URL('../../src/chat/native.bundle.js', import.meta.url),
    'utf8',
  ),
  context,
);
const native = (name, args) =>
  JSON.parse(JSON.stringify(context.TinyCADChatNative.nativeTool(name, args)));
const resources = JSON.parse(
  fs.readFileSync(
    new URL('../../src/chat/skill/resources.json', import.meta.url),
    'utf8',
  ),
);
const symbol = resources['assets/symbol.xml'];
const drawing =
  '<TinyCAD><NAME>Main</NAME><WIRE a="10,10" b="30,10"/></TinyCAD>';
const settings = (provider) => ({
  provider,
  model: 'test-model',
  endpoint: 'https://example.com/v1',
  maxTokens: 1024,
});
const image = { name: 'image.png', mime: 'image/png', data: 'aGVsbG8=' };
const pdf = {
  name: 'datasheet.pdf',
  mime: 'application/pdf',
  data: 'aGVsbG8=',
};
const calls = [
  { id: 'call-1', name: 'read_drawing', arguments: {} },
  { id: 'call-2', name: 'render_drawing', arguments: {} },
];

test('direct tools include every MCP operation plus editor and netlist tools', () => {
  const names = new Set(toolSpecs.map((s) => s.name));
  for (const n of [
    'search_symbols',
    'get_symbol',
    'create_ic_symbol',
    'validate_component',
    'render_component',
    'validate_drawing',
    'render_drawing',
    'auto_tidy_drawing',
    'read_drawing',
    'read_metadata',
    'read_netlist',
    'set_drawing',
    'edit_drawing',
    'add_to_drawing',
    'export_file',
  ])
    assert.ok(names.has(n), n);
  assert.throws(
    () =>
      checkArguments(
        { definition: 'xml', baseRevision: '1', unexpected: true },
        toolSpecs.find((t) => t.name === 'set_drawing').parameters,
      ),
    /Unknown/,
  );
  assert.throws(
    () =>
      checkArguments(
        { definition: 'xml' },
        toolSpecs.find((t) => t.name === 'set_drawing').parameters,
      ),
    /baseRevision/,
  );
});
test('OpenAI tool history preserves adjacent responses before preview vision messages', () => {
  const messages = [
    { role: 'user', text: 'Convert', attachments: [pdf, image] },
    { role: 'assistant', text: '', calls },
    ...calls.map((call) => ({
      role: 'tool',
      call,
      result: { data: { success: true }, images: [image] },
    })),
  ];
  const req = providerRequest(settings('openai'), messages, 'skill', toolSpecs);
  assert.equal(req.path, '/chat/completions');
  assert.equal(
    req.body.messages[1].content[1].file.file_data,
    'data:application/pdf;base64,aGVsbG8=',
  );
  assert.deepEqual(
    req.body.messages.map((m) => m.role),
    ['system', 'user', 'assistant', 'tool', 'tool', 'user'],
  );
  assert.equal(req.body.messages[2].tool_calls[0].id, 'call-1');
  assert.equal(req.body.messages[5].content[1].type, 'image_url');
  assert.equal(req.body.max_completion_tokens, 1024);
});
test('Anthropic retains thinking blocks and groups all tool results with vision', () => {
  const answer = parseProviderResponse('anthropic', {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'opaque', signature: 'signed' },
      { type: 'tool_use', id: 'call-1', name: 'read_drawing', input: {} },
      { type: 'tool_use', id: 'call-2', name: 'render_drawing', input: {} },
    ],
  });
  const req = providerRequest(
    settings('anthropic'),
    [
      { role: 'user', text: 'Draw', attachments: [pdf] },
      answer,
      ...answer.calls.map((call) => ({
        role: 'tool',
        call,
        result: { data: {}, images: [image] },
      })),
    ],
    'skill',
    toolSpecs,
  );
  assert.equal(req.path, '/messages');
  assert.equal(req.body.messages.length, 3);
  assert.equal(req.body.messages[0].content[1].type, 'document');
  assert.equal(req.body.messages[1].content[0].signature, 'signed');
  assert.equal(req.body.messages[2].content.length, 2);
  assert.equal(req.body.messages[2].content[0].content[1].type, 'image');
});
test('Gemini preserves exact signed functionCall parts and returns native file inputs', () => {
  const parts = [
    {
      functionCall: { name: 'read_drawing', args: {}, id: 'native-id' },
      thoughtSignature: 'must-survive',
    },
  ];
  const answer = parseProviderResponse('gemini', {
    candidates: [{ finishReason: 'STOP', content: { parts } }],
  });
  const req = providerRequest(
    settings('gemini'),
    [
      { role: 'user', text: 'Read', attachments: [pdf] },
      answer,
      {
        role: 'tool',
        call: answer.calls[0],
        result: { data: { revision: '1' }, images: [image] },
      },
    ],
    'skill',
    toolSpecs,
  );
  assert.equal(
    req.body.contents[0].parts[1].inlineData.mimeType,
    'application/pdf',
  );
  assert.equal(req.body.contents[1].parts, parts);
  assert.equal(req.body.contents[2].parts[0].functionResponse.id, 'native-id');
  assert.ok(req.body.tools[0].functionDeclarations[0].parametersJsonSchema);
});
test('Compatible mode preserves reasoning content and uses compatible tool wire format', () => {
  const message = {
    role: 'assistant',
    content: '',
    reasoning_content: 'opaque',
    tool_calls: [
      {
        id: 'x',
        type: 'function',
        function: { name: 'read_drawing', arguments: '{}' },
      },
    ],
  };
  const answer = parseProviderResponse('compatible', {
    choices: [{ message, finish_reason: 'tool_calls' }],
  });
  const request = providerRequest(
    settings('compatible'),
    [{ role: 'user', text: 'Read' }, answer],
    'skill',
    toolSpecs,
  );
  assert.equal(request.body.messages[2].reasoning_content, 'opaque');
  assert.equal(request.body.max_tokens, 1024);
});
test('truncated outputs are rejected before tool execution', () => {
  assert.throws(
    () =>
      parseProviderResponse('openai', {
        choices: [
          { finish_reason: 'length', message: { content: '', tool_calls: [] } },
        ],
      }),
    /output limit/,
  );
  assert.throws(
    () =>
      parseProviderResponse('anthropic', {
        stop_reason: 'max_tokens',
        content: [],
      }),
    /output limit/,
  );
  assert.throws(
    () =>
      parseProviderResponse('gemini', {
        candidates: [{ finishReason: 'MAX_TOKENS' }],
      }),
    /output limit/,
  );
});
test('auth stays out of bodies, errors and query strings; insecure remote endpoints fail', async () => {
  for (const provider of [
    'openai',
    'anthropic',
    'gemini',
    'compatible',
  ]) {
    const auth = byokAuth(provider, 'test-private-key');
    const transport = createTransport(
      settings(provider),
      auth,
      async (url, init) => {
        assert.ok(!url.includes('test-private-key'));
        assert.ok(!init.body.includes('test-private-key'));
        assert.ok(
          Object.values(init.headers).includes(
            provider === 'openai' ||
              provider === 'compatible'
              ? 'Bearer test-private-key'
              : 'test-private-key',
          ),
        );
        return new Response('{"secret":"test-private-key"}', { status: 401 });
      },
    );
    await assert.rejects(
      transport.complete([], 'skill', [], new AbortController().signal),
      (e) => /401/.test(e.message) && !e.message.includes('test-private-key'),
    );
  }
  assert.throws(
    () =>
      createTransport(
        { ...settings('openai'), endpoint: 'http://remote.test/v1' },
        byokAuth('openai', 'k'),
      ),
    /HTTPS/,
  );
});
test('session executes tools serially, returns failures to the model and continues the chat', async () => {
  const executed = [],
    session = new ChatSession('skill', toolSpecs, async (name) => {
      executed.push(name);
      if (name === 'read_drawing') throw new Error('retry me');
      return { data: { ok: true } };
    });
  let count = 0;
  const transport = {
    complete: async (messages) => {
      if (!count++) return { role: 'assistant', calls };
      assert.equal(messages.filter((m) => m.role === 'tool').length, 2);
      assert.equal(messages[2].result.error, true);
      return { role: 'assistant', text: 'Done' };
    },
  };
  await session.send(
    'Draw',
    [],
    transport,
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(executed, ['read_drawing', 'render_drawing']);
  assert.equal(session.messages.at(-1).text, 'Done');
});
test('Stop answers pending tool calls without executing mutations, and conversation can resume', async () => {
  const abort = new AbortController();
  let executions = 0;
  const session = new ChatSession('skill', toolSpecs, async () => {
    executions++;
    abort.abort();
    return { data: {} };
  });
  await assert.rejects(
    session.send(
      'Draw',
      [],
      { complete: async () => ({ role: 'assistant', calls }) },
      abort.signal,
      () => {},
    ),
    /Stopped/,
  );
  assert.equal(executions, 1);
  assert.equal(session.messages.filter((m) => m.role === 'tool').length, 2);
  assert.equal(session.messages.at(-1).result.error, true);
  await session.send(
    'Continue',
    [],
    { complete: async () => ({ role: 'assistant', text: 'Resumed' }) },
    new AbortController().signal,
    () => {},
  );
  assert.equal(session.messages.at(-1).text, 'Resumed');
});
test('native symbol schema validates examples and catches missing resources, off-grid and duplicate pins', () => {
  assert.deepEqual(native('validate_component', { definition: symbol }), {
    valid: true,
    errors: [],
  });
  const broken = symbol
    .replace('pos="16,0"', 'pos="16.5,0"')
    .replace('number="2"', 'number="1"');
  const result = native('validate_component', { definition: broken });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'pin_off_grid'));
  assert.ok(result.errors.some((e) => e.code === 'duplicate_pin_number'));
  assert.equal(
    native('validate_component', {
      definition: symbol.replace(/<STYLE[\s\S]*?<\/STYLE>/, ''),
    }).valid,
    false,
  );
  assert.equal(
    native('validate_component', { definition: '<TinyCAD><FONTS/></TinyCAD>' })
      .valid,
    false,
  );
});
test('native tools reject hostile XML and unsupported remote artwork', () => {
  for (const definition of [
    '<!DOCTYPE TinyCAD [<!ENTITY x SYSTEM "file:///tmp/secret">]><TinyCAD/>',
    '<TinyCAD><IMAGE/></TinyCAD>',
    '<TinyCAD xmlns="https://remote.test"><WIRE a="0,0" b="2,0"/></TinyCAD>',
  ])
    assert.equal(native('validate_component', { definition }).valid, false);
  assert.equal(
    native('validate_component', {
      definition: `<TinyCAD>${'<A>'.repeat(30)}${'</A>'.repeat(30)}</TinyCAD>`,
    }).valid,
    false,
  );
});
test('compact IC generation returns complete editable artwork, verified pairings and SVG', () => {
  const pins = Array.from({ length: 8 }, (_, i) => ({
    name: `P${i + 1}`,
    number: String(i + 1),
    side: i < 4 ? 'west' : 'east',
    order: (i % 4) + 1,
    electricalType: 4,
  }));
  const result = native('create_ic_symbol', { name: 'Test IC', pins });
  assert.equal(result.pinPitch, 2);
  assert.equal(result.pinLength, 20);
  assert.ok(result.width < 40 && result.height < 40);
  assert.match(result.svg, /<svg/);
  assert.equal(result.pins[1].y - result.pins[0].y, 2);
  assert.deepEqual(
    result.pins.map((p) => [p.number, p.name]).sort(),
    pins.map((p) => [p.number, p.name]).sort(),
  );
  assert.equal(
    native('validate_component', { definition: result.definition }).valid,
    true,
  );
});
test('native drawing read/validate/render/netlist and add/edit operate on real native XML', () => {
  assert.equal(
    native('validate_drawing', { definition: drawing }).structurallyValid,
    true,
  );
  assert.match(native('render_drawing', { definition: drawing }).svg, /<line/);
  assert.equal(
    native('inspect_drawing', { definition: drawing }).metadata[0].name,
    'Main',
  );
  assert.ok(
    Array.isArray(native('read_netlist', { definition: drawing }).nets),
  );
  const added = native('add_to_drawing', {
    definition: drawing,
    sheet: 1,
    fragment: '<WIRE a="30,10" b="50,10"/>',
  });
  assert.equal(native('inspect_drawing', added).metadata[0].items.length, 2);
  const edited = native('edit_drawing', {
    ...added,
    edits: [{ find: '<NAME>Main</NAME>', replace: '<NAME>Updated</NAME>' }],
  });
  assert.equal(native('inspect_drawing', edited).metadata[0].name, 'Updated');
  assert.throws(
    () =>
      native('edit_drawing', {
        definition: drawing,
        edits: [{ find: 'not present', replace: 'bad' }],
      }),
    /exactly once/,
  );
});
test('native auto-tidy uses the actual optimizer and verifies serialization connectivity', () => {
  const result = native('auto_tidy_drawing', {
    definition: drawing,
    phases: ['net-labels'],
    maxEvaluations: 10,
    maxPasses: 1,
  });
  assert.equal(result.connectivityPreserved, true);
  assert.equal(result.serializationConnectivityPreserved, true);
  assert.equal(result.serializationPhysicalConnectivityPreserved, true);
  assert.match(result.definition, /TinyCADSheets/);
});

test('drawing validation accepts persisted SPICE document and simulation sheet identities', () => {
  const setup = loadComponent('src/simulation/contracts.ts', {}).defaultSetup();
  const definition = '<TinyCADSheets><DSNIDENTITY id="document-1"/>' +
    '<TinyCAD id="sheet-1"><NAME>Main</NAME></TinyCAD>' +
    '<SimulationSheet id="simulation-1" name="Transient" version="1">' + JSON.stringify(setup) + '</SimulationSheet>' +
    '</TinyCADSheets>';
  const result = native('validate_drawing', { definition });
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(native('validate_drawing', {
    definition: definition.replace('id="document-1"', 'unexpected="document-1"'),
  }).valid, false);
});

test('thinking controls use each provider’s native parameters and default sends no override', () => {
  const request = (provider, level, extra = {}) =>
    providerRequest(
      {
        ...settings(provider),
        maxTokens: 8192,
        thinkingLevel: level,
        ...extra,
      },
      [],
      'skill',
      [],
    ).body;
  assert.equal(request('openai', 'high').reasoning_effort, 'high');
  assert.equal(request('compatible', 'low').reasoning_effort, 'low');
  assert.equal(request('openai', 'default').reasoning_effort, undefined);
  assert.deepEqual(request('anthropic', 'high').thinking, { type: 'adaptive' });
  assert.deepEqual(request('anthropic', 'high').output_config, {
    effort: 'high',
  });
  assert.deepEqual(
    request('anthropic', 'budget', { thinkingBudget: 2048 }).thinking,
    { type: 'enabled', budget_tokens: 2048 },
  );
  assert.deepEqual(request('gemini', 'high').generationConfig.thinkingConfig, {
    thinkingLevel: 'high',
  });
  assert.deepEqual(
    request('gemini', 'budget', { thinkingBudget: 2048 }).generationConfig
      .thinkingConfig,
    { thinkingBudget: 2048 },
  );
  assert.throws(
    () => request('anthropic', 'budget', { thinkingBudget: 8192 }),
    /less than/,
  );
  assert.throws(() => request('gemini', 'max'), /Unsupported/);
});
test('model lists use authenticated provider endpoints, pagination and Gemini capability filtering', async () => {
  const urls = [];
  const models = await listProviderModels(
    settings('gemini'),
    byokAuth('gemini', 'key'),
    new AbortController().signal,
    async (url, init) => {
      urls.push(url);
      assert.equal(init.headers['x-goog-api-key'], 'key');
      return new Response(
        JSON.stringify(
          urls.length === 1
            ? {
                models: [
                  {
                    name: 'models/gemini-chat',
                    supportedGenerationMethods: ['generateContent'],
                  },
                  {
                    name: 'models/embedding',
                    supportedGenerationMethods: ['embedContent'],
                  },
                ],
                nextPageToken: 'next',
              }
            : { models: [{ name: 'models/gemini-other' }] },
        ),
        { status: 200 },
      );
    },
  );
  assert.deepEqual(models, ['gemini-chat', 'gemini-other']);
  assert.match(urls[1], /pageToken=next/);
});
test('generated symbols insert into an existing circuit with collision-free resources and native hotspots', () => {
  const pins = [
    { name: 'IN', number: '1', side: 'west', order: 1 },
    { name: 'OUT', number: '2', side: 'east', order: 1 },
  ];
  const generated = native('create_ic_symbol', { name: 'Custom IC', pins });
  const placed = native('insert_symbol', {
    definition: drawing,
    componentDefinition: generated.definition,
    sheet: 1,
    name: 'Custom IC',
    reference: 'U1',
    x: 50,
    y: 40,
  });
  assert.ok(placed.definition.includes('<WIRE'));
  assert.equal(placed.pins.length, 2);
  assert.ok(
    placed.pins.every(
      (pin) => Number.isInteger(pin.x) && Number.isInteger(pin.y),
    ),
  );
  const second = native('insert_symbol', {
    definition: placed.definition,
    componentDefinition: generated.definition,
    sheet: 1,
    name: 'Custom IC',
    reference: 'U2',
    x: 100,
    y: 40,
  });
  assert.equal(
    native('validate_drawing', { definition: second.definition })
      .structurallyValid,
    true,
  );
  assert.equal(
    native('inspect_drawing', second).metadata[0].items.filter(
      (i) => i.type === 'symbol',
    ).length,
    2,
  );
  assert.throws(
    () =>
      native('insert_symbol', {
        definition: placed.definition,
        componentDefinition: generated.definition,
        sheet: 1,
        name: 'Custom IC',
        reference: 'U1',
        x: 50,
        y: 40,
      }),
    /Reference already/,
  );
});

test('ChatGPT model lists expose only Sol, Luna and Astra families', async () => {
  const ids = [
    'gpt-6.1-sol',
    'gpt-6-luna',
    'gpt-6-astra',
    'gpt-6-sol-2026-09-01',
    'gpt-6.1-terra',
    'gpt-4o',
    'text-embedding-3-small',
  ];
  const result = await listProviderModels(
    settings('openai'),
    byokAuth('openai', 'key'),
    new AbortController().signal,
    async () =>
      new Response(JSON.stringify({ data: ids.map((id) => ({ id })) })),
  );
  assert.deepEqual(result, [
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-6-sol-2026-09-01',
    'gpt-6.1-sol',
  ]);
});
test('Compatible completions go directly to the configured endpoint', async () => {
  const urls = [];
  const transport = createTransport(
    { ...settings('compatible'), endpoint: 'https://llm.example/custom/v1' },
    byokAuth('compatible', 'private-key'),
    async (url, init) => {
      urls.push(url);
      assert.equal(init.headers.Authorization, 'Bearer private-key');
      assert.equal(init.credentials, 'omit');
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Done' } }],
        }),
      );
    },
  );
  await transport.complete(
    [{ role: 'user', text: 'Hello' }],
    'skill',
    [],
    new AbortController().signal,
  );
  assert.deepEqual(urls, ['https://llm.example/custom/v1/chat/completions']);
});
test('changing a model preserves portable conversation and reconstructs tool calls without old signatures', async () => {
  const session = new ChatSession('skill', [], async () => ({ data: {} }));
  session.messages = [
    { role: 'user', text: 'Read' },
    {
      role: 'assistant',
      native: [{ type: 'thinking', signature: 'old-model' }],
      calls: [calls[0]],
    },
    { role: 'tool', call: calls[0], result: { data: {} } },
  ];
  session.changeModel();
  assert.equal(session.messages.length, 3);
  assert.ok(session.messages.every((m) => !m.native));
  const request = providerRequest(
    settings('anthropic'),
    session.messages,
    'skill',
    [],
  );
  assert.equal(request.body.messages[1].content[0].type, 'tool_use');
  assert.equal(request.body.messages[1].content[0].id, 'call-1');
});

test('TinyCAD URLs depend only on browser versus Electron, never the page hostname', () => {
  const original = process.env.TARGET_SYSTEM;
  const loadRouting = (target) => {
    process.env.TARGET_SYSTEM = target;
    try {
      return loadComponent('src/io/apiServer.ts', {});
    } finally {
      if (original === undefined) delete process.env.TARGET_SYSTEM;
      else process.env.TARGET_SYSTEM = original;
    }
  };
  for (const target of ['filesystem', 'google']) {
    const routing = loadRouting(target);
    assert.equal(routing.apiServer, '');
    assert.equal(
      routing.tinycadUrl(
        'https://www.tinycad.net/api/search/search?key=resistor&page=1',
      ),
      '/api/search/search?key=resistor&page=1',
    );
    assert.equal(
      routing.tinycadUrl('https://tinycad.net/Online/Home#help'),
      '/Online/Home#help',
    );
    assert.equal(
      routing.tinycadUrl('/api/search/copy?id=1'),
      '/api/search/copy?id=1',
    );
    assert.equal(
      routing.tinycadUrl('https://docs.tinycad.net/v4/'),
      'https://docs.tinycad.net/v4/',
    );
    for (const origin of [
      'http://localhost:1235',
      'https://editor.example:8443',
      'https://online.tinycad.net',
    ]) {
      assert.equal(
        new URL(routing.tinycadUrl('/api/search/search?key=resistor'), origin)
          .origin,
        origin,
      );
    }
  }
  const desktop = loadRouting('electron');
  assert.equal(desktop.apiServer, 'https://www.tinycad.net');
  assert.equal(
    desktop.tinycadUrl('/api/search/copy?id=1'),
    'https://www.tinycad.net/api/search/copy?id=1',
  );
});

test('output-limit recovery retries identical input with more room and never executes truncated tool calls', async () => {
  const requests = [],
    executed = [];
  const transport = createTransport(
    { ...settings('openai'), maxTokens: 16384 },
    byokAuth('openai', 'key'),
    async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      if (requests.length === 1)
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'incomplete',
                      function: {
                        name: 'set_drawing',
                        arguments: '{"definition":',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      if (requests.length === 2)
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
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
          }),
        );
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'Done' },
            },
          ],
        }),
      );
    },
  );
  const session = new ChatSession('skill', toolSpecs, async (name) => {
    executed.push(name);
    return { data: {} };
  });
  await session.send(
    'Read my drawing',
    [],
    transport,
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(
    requests.map((r) => r.max_completion_tokens),
    [16384, 32768, 32768],
  );
  assert.deepEqual(requests[0].messages, requests[1].messages);
  assert.deepEqual(executed, ['read_drawing']);
  assert.equal(
    session.messages[0].progress.filter((event) => event.kind === 'retry')
      .length,
    1,
  );
  assert.equal(session.messages[0].status, 'complete');
  assert.equal(session.messages.at(-1).text, 'Done');
});
test('persistent output limits stop after bounded recovery and preserve tool safety', async () => {
  const budgets = [];
  let calls = 0;
  const transport = createTransport(
    { ...settings('openai'), maxTokens: 16384 },
    byokAuth('openai', 'key'),
    async (_url, init) => {
      budgets.push(JSON.parse(init.body).max_completion_tokens);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: { role: 'assistant', content: 'partial' },
            },
          ],
        }),
      );
    },
  );
  const session = new ChatSession('skill', toolSpecs, async () => {
    calls++;
    return { data: {} };
  });
  await assert.rejects(
    session.send(
      'Build',
      [],
      transport,
      new AbortController().signal,
      () => {},
    ),
    /smaller step or a lower thinking level/,
  );
  assert.deepEqual(budgets, [16384, 32768, 65536]);
  assert.equal(calls, 0);
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].status, 'error');
});
test('reasoning supplied by providers stays separate from user-facing text', () => {
  const openai = parseProviderResponse('compatible', {
    choices: [
      {
        message: {
          role: 'assistant',
          reasoning_content: 'Provider reasoning',
          content: 'Final answer',
        },
      },
    ],
  });
  assert.equal(openai.reasoning, 'Provider reasoning');
  assert.equal(openai.text, 'Final answer');
  const claude = parseProviderResponse('anthropic', {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: 'Claude thinking', signature: 'opaque' },
      { type: 'text', text: 'Ready' },
    ],
  });
  assert.equal(claude.reasoning, 'Claude thinking');
  assert.equal(claude.text, 'Ready');
  const gemini = parseProviderResponse('gemini', {
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            {
              thought: true,
              text: 'Gemini summary',
              thoughtSignature: 'opaque',
            },
            { text: 'Ready' },
          ],
        },
      },
    ],
  });
  assert.equal(gemini.reasoning, 'Gemini summary');
  assert.equal(gemini.text, 'Ready');
});
test('vision payloads retain the actual image while omitting duplicate SVG text', () => {
  const messages = [
    { role: 'user', text: 'Inspect' },
    { role: 'assistant', calls: [calls[0]] },
    {
      role: 'tool',
      call: calls[0],
      result: {
        data: {
          definition: 'native XML',
          svg: '<svg>large duplicate</svg>',
          valid: true,
        },
        images: [image],
      },
    },
  ];
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    const request = providerRequest(
      settings(provider),
      messages,
      'skill',
      toolSpecs,
    );
    assert.ok(!JSON.stringify(request.body).includes('large duplicate'));
    assert.ok(JSON.stringify(request.body).includes(image.data));
    assert.ok(JSON.stringify(request.body).includes('native XML'));
  }
});

const { latestModels, modelVersion, modelOutputTokens } = loadComponent(
  'src/chat/models.ts',
  {},
);
const { readProviderStream } = loadComponent('src/chat/stream.ts', {});
const sse = (chunks) =>
  new Response(
    chunks
      .map(
        (chunk) =>
          `data: ${
            typeof chunk === 'string' ? chunk : JSON.stringify(chunk)
          }\n\n`,
      )
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
test('latest models include every family at the highest numeric version', () => {
  assert.deepEqual(
    latestModels([
      'gpt-6.9-sol',
      'gpt-6.10-sol',
      'gpt-6.10-astra',
      'gpt-6.10-luna',
      'gpt-6-sol',
    ]),
    ['gpt-6.10-sol', 'gpt-6.10-astra', 'gpt-6.10-luna'],
  );
  assert.deepEqual(
    latestModels([
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
    ]),
    ['claude-sonnet-4-6', 'claude-opus-4-6'],
  );
  assert.deepEqual(modelVersion('claude-sonnet-4-20250514'), [4, 0]);
  assert.equal(modelOutputTokens('openai', 'gpt-6.1-sol'), 128000);
  assert.equal(modelOutputTokens('compatible', 'custom-model'), 65536);
});
test('OpenAI streaming joins fragmented tools and reasoning, and rejects incomplete streams', async () => {
  const events = [];
  const chunks = [
    { choices: [{ delta: { reasoning_content: 'Inspecting the diagram…' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'read',
                function: { name: 'read_drawing', arguments: '{' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    },
    '[DONE]',
  ];
  const source = await sse(chunks).text();
  const bytes = new TextEncoder().encode(source);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
  );
  const body = await readProviderStream(
    response,
    'compatible',
    new AbortController().signal,
    (event) => events.push(event),
  );
  const answer = parseProviderResponse('compatible', body);
  assert.equal(answer.reasoning, 'Inspecting the diagram…');
  assert.deepEqual(answer.calls, [
    { id: 'read', name: 'read_drawing', arguments: {} },
  ]);
  assert.ok(events.some((event) => event.kind === 'reasoning'));
  assert.ok(events.some((event) => event.kind === 'tool-draft'));
  await assert.rejects(
    readProviderStream(
      sse(chunks.slice(0, 2)),
      'compatible',
      new AbortController().signal,
    ),
    /before the reply was complete/,
  );
});
test('Anthropic streaming retains signatures and retries truncated tool JSON safely', async () => {
  const chunks = [
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Inspect' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'signed' },
    },
    {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'a',
        name: 'read_drawing',
        input: {},
      },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{' },
    },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    { type: 'message_stop' },
  ];
  const body = await readProviderStream(
    sse(chunks),
    'anthropic',
    new AbortController().signal,
  );
  assert.equal(body.content[0].signature, 'signed');
  assert.throws(
    () => parseProviderResponse('anthropic', body),
    /output limit/i,
  );
});
test('Gemini streaming preserves signed function parts and exposed thoughts', async () => {
  const body = await readProviderStream(
    sse([
      {
        candidates: [
          { content: { parts: [{ text: 'Inspect', thought: true }] } },
        ],
      },
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'read_drawing', args: {} },
                  thoughtSignature: 'signed',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ]),
    'gemini',
    new AbortController().signal,
  );
  const answer = parseProviderResponse('gemini', body);
  assert.equal(answer.native[1].thoughtSignature, 'signed');
  assert.equal(answer.reasoning, 'Inspect');
  assert.equal(answer.calls[0].name, 'read_drawing');
});
test('stream cancellation stops reading without returning partial tool calls', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = readProviderStream(response, 'openai', abort.signal);
  abort.abort();
  await assert.rejects(pending, /Stopped/);
  assert.equal(cancelled, true);
});


const chatgptModule = loadComponent('src/chat/chatgpt.ts', {
  './response-output': loadComponent('src/chat/response-output.ts', {}),
  './citations': loadComponent('src/chat/citations.ts', {}),
  '../io/apiServer': { isElectron: false },
  './providers': {
    toolPayload: loadComponent('src/chat/providers.ts', {
      './thinking': thinkingModule,
    }).toolPayload,
  },
  './thinking': thinkingModule,
  './errors': loadComponent('src/chat/errors.ts', {}),
});
test('ChatGPT plan request uses stateless Responses, namespaced local tools, files and exact signed history', () => {
  const native = {
    responses: [
      { type: 'reasoning', id: 'rs', encrypted_content: 'opaque', summary: [] },
      {
        type: 'function_call',
        name: 'render_drawing',
        namespace: 'tinycad',
        call_id: 'call',
        arguments: '{}',
      },
    ],
  };
  const body = chatgptModule.chatGPTRequest(
    { ...settings('openai'), thinkingLevel: 'high' },
    [
      { role: 'user', text: 'See this diagram', attachments: [image, pdf] },
      {
        role: 'assistant',
        native,
        calls: [{ id: 'call', name: 'render_drawing', arguments: {} }],
      },
      {
        role: 'tool',
        call: { id: 'call', name: 'render_drawing' },
        result: {
          data: { svg: 'huge-duplicate', revision: '1' },
          images: [image],
        },
      },
    ],
    'TinyCAD skill',
    toolSpecs,
  );
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  for (const key of [
    'max_output_tokens',
    'previous_response_id',
    'conversation',
    'background',
    'temperature',
    'truncation',
  ])
    assert.equal(key in body, false);
  assert.equal(body.instructions, 'TinyCAD skill');
  assert.equal(body.reasoning.effort, 'high');
  assert.equal(body.tools[0].type, 'namespace');
  assert.equal(body.tools[0].name, 'tinycad');
  assert.ok(body.tools.some((tool) => tool.type === 'web_search'));
  assert.ok(body.include.includes('web_search_call.action.sources'));
  assert.deepEqual(
    body.tools[0].tools.map((tool) => tool.name),
    toolSpecs.map((tool) => tool.name),
  );
  assert.equal(
    body.input[0].content[1].image_url,
    'data:image/png;base64,aGVsbG8=',
  );
  assert.equal(
    body.input[0].content[2].file_data,
    'data:application/pdf;base64,aGVsbG8=',
  );
  assert.deepEqual(body.input[1], native.responses[0]);
  assert.equal(body.input[3].call_id, 'call');
  assert.equal(
    body.input[3].output[1].image_url,
    'data:image/png;base64,aGVsbG8=',
  );
  assert.ok(!body.input[3].output[0].text.includes('huge-duplicate'));
});
test('ChatGPT streamed tool calls run only after response.completed and preserve encrypted reasoning', async () => {
  const output = [
    {
      type: 'reasoning',
      id: 'rs',
      encrypted_content: 'opaque',
      summary: [{ type: 'summary_text', text: 'Check the circuit.' }],
    },
    {
      type: 'function_call',
      namespace: 'tinycad',
      name: 'read_drawing',
      call_id: 'call',
      arguments: '{}',
    },
  ];
  const events = [];
  const answer = await chatgptModule.readChatGPTResponse(
    sse([
      {
        type: 'response.reasoning_summary_text.delta',
        delta: 'Check the circuit.',
      },
      { type: 'response.output_item.added', item: output[1] },
      { type: 'response.completed', response: { status: 'completed', output } },
    ]),
    new AbortController().signal,
    (event) => events.push(event),
  );
  assert.equal(answer.reasoning, 'Check the circuit.');
  assert.equal(answer.calls[0].name, 'read_drawing');
  assert.deepEqual(answer.native.responses, output);
  assert.ok(events.some((event) => event.kind === 'reasoning'));
  await assert.rejects(
    chatgptModule.readChatGPTResponse(
      sse([{ type: 'response.output_item.added', item: output[1] }, '[DONE]']),
      new AbortController().signal,
    ),
    /before completing/,
  );
  await assert.rejects(
    chatgptModule.readChatGPTResponse(
      sse([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ ...output[1], namespace: 'untrusted' }],
          },
        },
      ]),
      new AbortController().signal,
    ),
    /unknown tool namespace/,
  );
});
test('a ChatGPT usage failure after partial output never executes tools or changes billing', async () => {
  let executions = 0;
  const session = new ChatSession('skill', toolSpecs, async () => {
    executions++;
    return { data: {} };
  });
  await assert.rejects(
    session.send(
      'Edit the circuit',
      [],
      {
        complete: (_messages, _system, _tools, signal, progress) =>
          chatgptModule.readChatGPTResponse(
            sse([
              {
                type: 'response.output_item.added',
                item: {
                  type: 'function_call',
                  name: 'set_drawing',
                  call_id: 'partial',
                  arguments: '{}',
                },
              },
              {
                type: 'response.failed',
                response: {
                  error: { code: 'subscription_sharing_usage_limit_exceeded' },
                },
              },
            ]),
            signal,
            progress,
          ),
      },
      new AbortController().signal,
      () => {},
    ),
    /Manage usage/,
  );
  assert.equal(executions, 0);
  assert.equal(session.messages[0].status, 'error');
});

const googleGemini = loadComponent('src/chat/gemini-google.ts', {
  '../io/apiServer': { isElectron: false },
});
function googleFixture(t, options = {}) {
  const savedWindow = globalThis.window;
  const scope = googleGemini.GEMINI_GOOGLE_SCOPE;
  const state = {
    signedIn: true,
    id: 'google-user',
    scopes: new Set(['https://www.googleapis.com/auth/drive.file']),
    token: 'private-google-token',
    expires: Date.now() + 3600000,
    grants: [],
    reloads: 0,
    ...options,
  };
  const listeners = new Set();
  const subscribe = (listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  };
  const response = () => ({
    access_token: state.token,
    expires_at: state.expires,
    scope: [...state.scopes].join(' '),
  });
  const user = {
    getId: () => state.id,
    getBasicProfile: () => ({ getEmail: () => 'google@example.test' }),
    hasGrantedScopes: (requested) => state.scopes.has(requested),
    getAuthResponse: response,
    grant: async (request) => {
      state.grants.push(request);
      if (state.decline) throw new Error('private-provider-error');
      state.scopes.add(scope);
    },
    reloadAuthResponse: async () => {
      state.reloads++;
      if (state.refreshGate) await state.refreshGate;
      state.token = 'renewed-google-token';
      state.expires = Date.now() + 3600000;
      return response();
    },
  };
  globalThis.window = {
    gapi: {
      auth2: {
        getAuthInstance: () => ({
          isSignedIn: { get: () => state.signedIn, listen: subscribe },
          currentUser: { get: () => user, listen: subscribe },
        }),
      },
    },
  };
  t.after(() => {
    globalThis.window = savedWindow;
  });
  return {
    state,
    user,
    notify: () => listeners.forEach((listener) => listener()),
  };
}
test('Gemini Google OAuth incrementally grants inference access on the existing Drive account and uses Bearer/project headers', async (t) => {
  const { state } = googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  assert.deepEqual(state.grants, [{ scope: googleGemini.GEMINI_GOOGLE_SCOPE }]);
  assert.ok(state.scopes.has('https://www.googleapis.com/auth/drive.file'));
  const headers = await connection.auth.headers(new AbortController().signal);
  assert.deepEqual(headers, {
    Authorization: 'Bearer private-google-token',
    'x-goog-user-project': 'my-cloud-project',
  });
  assert.equal(headers['x-goog-api-key'], undefined);
  assert.equal(connection.email, 'google@example.test');
  connection.disconnect();
  await assert.rejects(
    connection.auth.headers(new AbortController().signal),
    /Reconnect Gemini/,
  );
  assert.equal(
    state.signedIn,
    true,
    'Disconnecting chat leaves Drive signed in',
  );
});
test('Gemini OAuth refresh is serialized and rejects account changes before sending a token', async (t) => {
  const { state } = googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  state.expires = 1;
  const [a, b] = await Promise.all([
    connection.auth.headers(new AbortController().signal),
    connection.auth.headers(new AbortController().signal),
  ]);
  assert.equal(state.reloads, 1);
  assert.equal(a.Authorization, 'Bearer renewed-google-token');
  assert.deepEqual(a, b);
  state.id = 'different-account';
  await assert.rejects(
    connection.auth.headers(new AbortController().signal),
    /account changed/,
  );
});
test('denied Gemini consent and invalid projects never enable a connection', async (t) => {
  const { state } = googleFixture(t, { decline: true });
  await assert.rejects(
    googleGemini.connectGeminiGoogle(
      'my-cloud-project',
      new AbortController().signal,
    ),
    /cancelled or declined/,
  );
  assert.ok(state.scopes.has('https://www.googleapis.com/auth/drive.file'));
  await assert.rejects(
    googleGemini.connectGeminiGoogle(
      'bad\r\nheader',
      new AbortController().signal,
    ),
    /Cloud project/,
  );
});
test('Gemini OAuth token scopes are verified and sign-out notifications invalidate chat', async (t) => {
  const { state, user, notify } = googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  let invalidated = 0;
  const stop = googleGemini.watchGeminiGoogleAccount(
    connection,
    () => invalidated++,
  );
  state.signedIn = false;
  notify();
  assert.equal(invalidated, 1);
  await assert.rejects(
    connection.auth.headers(new AbortController().signal),
    /account changed or signed out/,
  );
  stop();
  notify();
  assert.equal(invalidated, 1);
  state.signedIn = true;
  user.getAuthResponse = () => ({
    access_token: 'identity-only',
    expires_at: Date.now() + 3600000,
    scope: 'openid email',
  });
  await assert.rejects(
    googleGemini.connectGeminiGoogle(
      'my-cloud-project',
      new AbortController().signal,
    ),
    /valid Gemini permission/,
  );
});
test('OAuth Gemini model discovery and streaming use the same credential path as tools and files', async (t) => {
  googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  const sent = [];
  const send = async (url, init) => {
    sent.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer private-google-token');
    assert.equal(init.headers['x-goog-user-project'], 'my-cloud-project');
    assert.equal(init.headers['x-goog-api-key'], undefined);
    if (url.endsWith('/models'))
      return Response.json({
        models: [
          {
            name: 'models/gemini-4-argon',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      });
    return sse([
      {
        candidates: [
          { content: { parts: [{ text: 'Ready' }] }, finishReason: 'STOP' },
        ],
      },
    ]);
  };
  assert.deepEqual(
    await listProviderModels(
      settings('gemini'),
      connection.auth,
      new AbortController().signal,
      send,
    ),
    ['gemini-4-argon'],
  );
  const reply = await createTransport(
    settings('gemini'),
    connection.auth,
    send,
  ).complete(
    [{ role: 'user', text: 'Read this', attachments: [image, pdf] }],
    'TinyCAD skill',
    toolSpecs,
    new AbortController().signal,
  );
  assert.equal(reply.text, 'Ready');
  assert.match(sent[1].url, /streamGenerateContent\?alt=sse$/);
  const body = JSON.parse(sent[1].init.body);
  assert.equal(body.contents[0].parts[1].inlineData.data, image.data);
  assert.equal(
    body.contents[0].parts[2].inlineData.mimeType,
    'application/pdf',
  );
  assert.ok(
    body.tools[0].functionDeclarations.some(
      (tool) => tool.name === 'edit_drawing',
    ),
  );
});
test('Gemini OAuth permission failures identify project setup and never suggest a manual model workaround', async (t) => {
  googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  await assert.rejects(
    listProviderModels(
      settings('gemini'),
      connection.auth,
      new AbortController().signal,
      async () => new Response('private-provider-body', { status: 403 }),
    ),
    /Enable the Generative Language API/,
  );
  await assert.rejects(
    createTransport(
      settings('gemini'),
      connection.auth,
      async () => new Response('', { status: 401 }),
    ).complete(
      [{ role: 'user', text: 'Hello' }],
      'skill',
      [],
      new AbortController().signal,
    ),
    /Reconnect your Google account/,
  );
});

test('stopping during Gemini OAuth renewal returns promptly and keeps the Drive session intact', async (t) => {
  const { state } = googleFixture(t);
  const connection = await googleGemini.connectGeminiGoogle(
    'my-cloud-project',
    new AbortController().signal,
  );
  let finish;
  state.expires = 1;
  state.refreshGate = new Promise((resolve) => {
    finish = resolve;
  });
  const abort = new AbortController();
  const pending = connection.auth.headers(abort.signal);
  abort.abort();
  await assert.rejects(pending, /expired|Reconnect|abort|Stopped/i);
  assert.equal(state.signedIn, true);
  finish();
});

test('connection defaults preserve an available model and otherwise select the latest Sol or catalog version', () => {
  const { defaultModel } = loadComponent('src/chat/models.ts', {});
  const catalog = ['gpt-6.1-astra', 'gpt-6-sol', 'gpt-6.1-luna', 'gpt-6.1-sol'];
  assert.equal(defaultModel(catalog), 'gpt-6.1-sol');
  assert.equal(defaultModel(catalog, 'gpt-6-sol'), 'gpt-6-sol');
  assert.equal(defaultModel(catalog, 'removed-model'), 'gpt-6.1-sol');
  assert.equal(
    defaultModel(['gemini-3.1-pro', 'gemini-4-argon']),
    'gemini-4-argon',
  );
  assert.equal(defaultModel(['gpt-6.1-luna', 'gpt-6-sol']), 'gpt-6.1-luna');
  assert.equal(defaultModel([]), '');
});

test('ChatGPT HTTP failure does not claim the model is responding and the activity records failure', async () => {
  const savedFetch = globalThis.fetch;
  const events = [];
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: 'invalid_stream',
          message: 'Upstream stream unavailable.',
        },
      },
      { status: 502 },
    );
  try {
    const transport = chatgptModule.createChatGPTTransport(settings('openai'));
    await assert.rejects(
      transport.complete(
        [{ role: 'user', text: 'Hello' }],
        'skill',
        [],
        new AbortController().signal,
        (event) => events.push(event),
      ),
      /Upstream stream unavailable/,
    );
    assert.equal(
      events.some((event) => event.kind === 'response'),
      false,
    );
    const session = new ChatSession('skill', [], async () => ({ data: {} }));
    await assert.rejects(
      session.send(
        'Hello',
        [],
        transport,
        new AbortController().signal,
        () => {},
      ),
    );
    assert.match(
      session.messages[0].lastActivity,
      /Failed: Upstream stream unavailable/,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('hosted web search reports queries, retains search history and renders verified inline citations', async () => {
  const output = [
    {
      id: 'ws1',
      type: 'web_search_call',
      status: 'completed',
      action: {
        type: 'search',
        query: 'manufacturer transistor datasheet',
        sources: [
          { type: 'url', url: 'https://manufacturer.example/datasheet' },
        ],
      },
    },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: 'Verified pinout.',
          annotations: [
            {
              type: 'url_citation',
              start_index: 0,
              end_index: 16,
              url: 'https://manufacturer.example/datasheet',
              title: 'Datasheet',
            },
          ],
        },
      ],
    },
  ];
  const events = [
    { type: 'response.web_search_call.searching' },
    { type: 'response.output_item.done', item: output[0] },
    { type: 'response.completed', response: { status: 'completed', output } },
  ];
  const progress = [];
  const reply = await chatgptModule.readChatGPTResponse(
    new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
    new AbortController().signal,
    (event) => progress.push(event),
  );
  assert.match(
    reply.text,
    /\[1\]\(https:\/\/manufacturer.example\/datasheet\)/,
  );
  assert.equal(reply.calls.length, 0);
  assert.equal(reply.webSearches.length, 1);
  assert.deepEqual(reply.native.responses, output);
  assert.ok(
    progress.some(
      (event) =>
        event.kind === 'web-search' &&
        event.text.includes('manufacturer transistor datasheet'),
    ),
  );
  const request = chatgptModule.chatGPTRequest(
    settings('openai'),
    [reply],
    'instructions',
    toolSpecs,
  );
  assert.deepEqual(request.input, output);
  const { citedText } = loadComponent('src/chat/citations.ts', {});
  assert.equal(
    citedText({
      text: 'Fact',
      annotations: [
        {
          type: 'url_citation',
          start_index: 0,
          end_index: 4,
          url: 'javascript:alert(1)',
        },
      ],
    }),
    'Fact',
  );
});

test('session refreshes mode-specific instructions for every tool round', async () => {
  let mode = 'drawing';
  const seen = [];
  const session = new ChatSession(
    () => `current mode: ${mode}`,
    toolSpecs,
    async () => {
      mode = 'library';
      return { data: {} };
    },
  );
  await session.send(
    'edit',
    [],
    {
      complete: async (messages, system) => {
        seen.push(system);
        return seen.length === 1
          ? {
              role: 'assistant',
              calls: [{ id: 'inspect', name: 'read_metadata', arguments: {} }],
            }
          : { role: 'assistant', text: 'done' };
      },
    },
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(seen, ['current mode: drawing', 'current mode: library']);
});

test('an empty ChatGPT completion reports an issue instead of silently claiming success', async () => {
  const response = new Response(
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: { status: 'completed', output: [] },
    })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
  await assert.rejects(
    chatgptModule.readChatGPTResponse(response, new AbortController().signal),
    /empty reply.*No tools were executed/,
  );
});

test('local Ollama uses the OpenAI tool wire format without an API key and rejects remote URLs', async () => {
  const local = {
    ...settings('ollama'),
    endpoint: 'http://localhost:11434/v1',
    thinkingLevel: 'medium',
  };
  const auth = byokAuth('ollama', '');
  assert.deepEqual(await auth.headers(new AbortController().signal), {});
  const transport = createTransport(local, auth, async (url, init) => {
    assert.equal(url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(init.headers.Authorization, undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.reasoning_effort, 'medium');
    assert.ok(
      body.tools.some((tool) => tool.function.name === 'read_metadata'),
    );
    return Response.json({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'local-call',
                type: 'function',
                function: { name: 'read_metadata', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
  });
  const reply = await transport.complete(
    [{ role: 'user', text: 'Read my circuit' }],
    'TinyCAD instructions',
    toolSpecs,
    new AbortController().signal,
  );
  assert.equal(reply.calls[0].name, 'read_metadata');
  assert.throws(
    () =>
      createTransport(
        { ...local, endpoint: 'https://remote.example/v1' },
        auth,
      ),
    /localhost Ollama/,
  );
});

test('ChatGPT preserves completed streamed calls and encrypted reasoning when the final output snapshot is empty', async () => {
  const reasoning = {
    type: 'reasoning',
    id: 'rs-streamed',
    encrypted_content: 'opaque-reasoning',
    summary: [{ type: 'summary_text', text: 'Read the drawing.' }],
  };
  const call = {
    type: 'function_call',
    id: 'fc-streamed',
    namespace: 'tinycad',
    call_id: 'call-streamed',
    name: 'read_metadata',
    arguments: '{}',
    status: 'completed',
  };
  const reply = await chatgptModule.readChatGPTResponse(
    sse([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: reasoning.id },
      },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { ...call, arguments: '', status: 'in_progress' },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: call.id,
        output_index: 1,
        delta: '{}',
      },
      {
        type: 'response.function_call_arguments.done',
        item_id: call.id,
        output_index: 1,
        arguments: '{}',
      },
      { type: 'response.output_item.done', output_index: 1, item: call },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ]),
    new AbortController().signal,
  );
  assert.equal(reply.calls.length, 1);
  assert.deepEqual(reply.calls[0], {
    id: call.call_id,
    name: call.name,
    arguments: {},
  });
  assert.deepEqual(reply.native.responses, [reasoning, call]);
  const request = chatgptModule.chatGPTRequest(
    settings('openai'),
    [reply],
    'TinyCAD skill',
    toolSpecs,
  );
  assert.deepEqual(request.input, [reasoning, call]);
});

test('ChatGPT can finish arguments and text through their dedicated done events without a final snapshot', async () => {
  const call = {
    type: 'function_call',
    id: 'fc-args',
    namespace: 'tinycad',
    call_id: 'call-args',
    name: 'read_metadata',
    arguments: '',
    status: 'in_progress',
  };
  const reply = await chatgptModule.readChatGPTResponse(
    sse([
      { type: 'response.output_item.added', output_index: 0, item: call },
      {
        type: 'response.function_call_arguments.done',
        item_id: call.id,
        output_index: 0,
        arguments: '{}',
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ]),
    new AbortController().signal,
  );
  assert.equal(reply.calls[0].name, 'read_metadata');
  assert.equal(reply.native.responses[0].status, 'completed');
  const answer = await chatgptModule.readChatGPTResponse(
    sse([
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg-streamed',
          role: 'assistant',
          content: [],
        },
      },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        item_id: 'msg-streamed',
        content_index: 0,
        delta: 'Checked.',
      },
      {
        type: 'response.output_text.annotation.added',
        output_index: 0,
        item_id: 'msg-streamed',
        content_index: 0,
        annotation: {
          type: 'url_citation',
          start_index: 0,
          end_index: 8,
          title: 'Reference',
          url: 'https://manufacturer.example/datasheet',
        },
      },
      {
        type: 'response.output_text.done',
        output_index: 0,
        item_id: 'msg-streamed',
        content_index: 0,
        text: 'Checked.',
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ]),
    new AbortController().signal,
  );
  assert.match(answer.text, /Checked.*\[1\]\(https:/);
  assert.equal(answer.native.responses[0].id, 'msg-streamed');
  assert.equal(answer.native.responses[0].content[0].annotations.length, 1);
});

test('completed streamed tools still require successful response completion and never execute argument deltas', async () => {
  const call = {
    type: 'function_call',
    id: 'fc-incomplete',
    namespace: 'tinycad',
    call_id: 'call-incomplete',
    name: 'set_drawing',
    arguments: '{}',
    status: 'completed',
  };
  const variants = [
    [{ type: 'response.output_item.done', output_index: 0, item: call }],
    [
      { type: 'response.output_item.done', output_index: 0, item: call },
      {
        type: 'response.failed',
        response: {
          error: { code: 'subscription_sharing_usage_limit_exceeded' },
        },
      },
    ],
    [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...call, arguments: '', status: 'in_progress' },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: call.id,
        delta: '{}',
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ],
    [
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...call, arguments: '{' },
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ],
    [
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...call, namespace: 'unknown' },
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ],
  ];
  for (const events of variants) {
    let executions = 0;
    const session = new ChatSession('skill', toolSpecs, async () => {
      executions++;
      return { data: {} };
    });
    await assert.rejects(
      session.send(
        'Edit',
        [],
        {
          complete: (_messages, _system, _tools, signal) =>
            chatgptModule.readChatGPTResponse(sse(events), signal),
        },
        new AbortController().signal,
        () => {},
      ),
    );
    assert.equal(executions, 0);
  }
});

test('final response snapshots do not duplicate streamed tool calls', async () => {
  const call = {
    type: 'function_call',
    id: 'fc-once',
    namespace: 'tinycad',
    call_id: 'call-once',
    name: 'read_metadata',
    arguments: '{}',
    status: 'completed',
  };
  const reply = await chatgptModule.readChatGPTResponse(
    sse([
      { type: 'response.output_item.done', output_index: 0, item: call },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [call] },
      },
    ]),
    new AbortController().signal,
  );
  assert.equal(reply.calls.length, 1);
  assert.deepEqual(reply.native.responses, [call]);
});

test('bundled search scopes libraries, ranks names, paginates and reports incomplete searches', async () => {
  const { searchBundledSymbols } = loadComponent('src/chat/bundled-search.ts', {});
  const libraries = [{ id: 'a', name: 'Analog', path: 'a.tclib' }, { id: 'b', name: 'Boards', path: 'b.tclib' }];
  const loads = [];
  const entry = (NameID, Name, Description = '', Attributes = []) => ({ NameID, SymbolID: NameID, Name, Description, Attributes });
  const entries = [entry(1, 'Resistor'), entry(2, 'Trimmer resistor'), entry(3, 'Part', 'precision resistor', [{ AttName: 'SPICE', AttValue: 'model=R' }])];
  let fail = false;
  const source = {
    initialize: async () => {},
    getSnapshot: () => ({ catalog: { libraries }, error: '' }),
    readLibrary: async id => {
      loads.push(id);
      if (fail && id === 'b') throw new Error('Broken library');
      const names = id === 'a' ? entries : [entry(1, 'Resistor board')];
      return { names, symbols: names.map(n => ({ SymbolId: n.SymbolID, Data: '<TinyCAD/>' })) };
    },
  };
  const signal = new AbortController().signal;
  const all = await searchBundledSymbols(source, { query: 'resistor', pageSize: 2 }, signal);
  assert.equal(all.total, 4);
  assert.equal(all.hasMore, true);
  assert.equal(all.complete, true);
  assert.deepEqual(all.matches.map(m => m.entry.Name), ['Resistor', 'Trimmer resistor']);
  const page = await searchBundledSymbols(source, { query: 'resistor', page: 2, pageSize: 2 }, signal);
  assert.deepEqual(page.matches.map(m => m.entry.Name), ['Resistor board', 'Part']);
  loads.length = 0;
  const scoped = await searchBundledSymbols(source, { query: 'model=R', libraryId: 'a' }, signal);
  assert.deepEqual(loads, ['a']);
  assert.equal(scoped.matches[0].entry.Name, 'Part');
  await assert.rejects(searchBundledSymbols(source, { query: 'resistor', libraryId: 'invented' }, signal), /Unknown bundled library/);
  await assert.rejects(searchBundledSymbols(source, { query: ' ' }, signal), /search terms/);
  fail = true;
  const partial = await searchBundledSymbols(source, { query: 'resistor' }, signal);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.errors, [{ libraryId: 'b', message: 'Broken library' }]);
  assert.equal(partial.total, 3);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchBundledSymbols(source, { query: 'resistor' }, controller.signal), /abort/i);
});

test('runtime instructions inject bundled library names and search priority in both editor modes', () => {
  const { editorChatSystem } = loadComponent('src/chat/prompt.ts', { './skill/resources.json': resources });
  for (const library of [false, true]) {
    const prompt = editorChatSystem({ library, webSearch: false, bundledLibraries: [{ id: 'custom-bundle', name: 'My bundled parts', description: 'Local symbols' }] });
    assert.match(prompt, /search_bundled_symbols BEFORE the online search_symbols/);
    assert.match(prompt, /My bundled parts/);
    assert.match(prompt, /custom-bundle/);
    assert.match(prompt, library ? /CURRENT EDITOR MODE: LIBRARY/ : /CURRENT EDITOR MODE: DRAWING/);
  }
});


test('existing bundled passive pin labels are preserved while generated symbols require names', () => {
  const blank = symbol.replace(/(<PIN[^>]*>)[^<]*(<\/PIN>)/g, '$1$2');
  assert.equal(native('validate_component', { definition: blank }).valid, false);
  assert.equal(native('validate_component', { definition: blank, librarySymbol: true }).valid, true);
});
