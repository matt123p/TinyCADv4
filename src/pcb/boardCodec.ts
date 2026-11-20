import { digest } from '../util/sha256';
import { boardFormat, validateBoard } from './board';
import type { BoardDocument } from './board';
import type { BoardModelAsset, EmbeddedFootprint } from './boardAssets';
import {
  child,
  list,
  readBoardXml,
  record,
  writeBoardXml,
} from './boardXmlFields';
import type { BoardProfile, ContourEdge } from './contours';
import type { FootprintModel } from './footprintDetails';
import type { PadStack } from './padstack';

const maxBoardBytes = 128 * 1024 * 1024;
const maxAssetBytes = 32 * 1024 * 1024;
const maxTotalAssetBytes = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const point = record({ x: 'integer', y: 'integer' });
const vector = record({ x: 'number', y: 'number', z: 'number' });
const edge = record(
  { kind: 'string', clockwise: 'boolean' },
  {
    start: child('START', point),
    end: child('END', point),
    centre: child('CENTRE', point),
  },
);

const padShape = record(
  { kind: 'string', widthNm: 'integer' },
  {
    vertices: list('VERTICES', 'POINT', point),
    start: child('START', point),
    end: child('END', point),
  },
);
const surfaces = record(
  {},
  {
    top: child('TOP', padShape),
    bottom: child('BOTTOM', padShape),
  },
);
const drill = record(
  { plated: 'boolean', widthNm: 'integer' },
  {
    start: child('START', point),
    end: child('END', point),
  },
);
const stack = record(
  { id: 'string' },
  {
    copper: child('COPPER', surfaces),
    mask: child('MASK', surfaces),
    paste: child('PASTE', surfaces),
    drill: child('DRILL', drill),
  },
);

const graphic = record(
  {
    kind: 'string',
    layer: 'string',
    strokeNm: 'integer',
    filled: 'boolean',
    rotationMicrodegree: ['integer', 'rotation'],
    visible: 'boolean',
  },
  {
    start: child('START', point),
    mid: child('MID', point),
    end: child('END', point),
    center: child('CENTRE', point),
    points: list('POINTS', 'POINT', point),
    at: child('POSITION', point),
    sizeNm: child('TEXTSIZE', point),
    text: child('TEXT'),
    align: list('ALIGNMENT', 'ALIGN'),
  },
);
const model = record(
  { assetId: 'string', kind: 'string', source: 'string', quality: 'string' },
  {
    offsetNm: child('OFFSET', vector),
    rotationMicrodegree: child('ROTATION', vector),
    scale: child('SCALE', vector),
  },
);
const footprint = record(
  {
    id: 'string',
    revision: 'string',
    definitionDigest: 'string',
    name: 'string',
  },
  {
    pads: list(
      'PADS',
      'PAD',
      record(
        { id: 'string', label: 'string', padstackId: 'string' },
        {
          positionNm: child('POSITION', point),
        },
      ),
    ),
    graphics: list('GRAPHICS', 'GRAPHIC', graphic),
    models: list('MODELS', 'MODEL', model),
  },
);
const device = record(
  {
    id: 'string',
    revision: 'string',
    definitionDigest: 'string',
    packageName: 'string',
    packageSource: 'string',
    footprintId: 'string',
  },
  {
    signalIds: list('SIGNALS', 'SIGNAL'),
    assignments: list(
      'ASSIGNMENTS',
      'ASSIGN',
      record({ padId: 'string', kind: 'string', signalId: 'string' }),
    ),
    library: child(
      'LIBRARYSOURCE',
      record(
        {
          id: 'string',
          digest: 'string',
          footprintId: 'string',
          evidence: 'string',
          reviewer: 'string',
          license: 'string',
        },
        {
          bindings: list(
            'BINDINGS',
            'BIND',
            record({ terminalId: 'string', signalId: 'string' }),
          ),
        },
      ),
    ),
  },
);
const component = record(
  {
    id: 'string',
    reference: ['string', 'ref'],
    value: 'string',
    logicalId: 'string',
    deviceId: 'string',
    role: 'string',
  },
  {
    units: list('UNITS', 'UNIT', record({ id: 'string', sheetId: 'string' })),
    signals: list(
      'SIGNALS',
      'BIND',
      record({ signalId: 'string', netId: 'string' }),
    ),
  },
);
const placement = record(
  {
    id: 'string',
    deviceId: 'string',
    componentId: 'string',
    side: 'string',
    locked: 'boolean',
    rotationMicrodegree: ['integer', 'rotation'],
  },
  {
    positionNm: child('POSITION', point),
  },
);
const asset = record(
  {
    id: 'string',
    mediaType: 'string',
    source: 'string',
    license: 'string',
  },
  { base64: child('DATA') },
);

const boardXml = record(
  { version: 'integer' },
  {
    identity: child(
      'DPNIDENTITY',
      record({ boardId: ['string', 'id'], revision: 'integer' }),
    ),
    coordinates: child(
      'COORDINATES',
      record({
        lengthUnit: 'string',
        angleUnit: 'string',
        coordinateFrame: ['string', 'frame'],
      }),
    ),
    title: child('TITLE'),
    requiredFeatures: list(
      'REQUIREDFEATURES',
      'REQUIREDFEATURE',
      record({ id: 'string' }),
    ),
    copperLayers: list(
      'COPPERLAYERS',
      'COPPERLAYER',
      record({ id: 'string', order: 'integer' }),
    ),
    outline: list('OUTLINE', 'POINT', point),
    profile: child(
      'PROFILE',
      record(
        {},
        {
          outline: list('OUTLINE', 'EDGE', edge),
          cutouts: list(
            'CUTOUTS',
            'CUTOUT',
            record({}, { edges: list('EDGES', 'EDGE', edge) }),
          ),
        },
      ),
    ),
    sourceCircuit: child(
      'SOURCECIRCUIT',
      record({
        documentId: 'string',
        revision: 'integer',
        connectivityDigest: 'string',
      }),
    ),
    graphicLayers: list(
      'GRAPHICLAYERS',
      'GRAPHICLAYER',
      record({ id: 'string', role: 'string', side: 'string', name: 'string' }),
    ),
    components: list('COMPONENTDEFS', 'COMPONENTDEF', component),
    nets: list(
      'NETS',
      'NET',
      record(
        { id: 'string', name: 'string' },
        { aliases: list('ALIASES', 'ALIAS') },
      ),
    ),
    rules: child(
      'RULES',
      record({
        minWidthNm: 'integer',
        clearanceNm: 'integer',
        edgeClearanceNm: 'integer',
        minViaAnnulusNm: 'integer',
      }),
    ),
    padstacks: list('PADSTACKDEFS', 'PADSTACKDEF', stack),
    footprintDefinitions: list('FOOTPRINTDEFS', 'FOOTPRINTDEF', footprint),
    deviceDefinitions: list('DEVICEDEFS', 'DEVICEDEF', device),
    footprints: list('FOOTPRINTS', 'FOOTPRINT', placement),
    modelAssets: list('MODELASSETS', 'MODELASSET', asset),
  },
);

function toVector(value: readonly [number, number, number]) {
  const [x, y, z] = value;
  return { x, y, z };
}

function fromVector(
  value: ReturnType<typeof toVector>,
): [number, number, number] {
  return [value?.x, value?.y, value?.z];
}

function validateStandalone(board: BoardDocument) {
  if (board.footprints?.length && !board.components)
    throw new Error(
      'Standalone PCB placements need embedded component definitions.',
    );
}

export async function createBoardModelAsset(
  bytes: Uint8Array,
  source: string,
  license?: string,
): Promise<BoardModelAsset> {
  if (
    !bytes.length ||
    bytes.length > maxAssetBytes ||
    !source?.trim() ||
    (license !== undefined && !license.trim())
  )
    throw new Error('Invalid STEP asset size or provenance.');
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576)
    chunks.push(
      btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))),
    );
  return {
    id: await digest(bytes),
    mediaType: 'model/step',
    source,
    ...(license === undefined ? {} : { license }),
    base64: chunks.join(''),
  };
}

export async function readBoardModelAsset(
  asset: BoardModelAsset,
): Promise<Uint8Array> {
  const { base64 } = asset;
  if (
    typeof base64 !== 'string' ||
    !base64.length ||
    base64.length % 4 ||
    base64.length > Math.ceil(maxAssetBytes / 3) * 4
  )
    throw new Error('Invalid STEP asset encoding or size.');
  const raw = atob(base64);
  if (raw.length > maxAssetBytes || btoa(raw) !== base64)
    throw new Error('Invalid STEP asset encoding or size.');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  if ((await digest(bytes)) !== asset.id)
    throw new Error('STEP asset SHA-256 does not match its ID.');
  return bytes;
}

async function verifyAssets(assets: readonly BoardModelAsset[] = []) {
  let total = 0;
  for (const asset of assets) {
    total += (await readBoardModelAsset(asset)).length;
    if (total > maxTotalAssetBytes)
      throw new Error('PCB STEP assets exceed the total size limit.');
  }
}

interface BoardXmlHeader {
  identity?: object;
  coordinates?: object;
}

type XmlBoardDocument = BoardDocument & { dpnXmlHeader?: BoardXmlHeader };

/** Canonical UTF-8 XML. The board model remains independent of the file representation. */
export async function encodeBoard(board: BoardDocument): Promise<Uint8Array> {
  const {
    format,
    schemaVersion,
    boardId,
    revision,
    lengthUnit,
    angleUnit,
    coordinateFrame,
    requiredFeatures,
    footprintDefinitions,
    profile,
    dpnXmlHeader,
    ...content
  } = validateBoard(board) as XmlBoardDocument;
  validateStandalone(board);
  await verifyAssets(board.modelAssets);

  // The board validator canonicalizes property order, so structurally identical stacks
  // share one local ID even when authored independently.
  const padstacks = new Map<string, { id: string } & PadStack>();
  const definitions = footprintDefinitions?.map(
    ({ pads, models, ...definition }) => ({
      ...definition,
      pads: pads.map(({ stack, ...pad }) => {
        if (!stack) return pad;
        const key = JSON.stringify(stack);
        if (!padstacks.has(key))
          padstacks.set(key, { ...stack, id: String(padstacks.size + 1) });
        return { ...pad, padstackId: padstacks.get(key).id };
      }),
      ...(models
        ? {
            models: models.map(
              ({ offsetNm, rotationMicrodegree, scale, ...model }) => ({
                ...model,
                offsetNm: toVector(offsetNm),
                rotationMicrodegree: toVector(rotationMicrodegree),
                scale: toVector(scale),
              }),
            ),
          }
        : {}),
    }),
  );
  const root = boardXml.write('TinyCADPCB', {
    ...content,
    version: schemaVersion,
    identity: { ...dpnXmlHeader?.identity, boardId, revision },
    coordinates: {
      ...dpnXmlHeader?.coordinates,
      lengthUnit,
      angleUnit,
      coordinateFrame,
    },
    requiredFeatures: requiredFeatures.map((id) => ({ id })),
    ...(profile
      ? {
          profile: {
            ...profile,
            cutouts: profile.cutouts.map((edges) => ({ edges })),
          },
        }
      : {}),
    ...(definitions ? { footprintDefinitions: definitions } : {}),
    ...(padstacks.size ? { padstacks: [...padstacks.values()] } : {}),
  });
  const bytes = encoder.encode(writeBoardXml(root));
  if (bytes.length > maxBoardBytes)
    throw new Error('PCB XML exceeds its size limit.');
  return bytes;
}

type WireModel = Omit<
  FootprintModel,
  'offsetNm' | 'rotationMicrodegree' | 'scale'
> & {
  offsetNm: ReturnType<typeof toVector>;
  rotationMicrodegree: ReturnType<typeof toVector>;
  scale: ReturnType<typeof toVector>;
};

type WireFootprint = Omit<EmbeddedFootprint, 'pads' | 'models'> & {
  pads: (Omit<EmbeddedFootprint['pads'][number], 'stack'> & {
    padstackId?: string;
  })[];
  models?: WireModel[];
};

type WireBoard = Omit<
  XmlBoardDocument,
  'requiredFeatures' | 'profile' | 'footprintDefinitions'
> & {
  version: number;
  identity: Pick<BoardDocument, 'boardId' | 'revision'>;
  coordinates: Pick<
    BoardDocument,
    'lengthUnit' | 'angleUnit' | 'coordinateFrame'
  >;
  requiredFeatures: { id: string }[];
  profile?: Omit<BoardProfile, 'cutouts'> & {
    cutouts: { edges: readonly ContourEdge[] }[];
  };
  footprintDefinitions?: WireFootprint[];
  padstacks?: ({ id: string } & PadStack)[];
};

export async function decodeBoard(bytes: Uint8Array): Promise<BoardDocument> {
  if (!bytes.length || bytes.length > maxBoardBytes)
    throw new Error('Invalid PCB XML size.');
  const xml = readBoardXml(decoder.decode(bytes));
  if (xml.attributes.version !== String(boardFormat.schemaVersion))
    throw new Error('Unsupported TinyCAD PCB XML version.');
  const {
    version,
    identity,
    coordinates,
    requiredFeatures,
    profile,
    padstacks,
    footprintDefinitions,
    dpnXmlHeader,
    ...content
  } = boardXml.read(xml) as unknown as WireBoard;
  const stacks = new Map<string, PadStack>();
  for (const { id, ...stack } of padstacks ?? []) {
    if (!/^[1-9]\d*$/.test(id) || stacks.has(id))
      throw new Error('Invalid or duplicate PCB padstack definition ID.');
    stacks.set(id, stack);
  }
  const used = new Set<string>();
  const definitions = footprintDefinitions?.map(
    ({ pads, models, ...definition }) => {
      if (!pads) throw new Error('Missing PCB footprint pads.');
      return {
        ...definition,
        pads: pads.map(({ padstackId, ...pad }) => {
          if (padstackId === undefined) return pad;
          const stack = stacks.get(padstackId);
          if (!stack) throw new Error('Missing PCB padstack definition.');
          used.add(padstackId);
          return { ...pad, stack };
        }),
        ...(models
          ? {
              models: models.map(
                ({ offsetNm, rotationMicrodegree, scale, ...model }) => ({
                  ...model,
                  offsetNm: fromVector(offsetNm),
                  rotationMicrodegree: fromVector(rotationMicrodegree),
                  scale: fromVector(scale),
                }),
              ),
            }
          : {}),
      };
    },
  );
  if (used.size !== stacks.size)
    throw new Error('Unused PCB padstack definition.');
  if (profile && !profile.cutouts)
    throw new Error('Missing PCB profile cutouts collection.');
  if (dpnXmlHeader !== undefined)
    throw new Error('Invalid PCB XML header property.');
  const { boardId, revision, ...identityExtensions } = identity ?? {};
  const { lengthUnit, angleUnit, coordinateFrame, ...coordinateExtensions } =
    coordinates ?? {};
  const header: BoardXmlHeader = {};
  if (Object.keys(identityExtensions).length)
    header.identity = identityExtensions;
  if (Object.keys(coordinateExtensions).length)
    header.coordinates = coordinateExtensions;
  const board = validateBoard({
    ...content,
    boardId,
    revision,
    lengthUnit,
    angleUnit,
    coordinateFrame,
    ...(Object.keys(header).length ? { dpnXmlHeader: header } : {}),
    format: boardFormat.format,
    schemaVersion: version,
    requiredFeatures: requiredFeatures?.map(({ id }) => id),
    ...(profile
      ? {
          profile: {
            ...profile,
            cutouts: profile.cutouts.map(({ edges }) => edges),
          },
        }
      : {}),
    ...(definitions ? { footprintDefinitions: definitions } : {}),
  });
  validateStandalone(board);
  await verifyAssets(board.modelAssets);
  return board;
}
