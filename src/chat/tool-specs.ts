import { ToolSpec } from './types';
const str = (description = '', maxLength = 1048576) => ({
  type: 'string',
  description,
  maxLength,
});
const int = (minimum: number, maximum: number) => ({
  type: 'integer',
  minimum,
  maximum,
});
const choice = (...values: string[]) => ({ type: 'string', enum: values });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: unknown, maxItems = 256, minItems = 0) => ({
  type: 'array',
  items,
  maxItems,
  minItems,
});
const definition = str(
  'Complete native TinyCAD XML. Omit only for tools documenting current-editor support.',
);
const preview = { format: choice('png', 'svg', 'both'), pixels: int(64, 1024) };
const sheet = int(1, 16);
const baseRevision = str(
  'Exact revision returned by read_drawing. Read again after any user or tool edit.',
  64,
);
const spiceTarget = { sheet, reference: str('Exact placed component reference. Omit to use the one selected component.', 64) };
const spiceCatalogId = {
  modelId: str('Exact model ID from search_spice_models', 80),
  packId: str('Exact catalog pack ID', 64),
  revision: str('Exact pack revision from search_spice_models', 80),
};
const spec = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolSpec => ({ name, description, parameters: obj(properties, required) });
export const toolSpecs: ToolSpec[] = [
  spec('search_spice_models', 'Find bundled OpenJellyBean and circsim models by part number, alias or family. Supply a placed component reference for compatible results. Returns descriptions, exact model IDs, source links and terminal order.', {
    query: str('Part number, alias or device family', 200), ...spiceTarget,
    selected: { type: 'boolean', description: 'Restrict the search to the selected placed symbol.' },
    limit: int(1, 20),
  }),
  spec('inspect_spice_target', 'Inspect a placed symbol and optionally preview a catalog model mapping. Returns current drawing revision, active pins, existing SPICE template and any preverified or suggested pin mapping.', {
    ...spiceTarget, ...spiceCatalogId,
  }),
  spec('attach_spice_model', 'Attach a bundled SPICE model to a placed symbol in one undoable edit. Bundled symbols use verified mappings. Otherwise supply the reviewed symbol pin numbers in model-terminal order. Obtain explicit approval before replacing a custom template.', {
    ...spiceTarget, ...spiceCatalogId, baseRevision,
    pins: array(str('Placed symbol pin number in model terminal order', 32), 64, 1),
    parameters: array(obj({ name: str('Exact model parameter name', 30), value: str('SPICE quantity', 64) }, ['name', 'value']), 32),
    replaceExisting: { type: 'boolean', description: 'User approved replacement of their existing custom SPICE template.' },
  }, ['reference', 'sheet', 'modelId', 'packId', 'revision', 'baseRevision']),
  spec(
    'search_bundled_symbols',
    'Search bundled TinyCAD libraries FIRST, before online search or generating a symbol. Searches names, descriptions and attributes in all catalog libraries, including unselected ones; optionally restrict by libraryId. Returns reusable componentIds for get_symbol, place_component or add_library_components, with original SPICE attributes. Does not change library selection. Check errors before treating missing matches as absent.',
    {
      query: str(
        'Part name, family or generic kind; all words must match',
        200,
      ),
      libraryId: str(
        'Exact ID from the runtime bundled library catalog; omit to search all',
        128,
      ),
      page: int(1, 100),
      pageSize: int(1, 10),
    },
    ['query'],
  ),
  spec(
    'search_symbols',
    'Search the public TinyCAD library by exact part, family, generic kind, #label or @owner. Use search_bundled_symbols first, then search here if no suitable bundled part exists. Returns actual symbolId/nameId pairs and a componentId ready for direct placement; no XML needs copying.',
    {
      query: str('Search terms', 200),
      page: int(1, 100),
      pageSize: int(1, 10),
    },
    ['query'],
  ),
  spec(
    'get_symbol',
    'Fetch a symbol identified by search_bundled_symbols or search_symbols. Returns a reusable componentId, source metadata, validation and preview. Use componentId with place_component; XML is returned only with includeDefinition=true. Never invent IDs.',
    {
      componentId: str(
        'Handle returned by bundled/online search or a creation tool',
        128,
      ),
      includeDefinition: { type: 'boolean' },
      symbolId: int(1, 2147483647),
      nameId: int(1, 2147483647),
      pixels: int(64, 1024),
    },
    [],
  ),
  spec(
    'create_ic_symbol',
    'After library search finds no suitable part, generate a compact rectangular IC with verified physical pin mapping. Returns a componentId, dimensions, hotspots and previews. Next call place_component for a circuit or add_library_components for a library. XML is omitted unless includeDefinition=true.',
    {
      includeDefinition: { type: 'boolean' },
      reference: str('Reference prefix, e.g. U?', 32),
      name: str('Displayed component name', 128),
      pins: array(
        obj(
          {
            name: str('Verified pin function', 128),
            number: str('Physical pin number', 32),
            side: choice('north', 'south', 'east', 'west'),
            order: int(1, 256),
            electricalType: int(0, 11),
          },
          ['name', 'number', 'side', 'order'],
        ),
        256,
        1,
      ),
      ...preview,
    },
    ['name', 'pins'],
  ),
  spec(
    'validate_component',
    'Validate standalone TinyCAD symbol XML: schema/resources, duplicate physical pins, visible names, grid and geometry. Returns actionable errors; no document mutation.',
    { definition },
    ['definition'],
  ),
  spec(
    'render_component',
    'Validate and render standalone symbol XML as SVG and/or PNG. PNG images are delivered to your vision input and displayed to the user.',
    { definition, ...preview },
    ['definition'],
  ),
  spec(
    'validate_drawing',
    'Validate complete drawing XML and run native electrical DRC plus layout analysis. Omit definition to check the current circuit. Item IDs refer to this exact XML.',
    { definition },
  ),
  spec(
    'render_drawing',
    'Render a drawing sheet as SVG/PNG. Omit definition to see the current editor diagram. Page or content view; returns actual PNG vision input. No document mutation.',
    { definition, sheet, view: choice('page', 'content'), ...preview },
  ),
  spec(
    'auto_tidy_drawing',
    'For external XML only: run native layout and return updated XML without applying it. Prefer auto_layout on the current drawing to avoid copying XML.',
    {
      definition,
      sheet,
      disturbance: choice('low', 'medium', 'high'),
      phases: array(
        choice(
          'symbol-text',
          'net-labels',
          'routing',
          'placement',
          'compaction',
          'junctions',
        ),
        6,
      ),
      selectedIds: array(int(1, 2147483647)),
      lockedIds: array(int(1, 2147483647)),
      maxPasses: int(1, 8),
      maxEvaluations: int(1, 10000),
      seed: int(0, 1000000),
    },
  ),
  spec(
    'store_component',
    'Validate custom symbol artwork once and retain it by componentId. Use place_component or add_library_components next; do not repeat XML.',
    {
      name: str('Component name', 128),
      definition,
      reference: str('Reference prefix, e.g. D?', 32),
      description: str('', 1024),
    },
    ['name', 'definition'],
  ),
  spec(
    'place_component',
    'Place a search/generated componentId directly into the open circuit. Fetches/embeds library artwork internally and returns reference and pin hotspots. Defaults to a unique reference and an unused position when omitted. Supply x/y for the intended functional block. Atomic and undoable; never creates a download.',
    {
      componentId: str(
        'Exact componentId returned by search/get/create/store',
        128,
      ),
      baseRevision,
      sheet,
      name: str('', 128),
      reference: str(
        'Assigned reference, e.g. R1 (optional; otherwise allocated)',
        32,
      ),
      x: int(-10000, 10000),
      y: int(-10000, 10000),
      rotate: int(0, 7),
      attributes: array(
        obj({ name: str('', 128), value: str('', 1024) }, ['name', 'value']),
        64,
      ),
    },
    ['componentId', 'baseRevision'],
  ),
  spec(
    'auto_layout',
    'Run native auto-layout directly on the current circuit and apply it as one undoable edit. No XML input/output or download is needed. Returns layout quality, progress, connectivity checks and fresh revision. Continue incomplete cleanup using fresh metadata IDs.',
    {
      baseRevision,
      sheet,
      disturbance: choice('low', 'medium', 'high'),
      phases: array(
        choice(
          'symbol-text',
          'net-labels',
          'routing',
          'placement',
          'compaction',
          'junctions',
        ),
        6,
      ),
      selectedIds: array(int(1, 2147483647)),
      lockedIds: array(int(1, 2147483647)),
      maxPasses: int(1, 8),
      maxEvaluations: int(1, 10000),
      seed: int(0, 1000000),
    },
    ['baseRevision'],
  ),
  spec(
    'read_library',
    'Read the current library name, component IDs, names, metadata and revision without copying artwork. Includes the currently edited symbol and unsaved edits.',
    {},
  ),
  spec(
    'add_library_components',
    'Add one or many generated/fetched componentIds to the current library. Validates the entire batch before one undoable commit, preserves unsaved artwork, opens the last new component and keeps file identity. Use repeatedly for large libraries; no download.',
    {
      baseRevision,
      components: array(
        obj(
          {
            componentId: str('', 128),
            name: str('', 128),
            reference: str('', 32),
            description: str('', 1024),
          },
          ['componentId'],
        ),
        64,
        1,
      ),
    },
    ['baseRevision', 'components'],
  ),
  spec(
    'read_drawing',
    'Read the current native XML, revision, active sheet, mode, metadata, selection and item list. Always call before editing. This includes unsaved user changes.',
    {},
  ),
  spec(
    'read_netlist',
    'Generate current circuit connectivity directly from TinyCAD: sheets, reference designators, physical pins, labels and electrical types. Omit definition for current circuit.',
    { definition },
  ),
  spec(
    'read_metadata',
    'Read sheet titles, author, revision, organization, grid, page sizes, selected items and symbol/circuit editing mode.',
    {},
  ),
  spec(
    'insert_symbol',
    'Place a created or fetched standalone single-unit symbol into the current circuit. Pass create_ic_symbol/get_symbol definition as componentDefinition. Automatically embeds artwork and remaps resource IDs, keeps existing content, assigns the unique reference, and returns actual transformed pin hotspots in XML units for wiring. Atomic and undoable.',
    {
      baseRevision,
      sheet,
      componentDefinition: definition,
      componentId: str(
        'Prefer this retained component handle instead of copying XML',
        128,
      ),
      name: str('Component name', 128),
      reference: str('Unique assigned reference, e.g. U1', 32),
      x: int(-10000, 10000),
      y: int(-10000, 10000),
      rotate: int(0, 7),
      description: str('', 1024),
      attributes: array(
        obj({ name: str('', 128), value: str('', 1024) }, ['name', 'value']),
        64,
      ),
    },
    ['baseRevision', 'sheet', 'reference', 'x', 'y'],
  ),
  spec(
    'set_drawing',
    'Atomically create/replace the current drawing or current symbol artwork with complete native XML, preserving file identity and undo. Requires the read revision; rejects stale changes and structurally invalid XML. Circuit DRC errors are reported without being hidden.',
    { definition, baseRevision },
    ['definition', 'baseRevision'],
  ),
  spec(
    'edit_drawing',
    'Atomically edit current XML using exact find/replace patches. Each find must occur exactly once; all edits validate before committing. Preserve unrelated sheets, resources and connections. Undo restores the previous document.',
    {
      baseRevision,
      edits: array(
        obj({ find: str(), replace: str() }, ['find', 'replace']),
        128,
        1,
      ),
    },
    ['baseRevision', 'edits'],
  ),
  spec(
    'add_to_drawing',
    'Add native XML objects/resources to an existing sheet. Supply required SYMBOLDEF/FONT/STYLE/FILL resources with collision-free IDs, correct physical pins, wires to hotspots, and native POWER for rails. Preserves all existing circuit content, supports undo.',
    {
      baseRevision,
      sheet,
      fragment: str(
        'XML fragment containing complete native objects/resources',
      ),
    },
    ['baseRevision', 'sheet', 'fragment'],
  ),
  spec(
    'read_skill_reference',
    'Read the bundled TinyCAD skill, XML format, hidden-pin rules, MCP operation reference or examples. Read file-format before generating XML. Tools are local equivalents of MCP.',
    {
      path: choice(
        'SKILL.md',
        'references/file-format.md',
        'references/hidden-pins.md',
        'references/mcp.md',
        'references/editor-common.md',
        'references/editor-drawing.md',
        'references/editor-library.md',
        'assets/symbol.xml',
        'assets/drawing.dsn',
        'assets/ic-555.json',
        'assets/ic-555-visible.xml',
        'assets/ic-555-hidden-power.xml',
        'assets/diode-hidden-labels.xml',
        'assets/diode-hidden-pins.xml',
      ),
    },
    ['path'],
  ),
  spec(
    'export_file',
    'Only when the user explicitly requests a download: create a real downloadable native drawing (.dsn), standalone component XML, or SQLite .TCLib library. The file is attached in chat; never invent download links. Does not overwrite any existing file.',
    {
      kind: choice('drawing', 'component', 'library'),
      filename: str('Download filename', 128),
      definition,
      name: str('Library component name', 128),
      reference: str('Reference prefix, e.g. U?', 32),
      description: str('Function and verified package', 1024),
      attributes: array(
        obj({ name: str('', 128), value: str('', 1024) }, ['name', 'value']),
        64,
      ),
    },
    ['kind', 'filename'],
  ),
];

export function checkArguments(
  value: unknown,
  schema: any,
  path = 'arguments',
): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${path} must be an object.`);
    for (const key of schema.required || [])
      if (!(key in value)) throw new Error(`${path}.${key} is required.`);
    for (const [key, val] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, key))
        throw new Error(`Unknown ${path}.${key}.`);
      checkArguments(val, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > schema.maxItems
    )
      throw new Error(`${path} has invalid array size.`);
    value.forEach((v, i) => checkArguments(v, schema.items, `${path}[${i}]`));
  } else if (schema.type === 'integer') {
    if (
      !Number.isInteger(value) ||
      (value as number) < schema.minimum ||
      (value as number) > schema.maximum
    )
      throw new Error(
        `${path} must be an integer ${schema.minimum}–${schema.maximum}.`,
      );
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  } else if (schema.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.length > (schema.maxLength ?? Infinity) ||
      (schema.enum && !schema.enum.includes(value))
    )
      throw new Error(`${path} has an invalid string value.`);
  }
}
