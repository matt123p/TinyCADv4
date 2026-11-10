const $ = (selector) => document.querySelector(selector);
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on'))
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (value !== undefined && value !== false)
      node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return node;
}
let catalog,
  state,
  stats,
  active,
  page = 0,
  visible = [],
  total = 0,
  requestId = 0,
  selected,
  readonly = false,
  previewCounter = 0,
  choiceRequest = 0;
const artwork = new Map();
const unresolved = (d) => ['pending', 'needs-drawing'].includes(d.status);
const statusText = {
  pending: 'Needs a choice',
  'needs-drawing': 'Needs a new drawing',
  chosen: 'Chosen',
  reuse: 'Assigned artwork',
  native: 'Native editor feature',
};
const titleFor = (id) =>
  catalog.libraries.find((l) => l.library_id === id)?.title || id;
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function notice(message, error = false) {
  const target = $('#notice');
  target.hidden = false;
  target.className = error ? 'error-banner' : 'success-banner';
  target.replaceChildren(
    el('span', {}, message),
    el(
      'div',
      {},
      error
        ? el('button', { onclick: () => location.reload() }, 'Reload choices')
        : null,
      el(
        'button',
        {
          onclick: () => (target.hidden = true),
          'aria-label': 'Dismiss notification',
        },
        '×',
      ),
    ),
  );
}
function fail(error) {
  notice(error.message || String(error), true);
}
function current() {
  return catalog.requirements.find((r) => r.id === active);
}
function reference() {
  return catalog.references.find((c) => c.id === $('#reference-select').value);
}
function metrics(candidate) {
  const m = candidate.metrics;
  return el(
    'div',
    { class: 'metrics' },
    el('span', {}, `${m.pinCount} pins`),
    candidate.family === 'digital' ? el('span', {}, 'VCC / VSS hidden') : null,
    el('span', {}, `Leads ${Number(m.leadMm || 0).toFixed(1)} mm`),
    el(
      'span',
      {},
      `Body ${Number(m.bodyWidthMm || 0).toFixed(1)} × ${Number(
        m.bodyHeightMm || 0,
      ).toFixed(1)} mm`,
    ),
  );
}
function updateProgress() {
  $(
    '#progress-label',
  ).textContent = `${stats.resolved} / ${stats.total} artwork choices settled`;
  $('#progress').value = stats.resolved;
  $('#progress').max = stats.total;
  $(
    '#progress-detail',
  ).textContent = `${stats.reuse} reused · ${stats.native} native · ${stats.chosen} chosen`;
  $('#milestone').replaceChildren(
    el(
      'strong',
      {},
      stats.artworkComplete
        ? 'Artwork selection complete'
        : 'Next: finish the shared selection',
    ),
    el(
      'p',
      {},
      stats.artworkComplete
        ? `${stats.adaptations} choices still need documented terminal or geometry adaptations. Review these before building bundles.`
        : `${
            stats.pending + stats['needs-drawing']
          } types still need artwork, including ${
            stats['needs-drawing']
          } marked for a new drawing.`,
    ),
    el(
      'p',
      {},
      'Course bundles will be built in the next stage. Models and package pinouts need their own checks.',
    ),
  );
}
function queueItems() {
  const q = $('#queue-search').value.toLowerCase(),
    course = $('#course').value,
    status = $('#status').value;
  return catalog.requirements.filter(
    (r) =>
      (!q ||
        `${r.name} ${r.id} ${r.aliases.join(' ')}`.toLowerCase().includes(q)) &&
      (!course || r.used_by_libraries.includes(course)) &&
      (status === 'all' ||
        (status === 'unresolved'
          ? unresolved(state.decisions[r.id])
          : state.decisions[r.id].status === status)),
  );
}
function renderQueue() {
  const nav = $('#queue');
  nav.replaceChildren();
  let previous = '';
  for (const r of queueItems()) {
    const folder = r.folder.split('/')[0];
    if (folder !== previous) {
      nav.append(el('div', { class: 'queue-group' }, folder));
      previous = folder;
    }
    nav.append(
      el(
        'button',
        {
          class: 'queue-item',
          'aria-current': String(active === r.id),
          'aria-label': r.name,
          'aria-description': statusText[state.decisions[r.id].status],
          onclick: () => activate(r.id),
        },
        el('span', {
          class: 'status-dot ' + state.decisions[r.id].status,
          title: statusText[state.decisions[r.id].status],
        }),
        el('span', {}, r.name),
      ),
    );
  }
  if (!nav.children.length)
    nav.append(
      el(
        'p',
        { class: 'muted' },
        'No symbols in this view. Change the filters to continue.',
      ),
    );
}
async function saveDecision(decision, id = active) {
  const result = await api('/api/decisions/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-symbol-review': '1' },
    body: JSON.stringify({ revision: state.revision, decision }),
  });
  state = result.state;
  stats = result.progress;
  updateProgress();
  renderQueue();
  return result;
}
async function activate(id) {
  active = id;
  location.hash = id;
  page = 0;
  $('#candidate-search').value = '';
  $('#all-sources').checked = false;
  renderQueue();
  $('#reference-select').value = catalog.referenceIds[id];
  $('.reference-panel h2').textContent = current().folder.startsWith('08 ')
    ? 'NAND reference'
    : 'SPICE reference';
  await renderRequirement();
  renderReference();
  await loadCandidates();
}
async function renderRequirement() {
  const r = current(),
    d = state.decisions[r.id],
    parent = $('#requirement');
  const pins = el(
    'details',
    {},
    el('summary', {}, `Terminal contract · ${r.pins.length} logical pins`),
    el(
      'p',
      { class: 'muted' },
      'Logical inventory numbers are not source/package numbers. Review and record the mapping when choosing artwork.',
    ),
    el(
      'table',
      { class: 'pin-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ['Logical pin', 'Meaning', 'Side'].map((t) => el('th', {}, t)),
        ),
      ),
      el(
        'tbody',
        {},
        r.pins.map((p) =>
          el(
            'tr',
            {},
            el('td', {}, p.logical_number),
            el('td', {}, p.name),
            el('td', {}, p.side),
          ),
        ),
      ),
    ),
  );
  parent.replaceChildren(
    el('p', { class: 'path' }, r.folder + ' / ' + r.canonical_symbol_id),
    el(
      'div',
      { class: 'requirement-heading' },
      el('h1', {}, r.name),
      el(
        'span',
        { class: 'badge ' + (unresolved(d) ? 'warn' : 'good') },
        statusText[d.status],
      ),
    ),
    el('p', { class: 'description' }, r.drawing_description),
    pins,
    el(
      'p',
      { class: 'chips-label' },
      `Shared by ${r.used_by_libraries.length} bundles · your choice applies to all of them`,
    ),
    el(
      'div',
      { class: 'chips' },
      r.used_by_libraries.map((id) =>
        el(
          'span',
          { class: 'chip', title: titleFor(id) },
          titleFor(id).split('—')[0].trim(),
        ),
      ),
    ),
  );
  if (d.status === 'native')
    parent.append(
      el(
        'div',
        { class: 'saved-summary native-summary' },
        'Use TinyCAD’s native ',
        el('strong', {}, d.operation),
        ' operation. No SQL artwork or library symbol is needed.',
      ),
    );
  else if (d.status === 'reuse' || d.status === 'chosen') {
    parent.append(
      el(
        'div',
        { class: 'saved-summary' },
        el(
          'button',
          { onclick: () => openSaved().catch(fail) },
          'Inspect choice',
        ),
        el('strong', {}, d.candidateId),
        el('br'),
        d.note || 'Shared artwork choice saved.',
        d.requiresAdaptation
          ? el('p', {}, 'Adaptation required: ' + d.adaptationNotes)
          : null,
      ),
    );
    if (d.status === 'chosen')
      parent.append(
        el(
          'button',
          {
            class: 'quiet',
            onclick: async () => {
              try {
                await saveDecision({
                  status: 'pending',
                  rejectedCandidateIds: d.rejectedCandidateIds || [],
                });
                await renderRequirement();
                await loadCandidates();
                notice('Choice reopened for ' + r.name + '.');
              } catch (e) {
                fail(e);
              }
            },
          },
          'Reopen this choice',
        ),
      );
  } else {
    if (d.note) parent.append(el('p', { class: 'muted' }, d.note));
    parent.append(
      el(
        'div',
        { class: 'requirement-actions' },
        el(
          'button',
          { onclick: () => missingDrawing() },
          'No suitable source · record drawing needed',
        ),
        el(
          'button',
          { class: 'quiet', onclick: nextUnchosen },
          'Next unchosen →',
        ),
      ),
    );
  }
  $('.search-bar').hidden =
    ['native', 'reuse'].includes(d.status) || !!r.artworkChoice;
  $('#results').hidden = d.status === 'native';
}
function nextUnchosen() {
  const all = queueItems().filter(
    (r) => unresolved(state.decisions[r.id]) && r.id !== active,
  );
  const global = catalog.requirements.filter(
    (r) => unresolved(state.decisions[r.id]) && r.id !== active,
  );
  const next = all[0] || global[0];
  if (next) activate(next.id).catch(fail);
  else
    notice(
      'No other unchosen symbols. Check the selection summary for any drawings still needed.',
    );
}
async function getArtwork(id) {
  if (!artwork.has(id))
    artwork.set(
      id,
      fetch('/api/artwork/' + encodeURIComponent(id))
        .then(async (r) => {
          if (!r.ok) throw new Error('Unable to load drawing.');
          return r.text();
        })
        .catch((e) => {
          artwork.delete(id);
          throw e;
        }),
    );
  return artwork.get(id);
}
async function paint(container, candidate, view) {
  const first = candidate.metrics.pins.find((p) => p.part >= 0);
  view ||= { sheet: first?.sheet || 0, part: first?.part || 0 };
  const ticket = String(++previewCounter);
  container.dataset.preview = ticket;
  container.replaceChildren(el('span', { class: 'muted' }, 'Loading drawing…'));
  try {
    let xml = await getArtwork(candidate.id);
    if (container.dataset.preview !== ticket) return;
    if (view.sheet || view.part) {
      const source = new DOMParser().parseFromString(xml, 'text/xml');
      const sheet =
        source.documentElement.nodeName === 'TinyCAD'
          ? source.documentElement
          : source.querySelectorAll('TinyCAD')[view.sheet];
      if (!sheet) throw new Error('Missing source sheet.');
      for (const pin of [...sheet.querySelectorAll('PIN')]) {
        if (Number(pin.getAttribute('part') || 0) !== view.part) pin.remove();
        else pin.setAttribute('part', '0');
      }
      xml = new XMLSerializer().serializeToString(sheet);
    }
    const markup = window.renderTinyCadSymbolSvg(xml);
    if (!markup)
      throw new Error('The source cannot be previewed by TinyCAD’s renderer.');
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml'),
      svg = document.importNode(parsed.documentElement, true),
      m = candidate.metrics,
      ns = 'http://www.w3.org/2000/svg';
    if (!$('#fit').checked && m.bounds) {
      const b = m.bounds,
        raw = svg.getAttribute('viewBox').split(/\s+/).map(Number),
        cx =
          view.sheet || view.part
            ? raw[0] + raw[2] / 2
            : (b.x1 + b.x2) * 2.5 + 0.5,
        cy =
          view.sheet || view.part
            ? raw[1] + raw[3] / 2
            : (b.y1 + b.y2) * 2.5 + 0.5;
      svg.setAttribute('viewBox', `${cx - 80} ${cy - 55} 160 110`);
    }
    const box = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    if ($('#grid').checked) {
      const defs = document.createElementNS(ns, 'defs'),
        pattern = document.createElementNS(ns, 'pattern');
      const patternId = 'review-grid-' + ticket;
      pattern.id = patternId;
      pattern.setAttribute('width', '5');
      pattern.setAttribute('height', '5');
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', '.5');
      dot.setAttribute('cy', '.5');
      dot.setAttribute('r', '.32');
      dot.setAttribute('fill', '#c0d2de');
      pattern.append(dot);
      defs.append(pattern);
      svg.prepend(defs);
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', box[0]);
      rect.setAttribute('y', box[1]);
      rect.setAttribute('width', box[2]);
      rect.setAttribute('height', box[3]);
      rect.setAttribute('fill', `url(#${patternId})`);
      svg.insertBefore(rect, svg.children[1]);
    }
    if ($('#pin-labels').checked)
      for (const pin of m.pins.filter(
        (p) => p.sheet === view.sheet && p.part === view.part && !p.hidden,
      )) {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', pin.x * 5 + 0.5);
        circle.setAttribute('cy', pin.y * 5 + 0.5);
        circle.setAttribute('r', '1.25');
        circle.setAttribute('fill', '#098976');
        svg.append(circle);
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', pin.x * 5 + 2.5);
        label.setAttribute('y', pin.y * 5 - 1.5);
        label.setAttribute('font-size', '5');
        label.setAttribute('fill', '#046757');
        label.setAttribute('stroke', 'white');
        label.setAttribute('stroke-width', '1.5');
        label.setAttribute('paint-order', 'stroke');
        label.textContent = pin.number;
        svg.append(label);
      }
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', candidate.name + ' symbol preview');
    container.replaceChildren(svg);
  } catch (error) {
    if (container.dataset.preview === ticket)
      container.replaceChildren(
        el(
          'span',
          { class: 'preview-error' },
          'Preview unavailable. ' + error.message,
        ),
      );
  }
}
function renderReference() {
  const candidate = reference();
  if (!candidate) return;
  paint($('#reference-preview'), candidate);
  $('#reference-metrics').replaceChildren(metrics(candidate));
}
function card(candidate) {
  const d = state.decisions[active],
    isSelected = d.candidateId === candidate.id;
  const canvas = el('div', { class: 'canvas' });
  const node = el(
    'article',
    {
      class: 'candidate' + (isSelected ? ' selected' : ''),
      'data-candidate': candidate.id,
    },
    el(
      'div',
      { class: 'candidate-top' },
      el(
        'span',
        {},
        candidate.kind === 'spice'
          ? 'SPICE bundle' +
              (candidate.resistorStyle
                ? ' · ' + candidate.resistorStyle.toUpperCase()
                : '')
          : candidate.kind === 'derived'
          ? candidate.family === 'digital'
            ? 'NAND-derived digital artwork'
            : 'SPICE-derived artwork'
          : candidate.author || 'SQL collection',
      ),
      el(
        'span',
        {},
        candidate.kind === 'sql'
          ? 'Symbol ' + candidate.sourceSymbolId
          : 'Existing artwork',
      ),
    ),
    canvas,
  );
  const flags = candidate.flags || [];
  node.append(
    el(
      'div',
      { class: 'candidate-info' },
      el(
        'h3',
        {},
        current().artworkChoice
          ? candidate.resistorStyle === 'eu'
            ? 'European (EU) rectangle'
            : 'US zigzag'
          : candidate.name,
      ),
      el('div', { class: 'candidate-description' }, candidate.description),
      metrics(candidate),
      flags.length
        ? el(
            'div',
            { class: 'flags' },
            el(
              'ul',
              {},
              flags.slice(0, 2).map((f) => el('li', {}, f)),
            ),
            flags.length > 2
              ? `+ ${flags.length - 2} more checks in review`
              : null,
          )
        : el(
            'span',
            { class: 'badge good' },
            'Style hints align · inspect terminals',
          ),
      el(
        'div',
        { class: 'card-actions' },
        el(
          'button',
          {
            class: 'primary',
            onclick: () => openChoice(candidate, false).catch(fail),
          },
          current().artworkChoice
            ? isSelected
              ? 'Review saved ' +
                candidate.resistorStyle.toUpperCase() +
                ' choice'
              : 'Choose ' +
                (candidate.resistorStyle === 'eu'
                  ? 'EU rectangle'
                  : 'US zigzag')
            : d.status === 'reuse'
            ? 'Inspect'
            : isSelected
            ? 'Review saved choice'
            : 'Review & choose',
        ),
        d.status !== 'reuse' && !current().artworkChoice
          ? el(
              'button',
              {
                disabled: isSelected,
                onclick: async () => {
                  try {
                    const rejected = new Set(d.rejectedCandidateIds || []);
                    if (rejected.has(candidate.id))
                      rejected.delete(candidate.id);
                    else rejected.add(candidate.id);
                    await saveDecision({
                      ...d,
                      rejectedCandidateIds: [...rejected],
                    });
                    await loadCandidates();
                    notice(
                      candidate.rejected
                        ? 'Candidate restored.'
                        : 'Candidate rejected for this symbol.',
                    );
                  } catch (e) {
                    fail(e);
                  }
                },
              },
              candidate.rejected ? 'Restore' : 'Reject',
            )
          : null,
      ),
    ),
  );
  paint(canvas, candidate);
  return node;
}
async function loadCandidates() {
  const ticket = ++requestId,
    r = current(),
    d = state.decisions[active];
  $('#selection-context').replaceChildren(
    el(
      'p',
      { class: 'eyebrow' },
      d.status === 'reuse'
        ? 'ALREADY ASSIGNED · INSPECT THE VARIANTS'
        : 'ONE ARTWORK CHOICE FOR THIS REQUIRED SYMBOL',
    ),
    el('strong', {}, r.name),
    el('p', {}, r.drawing_description),
    r.artworkChoice
      ? el(
          'span',
          { class: 'badge good' },
          'Choose ONE style · EU rectangle or US zigzag',
        )
      : null,
    el(
      'span',
      { class: 'muted' },
      r.artworkChoice
        ? 'This entry keeps one selected style. The highlighted card is your saved choice; choose the other card to change it.'
        : d.status === 'reuse'
        ? 'These variants are retained together across all referencing bundles.'
        : d.status === 'chosen'
        ? 'A choice is already saved. The highlighted card is your current selection; choose another only to replace it.'
        : 'All cards below are alternatives for this one symbol. Choose one across all pages, not one per row. Reject only hides a candidate for this symbol.',
    ),
  );
  $('#candidates').replaceChildren(
    el('p', { class: 'muted' }, 'Finding source artwork…'),
  );
  if (d.status === 'native') {
    visible = [];
    return;
  }
  if (d.status === 'reuse') {
    visible = (d.variants || [d.candidateId]).map((id) => ({
      ...catalog.references.find((c) => c.id === id),
      flags: [],
    }));
    total = visible.length;
  } else {
    const params = new URLSearchParams({
      symbol: r.id,
      q: $('#candidate-search').value,
      page: String(page),
      all: $('#all-sources').checked ? '1' : '0',
      pins: $('#exact-pins').checked ? '1' : '0',
      rejected: $('#show-rejected').checked ? '1' : '0',
    });
    const data = await api('/api/candidates?' + params);
    if (ticket !== requestId) return;
    visible = data.candidates;
    total = data.total;
  }
  $('#results-title').textContent = r.artworkChoice
    ? 'Pick European (EU) or US — one selection'
    : d.status === 'reuse'
    ? 'Assigned artwork · all variants'
    : `${total} ${
        $('#candidate-search').value ? 'search results' : 'artwork candidates'
      }`;
  $('#candidates').replaceChildren(...visible.map(card));
  if (!visible.length)
    $('#candidates').append(
      el(
        'div',
        { class: 'empty' },
        el('h3', {}, 'No suitable match in this view'),
        el(
          'p',
          {},
          'Try a part number, another name, or Browse whole catalogue. Some educational blocks may need a new drawing.',
        ),
        el(
          'button',
          { onclick: () => missingDrawing() },
          'Record drawing needed',
        ),
      ),
    );
  $('#page-label').textContent = total
    ? `${page * 12 + 1}–${Math.min((page + 1) * 12, total)} of ${total}`
    : '0 results';
  $('#previous').disabled = page === 0;
  $('#next').disabled = (page + 1) * 12 >= total;
}
function pinToken(value) {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9+-]/g, '');
}
const PIN_ALIASES = {
  A: ['ANODE'],
  K: ['CATHODE'],
  B: ['BASE'],
  C: ['COLLECTOR'],
  E: ['EMITTER'],
  G: ['GATE'],
  D: ['DRAIN'],
  S: ['SOURCE'],
  'IN+': ['+', 'NONINVERTING'],
  'IN-': ['-', 'INVERTING'],
  OUT: ['OUTPUT'],
  VCC: ['VDD', 'V+'],
  VDD: ['VCC', 'V+'],
  'V+': ['VCC', 'VDD'],
  'V-': ['VEE'],
  GND: ['VSS', 'GROUND', '0'],
  VSS: ['GND', 'GROUND', '0'],
};
function suggestedMap(requirement, candidate) {
  return Object.fromEntries(
    requirement.pins.map((logical) => {
      const aliases = [logical.name, ...(PIN_ALIASES[logical.name] || [])].map(
        pinToken,
      );
      let found = candidate.metrics.pins.filter(
        (p) => p.name && aliases.includes(pinToken(p.name)),
      );
      if (!found.length && /^\d+$/.test(logical.name))
        found = candidate.metrics.pins.filter((p) => p.number === logical.name);
      return [logical.logical_number, found.length === 1 ? found[0].key : ''];
    }),
  );
}
async function openSaved() {
  const id = active,
    d = state.decisions[id];
  const c = await api(
    '/api/candidate/' +
      encodeURIComponent(d.candidateId) +
      '?' +
      new URLSearchParams({
        symbol: active,
        nameId: d.sourceNameId || d.source?.nameId || '',
      }),
  );
  if (active !== id) return;
  await openChoice(c, d.status === 'reuse');
}
async function openChoice(candidate, locked) {
  const r = current(),
    decision = state.decisions[active],
    ticket = ++choiceRequest;
  readonly = locked || decision.status === 'reuse';
  const detail = await api(
    '/api/candidate/' +
      encodeURIComponent(candidate.id) +
      '?' +
      new URLSearchParams({
        symbol: active,
        nameId:
          decision.candidateId === candidate.id
            ? decision.sourceNameId ||
              decision.source?.nameId ||
              candidate.sourceNameId
            : candidate.sourceNameId,
      }),
  );
  if (ticket !== choiceRequest || active !== r.id) return;
  selected = detail;
  const saved =
    decision.candidateId === selected.id ||
    decision.variants?.includes(selected.id)
      ? decision
      : null;
  const mapping = saved?.pinMap || suggestedMap(r, selected);
  $('#choice-title').textContent = r.name + ' · ' + selected.name;
  const preview = el('div', { class: 'canvas' }),
    refPreview = el('div', { class: 'canvas' });
  const body = el(
    'div',
    { class: 'dialog-body' },
    el(
      'div',
      { class: 'comparison' },
      el('div', {}, el('h3', {}, 'Candidate · ' + selected.name), preview),
      el(
        'div',
        {},
        el('h3', {}, 'Style reference · ' + reference().name),
        refPreview,
      ),
    ),
    el(
      'div',
      { class: 'source-record' },
      `${selected.author} · ${selected.id} · NameID ${
        selected.sourceNameId
      } · ${
        selected.metrics.parts
      } part group(s) · SHA-256 ${selected.xmlSha256.slice(0, 16)}…`,
    ),
    metrics(selected),
    el('p', { class: 'muted' }, r.drawing_description),
  );
  const groups = [
    ...new Set(selected.metrics.pins.map((p) => `${p.sheet}:${p.part}`)),
  ];
  if (groups.length > 1 || (groups.length === 1 && groups[0] !== '0:0')) {
    const group = el(
      'select',
      { id: 'preview-part' },
      groups.map((key) =>
        el(
          'option',
          { value: key },
          'Sheet ' +
            (Number(key.split(':')[0]) + 1) +
            ' · source part ' +
            key.split(':')[1],
        ),
      ),
    );
    const first = selected.metrics.pins.find((p) => p.part >= 0);
    group.value = `${first?.sheet || 0}:${first?.part || 0}`;
    group.onchange = () => {
      const [sheet, part] = group.value.split(':').map(Number);
      paint(preview, selected, { sheet, part });
    };
    body.append(
      el(
        'div',
        { class: 'form-row' },
        el('label', { for: 'preview-part' }, 'Preview source part'),
        group,
      ),
    );
  }
  if (selected.flags?.length)
    body.append(
      el(
        'div',
        { class: 'flags' },
        el('strong', {}, 'Review these differences'),
        el(
          'ul',
          {},
          selected.flags.map((f) => el('li', {}, f)),
        ),
      ),
    );
  const sourceVariant = el(
    'select',
    { id: 'source-variant', disabled: readonly },
    selected.names.map((n) =>
      el(
        'option',
        { value: n.nameId },
        `${n.name} · ${n.description || 'No description'} · NameID ${n.nameId}`,
      ),
    ),
  );
  sourceVariant.value = selected.sourceNameId;
  body.append(
    el(
      'div',
      { class: 'form-row' },
      el(
        'label',
        { for: 'source-variant' },
        'Source entry (aliases share this drawing)',
      ),
      sourceVariant,
    ),
  );
  const table = el(
    'table',
    { class: 'pin-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Logical terminal'),
        el('th', {}, 'Source terminal'),
      ),
    ),
    el(
      'tbody',
      {},
      r.pins.map((p) => {
        const select = el(
          'select',
          {
            'data-logical': p.logical_number,
            'aria-label': `Source pin for ${p.name}`,
            disabled: readonly,
          },
          el('option', { value: '' }, 'Not mapped · adaptation required'),
          selected.metrics.pins.map((source) =>
            el(
              'option',
              { value: source.key },
              `${source.number} · ${source.name || 'unnamed'} · (${source.x}, ${
                source.y
              })${
                selected.metrics.parts > 1
                  ? ' · sheet ' + source.sheet + ', part ' + source.part
                  : ''
              }`,
            ),
          ),
        );
        select.value = mapping[p.logical_number] || '';
        return el(
          'tr',
          {},
          el('td', {}, `${p.logical_number} · ${p.name}`),
          el('td', {}, select),
        );
      }),
    ),
  );
  const adaptation = el('input', {
    id: 'needs-adaptation',
    type: 'checkbox',
    disabled: readonly,
  });
  adaptation.checked = saved?.requiresAdaptation || false;
  const adaptationNotes = el(
    'textarea',
    {
      id: 'adaptation-notes',
      rows: 3,
      maxlength: 8000,
      disabled: readonly,
      placeholder:
        'Describe pins to add/remove, grid repairs, power terminals or other geometry changes.',
    },
    saved?.adaptationNotes || '',
  );
  const note = el(
    'textarea',
    {
      id: 'decision-note',
      rows: 2,
      maxlength: 8000,
      disabled: readonly,
      placeholder:
        'Why this is the best style match; any later model or pinout work.',
    },
    saved?.note || '',
  );
  body.append(
    table,
    el(
      'p',
      { class: 'muted' },
      'Pin IDs on the preview are source numbers. Verify their electrical meaning; matching numbers alone do not establish a device pinout.',
    ),
    el(
      'div',
      { class: 'form-row' },
      el(
        'label',
        { class: 'checkbox', for: 'needs-adaptation' },
        adaptation,
        'Choose this artwork with a documented adaptation',
      ),
      adaptationNotes,
    ),
    el(
      'div',
      { class: 'form-row' },
      el('label', { for: 'decision-note' }, 'Decision notes'),
      note,
    ),
    el(
      'p',
      { class: 'muted' },
      `Applies to all ${r.used_by_libraries.length} bundles. Artwork only; simulation models are reviewed separately.`,
    ),
    el('div', { id: 'choice-error', role: 'alert', hidden: true }),
  );
  $('#choice-content').replaceChildren(body);
  $('#save-choice').textContent = r.artworkChoice
    ? 'Save ' + selected.resistorStyle.toUpperCase() + ' choice'
    : 'Save choice';
  $('#save-choice').hidden = readonly;
  $('#advance').closest('label').hidden = readonly;
  $('#choice-dialog').showModal();
  paint(preview, selected);
  paint(refPreview, reference());
}
function missingDrawing() {
  choiceRequest++;
  readonly = false;
  selected = null;
  $('#choice-title').textContent = 'Drawing needed · ' + current().name;
  $('#choice-content').replaceChildren(
    el(
      'div',
      { class: 'dialog-body' },
      el('p', {}, current().drawing_description),
      el(
        'p',
        { class: 'muted' },
        'This records a gap and keeps the symbol unresolved. It does not count as a finished artwork choice.',
      ),
      el(
        'div',
        { class: 'form-row' },
        el('label', { for: 'decision-note' }, 'What is missing?'),
        el(
          'textarea',
          { id: 'decision-note', required: true, rows: 4, maxlength: 8000 },
          state.decisions[active].note || '',
        ),
      ),
      el('div', { id: 'choice-error', role: 'alert', hidden: true }),
    ),
  );
  $('#save-choice').textContent = 'Save choice';
  $('#save-choice').hidden = false;
  $('#advance').closest('label').hidden = false;
  $('#choice-dialog').showModal();
}
$('#choice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (readonly) return;
  const button = $('#save-choice');
  button.disabled = true;
  try {
    const old = state.decisions[active];
    let decision;
    if (!selected)
      decision = {
        status: 'needs-drawing',
        note: $('#decision-note').value,
        rejectedCandidateIds: old.rejectedCandidateIds || [],
      };
    else
      decision = {
        status: 'chosen',
        candidateId: selected.id,
        sourceNameId: Number($('#source-variant').value),
        xmlSha256: selected.xmlSha256,
        pinMap: Object.fromEntries(
          [...$('#choice-content').querySelectorAll('[data-logical]')].map(
            (select) => [select.dataset.logical, select.value || null],
          ),
        ),
        requiresAdaptation: $('#needs-adaptation').checked,
        adaptationNotes: $('#adaptation-notes').value,
        note: $('#decision-note').value,
        rejectedCandidateIds: (old.rejectedCandidateIds || []).filter(
          (id) => id !== selected.id,
        ),
      };
    const name = current().name;
    await saveDecision(decision);
    $('#choice-dialog').close();
    notice(
      current().artworkChoice
        ? 'Saved ' +
            selected.resistorStyle.toUpperCase() +
            ' choice for ' +
            name +
            '.'
        : 'Saved shared decision for ' + name + '.',
    );
    if ($('#advance').checked) nextUnchosen();
    else {
      await renderRequirement();
      await loadCandidates();
    }
  } catch (error) {
    const target = $('#choice-error');
    target.hidden = false;
    target.className = 'dialog-error';
    target.textContent = error.message;
    if (error.status === 409) notice(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#close-choice').onclick = () => $('#choice-dialog').close();
$('#rules').onclick = () => $('#rules-dialog').showModal();
$('#close-rules').onclick = () => $('#rules-dialog').close();
$('#queue-search').addEventListener('input', renderQueue);
for (const id of ['course', 'status']) $('#' + id).onchange = renderQueue;
let searchTimer;
$('#candidate-search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 0;
    loadCandidates().catch(fail);
  }, 250);
};
$('#candidate-search').onkeydown = (event) => {
  if (event.key === 'Enter') {
    clearTimeout(searchTimer);
    page = 0;
    loadCandidates().catch(fail);
  }
};
$('#search-go').onclick = () => {
  page = 0;
  loadCandidates().catch(fail);
};
$('#reset-search').onclick = () => {
  $('#candidate-search').value = '';
  $('#all-sources').checked = false;
  page = 0;
  loadCandidates().catch(fail);
};
for (const id of ['all-sources', 'exact-pins', 'show-rejected'])
  $('#' + id).onchange = () => {
    page = 0;
    loadCandidates().catch(fail);
  };
$('#previous').onclick = () => {
  page--;
  loadCandidates().catch(fail);
};
$('#next').onclick = () => {
  page++;
  loadCandidates().catch(fail);
};
for (const id of ['grid', 'pin-labels', 'fit'])
  $('#' + id).onchange = () => {
    document
      .querySelectorAll('.scale-note')
      .forEach(
        (n) =>
          (n.textContent = $('#fit').checked
            ? 'Fit view · each drawing is scaled independently; use same-scale view to compare sizes'
            : 'Same drawing scale · 1 mm grid · compare body size and lead length before choosing'),
      );
    renderReference();
    $('#candidates').replaceChildren(...visible.map(card));
  };
$('#reference-select').onchange = renderReference;
$('#import').onclick = () => $('#import-file').click();
$('#import-file').onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const replacement = JSON.parse(await file.text());
    if (!confirm('Replace the current shared choices with this exported file?'))
      return;
    const data = await api('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-symbol-review': '1' },
      body: JSON.stringify({ revision: state.revision, state: replacement }),
    });
    state = data.state;
    stats = data.progress;
    updateProgress();
    renderQueue();
    await renderRequirement();
    await loadCandidates();
    notice('Imported shared choices.');
  } catch (e) {
    fail(e);
  } finally {
    event.target.value = '';
  }
};
try {
  const [c, s] = await Promise.all([api('/api/catalog'), api('/api/state')]);
  catalog = c;
  state = s.state;
  stats = s.progress;
  for (const library of catalog.libraries)
    $('#course').append(
      el('option', { value: library.library_id }, library.title),
    );
  for (const ref of catalog.references)
    $('#reference-select').append(el('option', { value: ref.id }, ref.name));
  for (const rule of catalog.rules.rules) {
    $('#rule-list').append(
      el('li', {}, el('strong', {}, rule.title), rule.description),
    );
    $('#rules-content').append(
      el('h3', {}, rule.title),
      el('p', {}, rule.description),
    );
  }
  updateProgress();
  const hash = decodeURIComponent(location.hash.slice(1));
  await activate(
    catalog.requirements.some((r) => r.id === hash)
      ? hash
      : catalog.requirements.find((r) => unresolved(state.decisions[r.id]))
          ?.id || catalog.requirements[0].id,
  );
} catch (error) {
  fail(error);
  $('#candidates').replaceChildren(
    el(
      'div',
      { class: 'empty' },
      'Unable to load the reviewer. Check that the local server is running, then reload.',
    ),
  );
}
