// Original tutorial circuits. Library artwork/models come from SPICE essentials.
export function circuit(api, library, id) {
  const b = new api.TutorialCircuit(id, library);
  const r = (ref, v, p, o = 'h') => b.part('Resistor', ref, v, p, o),
    c = (ref, v, p, o = 'h') => b.part('Capacitor', ref, v, p, o);
  let analysis = { kind: 'op' },
    signals = ['in', 'out'],
    extras = {};
  const join = (a, z) => {
    if (a[0] === z[0] || a[1] === z[1]) b.wire(a, z);
    else b.wire(a, [z[0], a[1]], z);
  };
  if (id === 'controlled-source') {
    const v = b.source('V1', [100, 200], {
        waveform: 'sine',
        amplitude: '1',
        frequency: '1k',
      }),
      e = b.controlled('E1', [400, 150]);
    b.wire(v.p['1'], [100, 120]);
    b.label([100, 120], 'IN', 1);
    b.wire(v.p['2'], [100, 310]);
    b.ground([100, 310]);
    for (const [pin, net] of Object.entries({
      1: 'OUT',
      2: '0',
      3: 'IN',
      4: '0',
    }))
      b.stub(e, pin, net, 60);
    const load = r('R1', '1k', [650, 180], 'v');
    b.wire(load.p['1'], [650, 120]);
    b.label([650, 120], 'OUT', 1);
    b.wire(load.p['2'], [650, 310]);
    b.ground([650, 310]);
    analysis = { kind: 'tran', duration: '5ms', maxStep: '2us' };
  } else if (id.startsWith('amp-')) {
    const v = b.source('VCC', [80, 120], { dc: '12' });
    b.wire(v.p['1'], [80, 80]);
    b.label([80, 80], 'VCC', 1);
    b.wire(v.p['2'], [80, 200]);
    b.ground([80, 200]);
    const vin = b.source('VIN', [80, 350], {
      waveform: 'sine',
      amplitude: id === 'amp-clipping' ? '500m' : '10m',
      frequency: '1k',
      acMagnitude: '1',
    });
    b.wire(vin.p['2'], [80, 440]);
    b.ground([80, 440]);
    const pot = b.part('Potentiometer', 'R6', '10k', [200, 280], 'v', {
      Wiper: '0.5',
    });
    b.wire(vin.p['1'], [130, 350], [130, 240], [200, 240], pot.p['1']);
    b.label([150, 240], 'IN');
    b.wire(pot.p['2'], [200, 440]);
    b.ground([200, 440]);
    const cin = c('C1', '100u', [280, pot.p['3'][1]]);
    join(pot.p['3'], cin.p['1']);
    const q1 = b.part(
      'NPN transistor',
      'Q1',
      'TC_NPN',
      [400, pot.p['3'][1]],
      'npn',
    );
    join(cin.p['2'], q1.p['1']);
    const baseY = q1.p['1'][1];
    const r3 = r('R3', '100k', [360, 170], 'v'),
      r4 = r('R4', '10k', [360, 370], 'v');
    b.wire([360, 100], r3.p['1']);
    b.label([360, 100], 'VCC');
    b.wire(r3.p['2'], [360, baseY], r4.p['1']);
    b.wire(r4.p['2'], [360, 440]);
    b.ground([360, 440]);
    b.label([360, baseY], 'BASE');
    const r2 = r('R2', '1k', [440, 170], 'v'),
      r5 = r('R5', '220', [440, 370], 'v');
    b.wire([360, 100], [600, 100]);
    b.wire([440, 100], r2.p['1']);
    b.wire(r2.p['2'], [440, 240], q1.p['3']);
    join(q1.p['2'], r5.p['1']);
    b.wire(r5.p['2'], [440, 440]);
    b.ground([440, 440]);
    const q2 = b.part('NPN transistor', 'Q2', 'TC_NPN', [560, 240], 'npn');
    join([440, 240], q2.p['1']);
    b.label([470, 240], 'COLLECTOR');
    b.wire([600, 100], q2.p['3']);
    const r1 = r('R1', '470', [600, 370], 'v');
    b.wire(q2.p['2'], [600, 290], r1.p['1']);
    b.wire(r1.p['2'], [600, 440]);
    b.ground([600, 440]);
    b.label([600, 300], 'EMITTER', 1);
    const cout = c('C2', '470u', [660, 290]),
      load = r('RL', '8', [780, 370], 'v');
    b.wire([600, 290], cout.p['1']);
    b.wire(cout.p['2'], [780, 290], load.p['1']);
    b.label([730, 290], 'OUT');
    b.wire(load.p['2'], [780, 440]);
    b.ground([780, 440]);
    signals = ['in', 'base', 'collector', 'emitter', 'out', 'vcc#branch'];
    analysis =
      id === 'amp-bias'
        ? { kind: 'op' }
        : id === 'amp-ac'
        ? {
            kind: 'ac',
            startFrequency: '1Hz',
            stopFrequency: '100MegHz',
            pointsPerDecade: 60,
          }
        : { kind: 'tran', duration: '12ms', maxStep: '2us' };
    extras = {
      traces: [
        {
          id: 'gain',
          name: 'Voltage gain',
          left: 'out',
          right: 'in',
          operation: 'divide',
        },
      ],
      measurements:
        id === 'amp-ac'
          ? [
              {
                id: 'gain1k',
                name: 'Gain at 1 kHz',
                kind: 'gain',
                source: 'out',
                reference: 'in',
                at: '1kHz',
              },
            ]
          : [],
    };
  } else if (id === 'rectifier') {
    const v = b.source('V1', [100, 200], {
      waveform: 'sine',
      amplitude: '5',
      frequency: '50',
    });
    const d = b.part('Diode', 'D1', 'TC_D', [220, 140], 'h');
    b.wire(v.p['1'], [100, 140], d.p['1']);
    b.label([150, 140], 'IN');
    const cap = c('C1', '100u', [370, 240], 'v'),
      load = r('R1', '1k', [520, 240], 'v');
    b.wire(d.p['2'], [520, 140], [520, 240]);
    b.wire([370, 140], cap.p['1']);
    b.label([420, 140], 'OUT');
    b.wire(v.p['2'], [100, 340], [520, 340], load.p['2']);
    b.wire(cap.p['2'], [370, 340]);
    b.ground([100, 340]);
    analysis = { kind: 'tran', duration: '200ms', maxStep: '50us' };
  } else if (id.startsWith('source-')) {
    const shape = id.slice(7),
      current = shape === 'current';
    const configs = {
      sine: { waveform: 'sine', amplitude: '2', offset: '1', frequency: '1k' },
      pulse: {
        waveform: 'pulse',
        low: '0',
        high: '5',
        rise: '10us',
        fall: '10us',
        width: '300us',
        period: '1ms',
      },
      triangle: { waveform: 'triangle', low: '-1', high: '1', period: '1ms' },
      pwl: { waveform: 'pwl', points: '0 0\n1ms 0\n2ms 3\n3ms 3\n4ms 0' },
      exponential: {
        waveform: 'exponential',
        low: '0',
        high: '5',
        riseDelay: '1ms',
        fallDelay: '3ms',
        riseTau: '300us',
        fallTau: '500us',
      },
      fm: {
        waveform: 'fm',
        amplitude: '1',
        frequency: '5k',
        modulationFrequency: '500',
        modulationIndex: '2',
      },
      current: {
        type: 'current',
        waveform: 'pulse',
        low: '0',
        high: '1m',
        width: '500us',
        period: '1ms',
      },
      dc: { dc: '5' },
    };
    const v = b.source(current ? 'I1' : 'V1', [100, 180], configs[shape]),
      load = r('R1', '1k', [340, 180], 'v');
    b.wire(v.p['1'], [100, 120], [340, 120], load.p['1']);
    b.label([190, 120], 'OUT');
    b.wire(v.p['2'], [100, 300], [340, 300], load.p['2']);
    b.ground([100, 300]);
    signals = ['out'];
    analysis = { kind: 'tran', duration: '5ms', maxStep: '2us' };
  } else {
    const isDivider = ['divider', 'dc-sweep'].includes(id),
      step = id === 'rc-step',
      v = b.source('V1', [100, 200], {
        dc: isDivider ? '5' : '0',
        acMagnitude: isDivider || step ? '0' : '1',
        waveform: step ? 'pulse' : 'dc',
        low: '0',
        high: '1',
        rise: '1us',
        fall: '1us',
        width: '10ms',
        period: '20ms',
      }),
      top = r('R1', '1k', [220, 140]),
      lower = isDivider
        ? r('R2', '1k', [420, 220], 'v')
        : c('C1', '1u', [420, 220], 'v');
    b.wire(v.p['1'], [100, 140], top.p['1']);
    b.label([150, 140], 'IN');
    b.wire(top.p['2'], [420, 140], lower.p['1']);
    b.label([340, 140], 'OUT');
    b.wire(v.p['2'], [100, 340], [420, 340], lower.p['2']);
    b.ground([100, 340]);
    analysis =
      id === 'dc-sweep'
        ? {
            kind: 'dc',
            source: 'V1',
            sweepStart: '0',
            sweepStop: '10',
            sweepStep: '0.5',
          }
        : step
        ? { kind: 'tran', duration: '5ms', maxStep: '5us' }
        : id === 'divider'
        ? { kind: 'op' }
        : id === 'rc-noise'
        ? {
            kind: 'noise',
            input: 'V1',
            output: 'out',
            reference: '0',
            startFrequency: '1Hz',
            stopFrequency: '100kHz',
          }
        : id === 'rc-tf'
        ? { kind: 'tf', input: 'V1', output: 'out', reference: '0' }
        : id === 'rc-pz'
        ? { kind: 'pz', input: 'in', output: 'out', reference: '0' }
        : {
            kind: 'ac',
            startFrequency: '1Hz',
            stopFrequency: '100kHz',
            pointsPerDecade: 100,
          };
    if (id === 'rc-ac')
      extras = {
        traces: [
          {
            id: 'gain',
            name: 'OUT / IN',
            left: 'out',
            right: 'in',
            operation: 'divide',
          },
        ],
        measurements: [
          {
            id: 'fc',
            name: 'Cutoff',
            kind: 'cutoff',
            source: 'out',
            reference: 'in',
            referenceGain: '1',
          },
        ],
        bindings: [
          {
            id: 'r1',
            name: 'Series resistance',
            sheet: b.sheet.id,
            reference: 'R1',
            property: 'Value',
            unit: 'Ohm',
            minimum: '100',
            maximum: '10k',
            logarithmic: true,
            series: 'E12',
          },
        ],
        sweep: {
          binding: 'r1',
          mode: 'list',
          start: '1k',
          stop: '4.7k',
          count: 3,
          values: '1k 2.2k 4.7k',
        },
      };
  }
  return b.finish(
    id,
    analysis,
    signals,
    'Open the matching tutorial page. Run this saved setup; component values and models are embedded.',
    extras,
  );
}
