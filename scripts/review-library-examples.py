"""Validate, tidy and render the public bundled example drafts with TinyCAD MCP.

Run the builder first. Only generated public drawing XML leaves the workspace.
Reports are cached by input hash under build/library-examples/mcp.
"""
import base64
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path('build/library-examples')
REPORTS = ROOT / 'mcp'
REPORTS.mkdir(exist_ok=True)
DEST = Path('bundled-examples')


def call(name, **arguments):
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
               'params': {'name': name, 'arguments': arguments}}
    req = urllib.request.Request('https://www.tinycad.net/mcp',
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json',
                                          'Accept': 'application/json, text/event-stream'})
    with urllib.request.urlopen(req, timeout=60) as response:
        body = response.read().decode()
    data = json.loads(next(line[6:] for line in body.splitlines() if line.startswith('data: '))) if body.startswith('event:') else json.loads(body)
    if 'error' in data:
        raise RuntimeError(data['error'])
    return data['result']


def structured(result):
    return result.get('structuredContent') or json.loads(next(c['text'] for c in result['content'] if c['type'] == 'text'))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


manifest = json.loads((ROOT / 'sources.json').read_text())
for example in manifest['examples']:
    name = example['id']
    definition = (ROOT / (name + '-draft.dsn')).read_bytes().decode('utf-8')
    sha = digest(definition)
    assert sha == example['draftSha256'], 'Review exactly the builder output'
    cache = REPORTS / (name + '.json')
    if cache.exists() and json.loads(cache.read_text()).get('draftSha256') == sha:
        report = json.loads(cache.read_text())
        definition = (REPORTS / (name + '.dsn')).read_bytes().decode('utf-8')
        assert digest(definition) == report['finalSha256']
    else:
        validation = structured(call('validate_drawing', definition=definition))
        assert validation.get('structurallyValid'), (name, validation)
        sheet = validation['sheets'][0]
        # Keep the intentional equipment layout and explanatory notes. Wires,
        # native power objects and net labels remain eligible for refinement.
        locks = [i['id'] for i in sheet['items'] if i['type'] in ('symbol', 'text')]
        time.sleep(1.1)
        tidy = structured(call('auto_tidy_drawing', definition=definition, sheet=1,
                               disturbance='low', lockedIds=locks,
                               phases=['symbol-text', 'net-labels', 'routing', 'junctions'],
                               maxPasses=3, maxEvaluations=1500, seed=1))
        assert all(tidy.get(k) for k in ['connectivityPreserved', 'serializationConnectivityPreserved', 'serializationPhysicalConnectivityPreserved']), (name, tidy)
        definition = tidy['definition']
        report = {'draftSha256': sha, 'finalSha256': digest(definition),
                  'initialValidation': validation,
                  'tidy': {k: v for k, v in tidy.items() if k != 'definition'}}
        cache.write_text(json.dumps(report, indent=2) + '\n')
        (REPORTS / (name + '.dsn')).write_text(definition)
    print(name, 'tidy:', json.dumps(report['tidy'].get('layoutQuality')), flush=True)
    print('stopped:', report['tidy'].get('stopped'), 'phase evaluations:',
          sum(p.get('evaluations', 0) for p in report['tidy'].get('phaseProgress', [])), flush=True)
    for folder in ['drawings', 'images']:
        (DEST / folder).mkdir(exist_ok=True)
    # The last auto-tidy result is the delivered XML and the rendering input.
    (DEST / 'drawings' / (name + '.dsn')).write_text(definition)
    render_cache = REPORTS / (name + '.render.json')
    if not (render_cache.exists() and json.loads(render_cache.read_text()).get('sha256') == digest(definition)
            and all((DEST / 'images' / (name + '.' + ext)).exists() for ext in ['png', 'svg'])):
        time.sleep(1.1)
        result = call('render_drawing', definition=definition, sheet=1, format='both', pixels=1024, view='page')
        assert not result.get('isError'), (name, result)
        png = svg = False
        for item in result.get('content', []):
            if item['type'] == 'image':
                (DEST / 'images' / (name + '.png')).write_bytes(base64.b64decode(item['data']))
                png = True
            elif item['type'] == 'resource' and 'text' in item['resource']:
                (DEST / 'images' / (name + '.svg')).write_text(item['resource']['text'])
                svg = True
        assert png and svg, 'Both actual preview resources are required'
        render_cache.write_text(json.dumps({'sha256': digest(definition), 'png': png, 'svg': svg}) + '\n')
    example['finalSha256'] = digest(definition)
    example['previews'] = {ext: hashlib.sha256((DEST / 'images' / (name + '.' + ext)).read_bytes()).hexdigest()
                           for ext in ['png', 'svg']}
    example['checks'] = {k: report['tidy'][k] for k in [
        'connectivityPreserved', 'serializationConnectivityPreserved',
        'serializationPhysicalConnectivityPreserved', 'layoutQuality', 'stopped']}
    example['electricalDiagnostics'] = report['tidy'].get('validation', {}).get('errors', [])
    time.sleep(1.1)
manifest['service'] = 'https://www.tinycad.net/mcp'
manifest['scope'] = 'Equipment/PCB wiring and cable plans; no firmware, hardware testing or SPICE models. Spare ports and physical socket/body-envelope notices are intentional. Preserve real pin types; extended power classification is a known checker limitation.'
(DEST / 'library-examples.provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Saved five final drawings and their matching PNG/SVG previews.', flush=True)
