import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { digest, initialState } from './catalog.mjs';
export class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => {
  throw new ReviewError(message);
};
export function validateDecision(catalog, id, input) {
  const requirement = catalog.requirements.find((r) => r.id === id);
  if (!requirement) fail('Unknown canonical symbol.');
  const seeded = initialState(catalog).decisions[id];
  if (['reuse', 'native'].includes(seeded.status)) {
    if (!isDeepStrictEqual(input, seeded))
      fail('Existing SPICE and native editor assignments are fixed.');
    return seeded;
  }
  if (!input || !['pending', 'chosen', 'needs-drawing'].includes(input.status))
    fail('Invalid decision status.');
  const note = String(input.note || '').trim();
  if (note.length > 8000) fail('Keep notes under 8,000 characters.');
  const rejected = input.rejectedCandidateIds || [];
  if (
    !Array.isArray(rejected) ||
    rejected.length > catalog.candidates.length ||
    rejected.some((id) => !catalog.candidates.some((c) => c.id === id))
  )
    fail('Unknown rejected artwork.');
  const decision = {
    status: input.status,
    ...(note ? { note } : {}),
    ...(rejected.length
      ? { rejectedCandidateIds: [...new Set(rejected)] }
      : {}),
  };
  if (input.status === 'needs-drawing' && !note)
    fail('Describe the missing drawing.');
  if (input.status !== 'chosen') return decision;
  const candidate = catalog.candidates.find((c) => c.id === input.candidateId);
  if (!candidate?.metrics.valid)
    fail('Choose valid artwork from this catalogue.');
  if (
    requirement.artworkChoice &&
    !requirement.artworkChoice.candidateIds.includes(candidate.id)
  )
    fail('Choose the European rectangle or US zigzag for this entry.');
  const sourceNameId = Number(input.sourceNameId),
    sourceName = candidate.names.find((n) => n.nameId === sourceNameId);
  if (!sourceName)
    fail('The selected source name does not belong to this artwork.');
  if (input.xmlSha256 !== candidate.xmlSha256)
    fail('Artwork changed; reload before choosing.');
  const pinMap = input.pinMap || {},
    logical = new Set(requirement.pins.map((p) => p.logical_number));
  if (Object.keys(pinMap).some((key) => !logical.has(key)))
    fail('Unknown logical terminal.');
  const mapped = Object.values(pinMap).filter(Boolean),
    sourcePins = new Set(candidate.metrics.pins.map((p) => p.key));
  if (mapped.some((key) => !sourcePins.has(key)))
    fail('Unknown source terminal.');
  if (new Set(mapped).size !== mapped.length)
    fail('A source terminal cannot serve two logical terminals.');
  const m = candidate.metrics;
  const incomplete =
    mapped.length !== logical.size ||
    m.pinCount !== logical.size ||
    m.duplicatePins ||
    !m.absoluteGrid ||
    m.parts > 1 ||
    m.sheets > 1 ||
    m.pins.some((p) => p.hidden);
  const requiresAdaptation = input.requiresAdaptation === true;
  if (incomplete && !requiresAdaptation)
    fail(
      'Terminal count, mapping, grid or hidden/multiple parts require an adaptation note.',
    );
  const adaptationNotes = String(input.adaptationNotes || '').trim();
  if (requiresAdaptation && (!adaptationNotes || adaptationNotes.length > 8000))
    fail(
      'Describe the required terminal or drawing adaptation (up to 8,000 characters).',
    );
  return {
    ...decision,
    ...(requirement.artworkChoice
      ? { resistorStyle: candidate.resistorStyle }
      : {}),
    candidateId: candidate.id,
    xmlSha256: candidate.xmlSha256,
    sourceNameId,
    source:
      candidate.kind === 'derived'
        ? {
            kind: 'derived',
            recipe: 'library-recipes/derived-symbols.json',
            id: candidate.canonicalId,
            baseCandidateId: candidate.baseCandidateId,
            baseXmlSha256: candidate.baseXmlSha256,
          }
        : candidate.kind === 'sql'
        ? {
            kind: 'sql',
            nameId: sourceNameId,
            symbolId: candidate.sourceSymbolId,
            author: sourceName.author,
            sourceSha256: catalog.sourceSha256,
          }
        : {
            kind: 'spice',
            bundle: 'bundled-libraries/spice/spice.tclib',
            recipeId: candidate.recipeId,
            nameId: candidate.bundleNameId,
          },
    pinMap: Object.fromEntries(
      requirement.pins.map((p) => [
        p.logical_number,
        pinMap[p.logical_number] || null,
      ]),
    ),
    requiresAdaptation,
    ...(requiresAdaptation ? { adaptationNotes } : {}),
    modelReviewRequired: true,
  };
}
export function validateState(catalog, state) {
  const seed = initialState(catalog);
  if (
    state?.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  )
    fail('Unsupported choices file.');
  for (const field of [
    'inventorySha256',
    'sourceSha256',
    'spiceSha256',
    'derivedSha256',
  ])
    if (state[field] !== seed[field])
      fail(
        'The inventory or artwork snapshot changed. Preserve the existing choices and reconcile them before using a new snapshot.',
      );
  if (
    !state.decisions ||
    Object.keys(state.decisions).length !== catalog.requirements.length
  )
    fail('Choices must cover each canonical symbol exactly once.');
  const decisions = Object.fromEntries(
    Object.entries(state.decisions).map(([id, decision]) => [
      id,
      validateDecision(catalog, id, decision),
    ]),
  );
  return {
    version: 1,
    revision: state.revision,
    inventorySha256: seed.inventorySha256,
    sourceSha256: seed.sourceSha256,
    spiceSha256: seed.spiceSha256,
    derivedSha256: seed.derivedSha256,
    decisions,
  };
}
export function progress(catalog, state) {
  const counts = {
    total: catalog.requirements.length,
    reuse: 0,
    native: 0,
    chosen: 0,
    pending: 0,
    'needs-drawing': 0,
    adaptations: 0,
  };
  for (const decision of Object.values(state.decisions)) {
    counts[decision.status]++;
    if (decision.requiresAdaptation) counts.adaptations++;
  }
  counts.resolved = counts.reuse + counts.native + counts.chosen;
  counts.artworkComplete = counts.resolved === counts.total;
  counts.terminalAdaptationsComplete =
    counts.artworkComplete && counts.adaptations === 0;
  // This milestone never means that device models or course bundles were built.
  return counts;
}
export class DecisionStore {
  constructor(catalog, file) {
    this.catalog = catalog;
    this.file = file;
    this.tail = Promise.resolve();
  }
  async open() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(path.dirname(this.file), { recursive: true });
      raw = JSON.stringify(initialState(this.catalog), null, 2) + '\n';
      await writeFile(this.file, raw, { flag: 'wx' });
    }
    this.state = validateState(this.catalog, JSON.parse(raw));
    this.diskHash = digest(raw);
    return this;
  }
  save(id, input, revision) {
    return this.mutate(revision, (state) => ({
      ...state,
      decisions: {
        ...state.decisions,
        [id]: validateDecision(this.catalog, id, input),
      },
    }));
  }
  import(state, revision) {
    return this.mutate(revision, () => validateState(this.catalog, state));
  }
  mutate(revision, transform) {
    const result = this.tail
      .catch(() => {})
      .then(async () => {
        if (revision !== this.state.revision)
          throw new ReviewError(
            'Choices changed in another tab. Reload before saving.',
            409,
          );
        if (digest(await readFile(this.file, 'utf8')) !== this.diskHash)
          throw new ReviewError(
            'The choices file was edited outside this app. Restart the reviewer to load those changes.',
            409,
          );
        const next = {
          ...transform(this.state),
          revision: this.state.revision + 1,
        };
        const text = JSON.stringify(next, null, 2) + '\n',
          temp = this.file + `.${process.pid}.tmp`;
        try {
          await writeFile(temp, text, { flag: 'wx' });
          await rename(temp, this.file);
        } finally {
          await rm(temp, { force: true });
        }
        this.state = next;
        this.diskHash = digest(text);
        return next;
      });
    this.tail = result;
    return result;
  }
}
