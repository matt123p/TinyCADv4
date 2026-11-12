export function digitalCircuit(api, library, id) {
  const b = new api.TutorialCircuit(id, library);
  let pins = ['A', 'Y'],
    model = '',
    analysis = { kind: 'tran', duration: '8us', maxStep: '2ns' },
    sources = [
      [
        'A',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '500ns',
          rise: '5ns',
          fall: '5ns',
          width: '500ns',
          period: '1us',
        },
      ],
    ];
  const bridges =
    '.model adc adc_bridge(in_low=1 in_high=3)\n.model dac dac_bridge(out_low=0 out_high=5 out_undef=2.5 t_rise=5n t_fall=5n)';
  if (id === 'logic-nand') {
    pins = ['A', 'B', 'Y'];
    sources.push([
      'B',
      {
        waveform: 'pulse',
        low: '0',
        high: '5',
        delay: '1us',
        rise: '5ns',
        fall: '5ns',
        width: '1us',
        period: '2us',
      },
    ]);
    model =
      'Ain [A B] [da db] adc\nAg [da db] dy ng\n.model ng d_nand(rise_delay=20n fall_delay=20n)\nAout [dy] [Y] dac';
  } else if (id === 'logic-dff') {
    pins = ['D', 'CLK', 'RESET', 'Q', 'NQ'];
    sources = [
      [
        'D',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '200ns',
          rise: '5ns',
          fall: '5ns',
          width: '1.4us',
          period: '2.8us',
        },
      ],
      [
        'CLK',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '500ns',
          rise: '5ns',
          fall: '5ns',
          width: '500ns',
          period: '1us',
        },
      ],
      [
        'RESET',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '6us',
          rise: '5ns',
          fall: '5ns',
          width: '500ns',
          period: '20us',
        },
      ],
    ];
    model =
      'Ain [D CLK RESET] [dd dc dr] adc\nAff dd dc NULL dr dq dn flip\n.model flip d_dff(ic=0 clk_delay=20n reset_delay=20n rise_delay=5n fall_delay=5n)\nAout [dq dn] [Q NQ] dac';
  } else if (id === 'logic-counter') {
    pins = ['CLK', 'RESET', 'Q0', 'Q1', 'Q2', 'Q3'];
    sources = [
      [
        'CLK',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '500ns',
          rise: '5ns',
          fall: '5ns',
          width: '500ns',
          period: '1us',
        },
      ],
      [
        'RESET',
        {
          waveform: 'pulse',
          low: '0',
          high: '5',
          delay: '0',
          rise: '5ns',
          fall: '5ns',
          width: '100ns',
          period: '100us',
        },
      ],
    ];
    analysis.duration = '18us';
    model =
      'Ain [CLK RESET] [dc dr] adc\n.model flip d_dff(ic=0 clk_delay=20n reset_delay=20n rise_delay=5n fall_delay=5n)\n' +
      [0, 1, 2, 3]
        .map(
          (i) =>
            `Af${i} n${i} ${i ? 'n' + (i - 1) : 'dc'} NULL dr q${i} n${i} flip`,
        )
        .join('\n') +
      '\nAout [q0 q1 q2 q3] [Q0 Q1 Q2 Q3] dac';
  } else if (id === 'logic-hazard') {
    model =
      'Ain [A] [da] adc\nAi da dn inv\n.model inv d_inverter(rise_delay=100n fall_delay=100n)\nAg [da dn] dy ag\n.model ag d_and(rise_delay=10n fall_delay=10n)\nAout [dy] [Y] dac';
    analysis.duration = '3us';
  } else {
    model =
      'Ain [A] [da] adc\nAb da dy buf\n.model buf d_buffer(rise_delay=20n fall_delay=20n)\nAout [dy] [Y] dac';
    if (id === 'logic-filter') {
      sources[0][1] = {
        waveform: 'pulse',
        low: '0',
        high: '5',
        delay: '0',
        rise: '100ns',
        fall: '100ns',
        width: '25us',
        period: '100us',
      };
      analysis = { kind: 'tran', duration: '5ms', maxStep: '1us' };
    }
    if (id === 'logic-unknown') {
      sources[0][1] = {
        waveform: 'pwl',
        points: '0 0\n1us 0\n1.01us 2\n2us 2\n2.01us 5\n3us 5',
      };
      analysis.duration = '3us';
    }
  }
  const nIn = sources.length,
    nOut = pins.length - nIn,
    height = Math.max(nIn, nOut) * 40 + 40;
  const pinXML = pins
    .map((p, i) => {
      const input = i < nIn,
        row = input ? i : i - nIn,
        x = input ? 0 : 260,
        y = 40 + 40 * row;
      return `<PIN pos="${x / 5},${y / 5}" direction="${
        input ? 3 : 2
      }" number="${i + 1}" length="40" part="0" show="1">${p}</PIN>`;
    })
    .join('');
  const xml = `<TinyCAD><FONT id="1"><HEIGHT>-10</HEIGHT><FACENAME>Arial</FACENAME></FONT><STYLE id="1"><STYLE>0</STYLE><COLOR>000000</COLOR><THICKNESS>1</THICKNESS></STYLE><RECTANGLE a="8,0" b="44,${
    height / 5
  }" style="1" fill="0"/>${pinXML}</TinyCAD>`;
  const template =
    'X$(refnum) ' +
    pins.map((p, i) => `%(${i + 1})`).join(' ') +
    ' TUTORIAL_LOGIC';
  const prolog =
    '.subckt TUTORIAL_LOGIC ' +
    pins.join(' ') +
    '\n' +
    bridges +
    '\n' +
    model +
    '\n.ends TUTORIAL_LOGIC';
  const entry = {
    xml,
    name: {
      Name: 'XSPICE logic',
      NameID: 1000,
      SymbolID: 1000,
      Reference: 'X?',
      Description: 'ADC / event logic / DAC',
      ShowName: 1,
      ShowRef: 0,
      DefRotate: 0,
      ppp: 1,
      Attributes: [
        { AttName: '$$SPICE', AttValue: template, ShowAtt: 2 },
        { AttName: '$$SPICE_PROLOG', AttValue: prolog, ShowAtt: 2 },
      ],
    },
  };
  b.library = [...library, entry];
  const block = b.part('XSPICE logic', 'X1', 'XSPICE', [300, 140], 'keep');
  for (let i = 0; i < pins.length; i++) {
    const p = block.p[String(i + 1)],
      end = [p[0] + (i < nIn ? -90 : 90), p[1]];
    b.wire(p, end);
    b.label(i < nIn ? [end[0] + 5, end[1]] : [p[0] + 20, p[1]], pins[i]);
  }
  sources.forEach(([net, config], i) => {
    const v = b.source('V' + (i + 1), [210 + i * 150, 440], config);
    b.wire(v.p['1'], [210 + i * 150, 380]);
    b.label([210 + i * 150, 405], net, 1);
    b.wire(v.p['2'], [210 + i * 150, 540]);
    b.ground([210 + i * 150, 540]);
  });
  let signals = pins.map((p) => p.toLowerCase());
  if (id === 'logic-filter') {
    const r = b.part('Resistor', 'R1', '1k', [710, 140], 'h'),
      c = b.part('Capacitor', 'C1', '1u', [850, 220], 'v');
    b.wire(block.p['2'], r.p['1']);
    b.wire(r.p['2'], [850, 140], c.p['1']);
    b.label([780, 140], 'FILTERED');
    b.wire(c.p['2'], [850, 330]);
    b.ground([850, 330]);
    signals.push('filtered');
  }
  return b.finish(
    id,
    analysis,
    signals,
    'Desktop/native XSPICE required. X1 embeds explicit ADC and DAC bridges around event-driven logic. Read the matching tutorial before running.',
  );
}
