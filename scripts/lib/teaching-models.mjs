// Original, portable ngspice teaching equivalents. All state is circuit state;
// there are no file-backed code models or simulator control scripts.
export function teachingModel(id, pins, { edge = 'rising' } = {}) {
  const fields = {},
    lines = [],
    defs = [];
  const p = (name) => {
    const pin = pins.find((p) => p.name === name);
    if (!pin) throw Error(id + ': missing model terminal ' + name);
    return `%(${pin.number ?? pin.logical_number})`;
  };
  const has = (name) => pins.some((p) => p.name === name);
  const f = (name, value) => {
    fields[name] = String(value);
    return `$(${name})`;
  };
  const emit = (...text) => lines.push(...text);
  const voltage = (name, positive, negative, expr, resistance = '50') =>
    emit(
      `B$(ref)_${name} _$(ref)_driver_${name} ${negative} V={${expr}}`,
      `R$(ref)_${name} _$(ref)_driver_${name} ${positive} ${resistance}`,
    );
  const v = (name, ref = '0') => `v(${p(name)},${ref})`;
  const loName = has('VSS')
    ? 'VSS'
    : has('GND')
    ? 'GND'
    : has('V-')
    ? 'V-'
    : null;
  const hiName = has('VDD')
    ? 'VDD'
    : has('VCC')
    ? 'VCC'
    : has('V+')
    ? 'V+'
    : null;
  const lo = loName ? p(loName) : '0';
  const high = hiName ? `v(${p(hiName)},${lo})` : f('LogicHigh', 5);
  const bit = (name) => `(${v(name, lo)} > (${high})*0.5)`;
  const drive = (name, expr) =>
    voltage(name.replace(/\W/g, '_'), p(name), lo, `(${high})*(${expr})`);
  const binary = (names, ref = lo, threshold = `(${high})*0.5`) =>
    names.map((n, i) => `${2 ** i}*(${v(n, ref)}>${threshold})`).join('+');
  const bval = (value, i) =>
    `(floor((${value})/${2 ** i})-2*floor((${value})/${2 ** (i + 1)}))`;

  // Normalised master/slave storage with finite acquisition and leakage.
  // Switches open between edges; held values are capacitor voltages.
  const ffDef = `.subckt TC_FF d clk set reset q qb params: initial=0
Bnc nc 0 V={1-v(clk)}
Sm d m nc 0 TS
Cm m 0 1n IC={initial}
Rm m bias 1e12
Vbias bias 0 {initial}
Bm mb 0 V={v(m)>0.5}
Ss mb s clk 0 TS
Cs s 0 1n IC={initial}
Rs s bias 1e12
Vone one 0 1
Srm m 0 reset 0 TS
Srs s 0 reset 0 TS
Bset se 0 V={v(set)>0.5 && v(reset)<0.5}
Ssm m one se 0 TS
Sss s one se 0 TS
Bq q 0 V={v(reset)>0.5 ? 0 : v(se)>0.5 ? 1 : v(s)>0.5}
Bqb qb 0 V={1-v(q)}
.model TS SW(Ron=1 Roff=1e15 Vt=0.5 Vh=0)
.ends TC_FF`;
  const latchDef = `.subckt TC_LATCH d enable set reset q qb params: initial=0
Ssample d s enable 0 TS
Cs s 0 1n IC={initial}
Vbias bias 0 {initial}
Rs s bias 1e12
Vone one 0 1
Sr s 0 reset 0 TS
Bset se 0 V={v(set)>0.5 && v(reset)<0.5}
Ss s one se 0 TS
Bq q 0 V={v(reset)>0.5 ? 0 : v(se)>0.5 ? 1 : v(s)>0.5}
Bqb qb 0 V={1-v(q)}
.model TS SW(Ron=1 Roff=1e15 Vt=0.5 Vh=0)
.ends TC_LATCH`;
  // Instance-local helper names avoid conflicting parameters across devices.
  const useState = () => {
    if (!defs.includes(ffDef)) defs.push(ffDef, latchDef);
  };
  const state = (
    name,
    data,
    clock,
    reset = '0',
    set = '0',
    initial = '0',
    latch = false,
  ) => {
    useState();
    emit(`B$(ref)_d${name} _$(ref)_d${name} 0 V={${data}}`);
    emit(
      `X$(ref)_${name} _$(ref)_d${name} ${clock} ${set} ${reset} _$(ref)_q${name} _$(ref)_qb${name} ${
        latch ? 'TC_LATCH' : 'TC_FF'
      }_$(ref) initial=${initial}`,
    );
    return `v(_$(ref)_q${name})`;
  };
  const norm = (name, expr) => {
    emit(`B$(ref)_${name} _$(ref)_${name} 0 V={${expr}}`);
    return `_$(ref)_${name}`;
  };
  const clock = (name) =>
    norm('clock', edge === 'falling' ? `1-${bit(name)}` : bit(name));
  const q = (i) => `(v(_$(ref)_q${i})>0.5)`;

  const gates = {
    gate_and: 'a && b',
    gate_nand: '!(a && b)',
    gate_or: 'a || b',
    gate_nor: '!(a || b)',
    gate_xor: 'a != b',
    gate_xnor: 'a == b',
    gate_not: '!a',
    gate_buffer: 'a',
  };
  if (gates[id]) {
    const expression = gates[id]
      .replace(/\ba\b/g, bit('A'))
      .replace(/\bb\b/g, has('B') ? bit('B') : '0');
    drive('Y', expression);
  } else if (id === 'full_adder') {
    const count = `(${bit('A')}+${bit('B')}+${bit('CARRY_IN')})`;
    drive('SUM', bval(count, 0));
    drive('CARRY_OUT', `(${count})>=2`);
  } else if (id === 'decoder2to4') {
    for (let i = 0; i < 4; i++)
      drive('Y' + i, `${bit('ENABLE')} && ((${binary(['A0', 'A1'])})==${i})`);
  } else if (id === 'encoder4to2') {
    // Highest asserted input wins. VALID distinguishes zero input from I0.
    drive('Y0', `${bit('I3')} || (${bit('I1')} && !${bit('I2')})`);
    drive('Y1', `${bit('I3')} || ${bit('I2')}`);
    drive('VALID', ['I0', 'I1', 'I2', 'I3'].map(bit).join(' || '));
  } else if (id === 'mux2')
    drive('Y', `${bit('SELECT')} ? ${bit('D1')} : ${bit('D0')}`);
  else if (id.startsWith('counter_') || id === 'shift_register3') {
    const clk = clock('CLK'),
      reset = norm('reset', bit('RESET')),
      initial = f('InitialState', 0);
    const count = id === 'counter_bcd' || id === 'counter_johnson' ? 4 : 3;
    const sum = Array.from(
      { length: count },
      (_, i) => `${2 ** i}*${q(i)}`,
    ).join('+');
    const up = has('UP_DOWN') ? bit('UP_DOWN') : '1';
    const next =
      id === 'counter_bcd'
        ? `(${up} ? ((${sum})>=9 ? 0 : (${sum})+1) : ((${sum})<1 ? 9 : (${sum})-1))`
        : `(${up} ? ((${sum})+1) : ((${sum})+${2 ** count - 1}))`;
    for (let i = 0; i < count; i++) {
      let data =
        id === 'counter_johnson'
          ? i
            ? q(i - 1)
            : `1-${q(count - 1)}`
          : id === 'shift_register3'
          ? i
            ? q(i - 1)
            : bit('DATA')
          : bval(next, i);
      if (has('ENABLE')) data = `${bit('ENABLE')} ? (${data}) : ${q(i)}`;
      let c = clk;
      if (id === 'counter_binary3_async' && i) {
        c = norm(
          'ripple' + i,
          `${bit('UP_DOWN')} ? 1-${q(i - 1)} : ${q(i - 1)}`,
        );
        data = has('ENABLE')
          ? `${bit('ENABLE')} ? 1-${q(i)} : ${q(i)}`
          : `1-${q(i)}`;
      }
      state(String(i), data, c, reset, '0', bval(initial, i));
      drive('Q' + i, q(i));
    }
  } else if (
    ['flipflop_d', 'flipflop_jk', 'latch_d', 'latch_rs'].includes(id)
  ) {
    const reset = has('RESET_N')
      ? norm('reset', `!${bit('RESET_N')}`)
      : has('RESET')
      ? norm('reset', bit('RESET'))
      : '0';
    const set = has('SET_N')
      ? norm('set', `!${bit('SET_N')}`)
      : has('SET')
      ? norm('set', bit('SET'))
      : '0';
    const data =
      id === 'flipflop_jk'
        ? `(${bit('J')} && (1-${q(0)})) || (!${bit('K')} && ${q(0)})`
        : has('D')
        ? bit('D')
        : '0';
    const clk = id.startsWith('latch_')
      ? has('ENABLE')
        ? norm('enable', bit('ENABLE'))
        : '0'
      : clock('CLK');
    state(
      '0',
      data,
      clk,
      reset,
      set,
      f('InitialState', 0),
      id.startsWith('latch_'),
    );
    drive('Q', q(0));
    drive('Q_N', `1-${q(0)}`);
  } else if (id === 'adc4') {
    const common = p('COMMON'),
      range = `max(1u,${v('VREF', common)})`,
      code = `floor(min(15.999999,max(0,16*${v(
        'ANALOG_IN',
        common,
      )}/${range})))`;
    const clk = norm(
      'clock',
      edge === 'falling'
        ? `${v('CLOCK', common)}<2.5`
        : `${v('CLOCK', common)}>2.5`,
    );
    for (let i = 0; i < 4; i++) {
      state(String(i), bval(code, i), clk);
      voltage('out' + i, p('D' + i), common, `${high}*${q(i)}`);
    }
  } else if (id === 'dac4') {
    const ref = p('COMMON');
    voltage(
      'out',
      p('ANALOG_OUT'),
      ref,
      `${v('VREF', ref)}*(${binary(['D0', 'D1', 'D2', 'D3'], ref, '2.5')})/16`,
    );
  } else if (id === 'pcm_encoder') {
    const clk = clock('CLOCK');
    state('0', `1-${q(0)}`, clk);
    state('1', `${q(1)} != ${q(0)}`, clk);
    drive(
      'SERIAL_OUT',
      `${q(1)}>0.5 ? (${q(0)}>0.5 ? ${bit('D3')} : ${bit('D2')}) : (${q(
        0,
      )}>0.5 ? ${bit('D1')} : ${bit('D0')})`,
    );
  } else if (id === 'state_machine') {
    const clk = clock('CLOCK'),
      reset = norm('reset', bit('RESET'));
    const index = `(${q(0)}+2*${q(1)}+4*${bit('INPUT0')}+8*${bit('INPUT1')})`;
    const lookup = (mask) =>
      `(floor((${mask})/pow(2,${index}))-2*floor((${mask})/pow(2,(${index})+1)))`;
    state('0', lookup(f('Next0', 43690)), clk, reset);
    state('1', lookup(f('Next1', 52428)), clk, reset);
    drive('OUTPUT0', q(0));
    drive('OUTPUT1', q(1));
  } else if (id === 'sampler') {
    const ref = p('REF'),
      track = norm('track', `${v('CLOCK', ref)}>2.5`);
    emit(
      `S$(ref) ${p('ANALOG_IN')} _$(ref)_hold ${track} 0 TS_$(ref)`,
      `C$(ref) _$(ref)_hold ${ref} ${f('HoldCapacitance', '1n')} IC=0`,
      `R$(ref)_leak _$(ref)_hold ${ref} 1e12`,
    );
    defs.push(`.model TS_$(ref) SW(Ron=10 Roff=1e15 Vt=0.5 Vh=0)`);
    voltage('out', p('ANALOG_OUT'), ref, `v(_$(ref)_hold,${ref})`);
  } else if (id === 'tdm_switch')
    voltage(
      'out',
      p('MULTIPLEXED_OUT'),
      '0',
      `${bit('CLOCK')} ? ${v('CHANNEL1')} : ${v('CHANNEL0')}`,
    );
  else if (
    ['channel', 'transmitter', 'receiver', 'output_transducer'].includes(id)
  ) {
    const names = {
      channel: ['IN', 'OUT'],
      transmitter: ['SIGNAL_IN', 'CHANNEL_OUT'],
      receiver: ['CHANNEL_IN', 'SIGNAL_OUT'],
      output_transducer: ['ELECTRICAL_IN', 'PHYSICAL_OUT'],
    }[id];
    emit(
      `B$(ref)_drive _$(ref)_drive 0 V={${f('Gain', 1)}*${v(names[0])}}`,
      `R$(ref)_bw _$(ref)_drive _$(ref)_filtered 1k`,
      `C$(ref)_bw _$(ref)_filtered 0 {1/(6.283185307*1k*${f(
        'Bandwidth',
        '100k',
      )})}`,
    );
    voltage('out', p(names[1]), '0', `v(_$(ref)_filtered)`);
  } else if (id === 'data_logger') {
    emit(
      `R$(ref)_input ${p('AIN+')} ${p('AIN-')} ${f(
        'InputResistance',
        '10meg',
      )}`,
      `B$(ref)_record _$(ref)_record ${lo} V={${f('Gain', 1)}*(${v(
        'AIN+',
        p('AIN-'),
      )})}`,
      `I$(ref)_supply ${p('VCC')} ${lo} ${f('SupplyCurrent', '1m')}`,
    );
  } else if (['microcontroller', 'fpga', 'plc_interface'].includes(id)) {
    const outputs =
      id === 'plc_interface'
        ? ['OUT0', 'OUT1']
        : Array.from(
            { length: 8 },
            (_, i) => (id === 'fpga' ? 'IO' : 'GPIO') + i,
          );
    const inputs =
        id === 'plc_interface' ? ['IN0', 'IN1'] : outputs.slice(0, 2),
      mask = f('DirectionMask', id === 'plc_interface' ? 3 : 252);
    const ins = inputs.map((n, i) =>
      id === 'microcontroller'
        ? `(${f('Input' + i + 'FromADC', 0)}>0.5 ? ${v('AIN' + i, lo)}>${f(
            'ADCThreshold',
            2.5,
          )} : ${bit(n)})`
        : bit(n),
    );
    const index = `(${ins[0]}+2*${ins[1]})`;
    const clk = has('CLOCK') ? clock('CLOCK') : null,
      clocked = clk ? f('Clocked', 0) : '0';
    const reset = has('RESET_N')
      ? `!${bit('RESET_N')}`
      : has('RESET')
      ? bit('RESET')
      : '0';
    for (const [i, name] of outputs.entries()) {
      const table = f('Truth' + i, i % 2 ? 12 : 10),
        expr = `(floor(${table}/pow(2,${index}))-2*floor(${table}/pow(2,(${index})+1)))`;
      const held = clk
        ? state(String(i), expr, clk, norm('ior' + i, reset))
        : '0';
      const value = clk ? `(${clocked}>0.5 ? ${held} : ${expr})` : expr;
      emit(
        `B$(ref)_io${i} ${p(name)} ${lo} I={${bval(mask, i)}*(${v(
          name,
          lo,
        )}-(${high})*(${reset} ? 0 : ${value}))/${f('OutputResistance', 50)}}`,
        `R$(ref)_io${i} ${p(name)} ${lo} 1g`,
      );
    }
    if (has('AIN0'))
      for (const name of ['AIN0', 'AIN1'])
        emit(`R$(ref)_${name} ${p(name)} ${lo} 1g`);
  } else if (
    [
      'hall_sensor',
      'light_sensor',
      'pressure_sensor',
      'temperature_sensor',
    ].includes(id)
  ) {
    let expr;
    if (id === 'hall_sensor')
      expr = `(${high})*${f('ZeroFieldRatio', 0.5)}+${f(
        'Sensitivity',
        10,
      )}*(${f('MagneticFlux', 0)})`;
    if (id === 'light_sensor')
      expr = `${f('DarkVoltage', 0)}+${f('Responsivity', 0.001)}*(${f(
        'Illuminance',
        100,
      )})`;
    if (id === 'pressure_sensor')
      expr = `(${high})*(${f('OffsetRatio', 0.04)}+${f(
        'Sensitivity',
        0.09,
      )}*(${f('Pressure', 0)}))`;
    if (id === 'temperature_sensor')
      expr = `${f('Offset', 0)}+${f('Sensitivity', 0.01)}*(${f(
        'Temperature',
        25,
      )})`;
    voltage(
      'out',
      p('OUT'),
      lo,
      `min(max(0,${high}),max(0,${expr}))`,
      f('OutputResistance', 100),
    );
    emit(`I$(ref)_supply ${p('VCC')} ${lo} ${f('SupplyCurrent', '100u')}`);
  } else if (['piezo_sensor', 'ph_probe', 'thermocouple'].includes(id)) {
    const a = p(has('SIGNAL') ? 'SIGNAL' : '+'),
      b = p(has('REFERENCE') ? 'REFERENCE' : '-');
    if (id === 'piezo_sensor')
      emit(
        `B$(ref)_charge ${b} ${a} I={${f('ChargeSensitivity', '10p')}*ddt(${f(
          'Force',
          0,
        )})}`,
        `C$(ref) ${a} ${b} ${f('Capacitance', '1n')}`,
        `R$(ref) ${a} ${b} ${f('LeakageResistance', '1g')}`,
      );
    else
      voltage(
        'sensor',
        a,
        b,
        id === 'ph_probe'
          ? `${f('Slope', 0.05916)}*(${f('ReferencePH', 7)}-(${f('PH', 7)}))`
          : `${f('Seebeck', '41u')}*((${f('HotTemperature', 100)})-(${f(
              'ColdTemperature',
              25,
            )}))`,
        f('SourceResistance', id === 'ph_probe' ? '100meg' : '10'),
      );
  } else if (id === 'controlled_switch') {
    emit(`S$(ref) ${p('A')} ${p('B')} ${p('CTRL+')} ${p('CTRL-')} TS_$(ref)`);
    defs.push(
      `.model TS_$(ref) SW(Ron=${f('OnResistance', 1)} Roff=${f(
        'OffResistance',
        '1g',
      )} Vt=${f('Threshold', 2.5)} Vh=${f('Hysteresis', 0.1)})`,
    );
  } else if (id === 'am_modulator')
    voltage(
      'out',
      p('OUT+'),
      p('OUT-'),
      `${f('Gain', 1)}*(${f('CarrierBias', 1)}+${f('ModulationIndex', 0.5)}*${v(
        'MESSAGE+',
        p('MESSAGE-'),
      )})*${v('CARRIER+', p('CARRIER-'))}`,
    );
  else if (['test_point', 'bnc', 'connector2', 'connector3'].includes(id))
    emit(
      `* $(ref): passive connection marker; contacts remain electrically independent`,
    );
  else if (
    ['cell', 'battery', 'behavioural_voltage', 'behavioural_current'].includes(
      id,
    )
  ) {
    const a = p('+'),
      b = p('-');
    if (id.startsWith('behavioural'))
      emit(
        `B$(ref) ${a} ${b} ${id.endsWith('current') ? 'I' : 'V'}={${f(
          'Expression',
          0,
        )}}`,
      );
    else {
      emit(
        `V$(ref) _$(ref)_source ${b} ${f('Voltage', id === 'cell' ? 1.5 : 9)}`,
        `R$(ref) _$(ref)_source ${a} ${f('InternalResistance', 0.1)}`,
      );
    }
  } else if (
    [
      'switch_spst',
      'switch_spdt',
      'push_make',
      'push_break',
      'reed_switch',
      'relay_spdt',
      'relay_coil',
    ].includes(id)
  ) {
    const nums = pins.map((x) => `%(${x.number ?? x.logical_number})`);
    if (id === 'relay_coil' || id === 'relay_spdt') {
      const a = id === 'relay_coil' ? nums[0] : p('COIL_A'),
        b = id === 'relay_coil' ? nums[1] : p('COIL_B');
      emit(
        `R$(ref)_coil ${a} _$(ref)_coil ${f('CoilResistance', 200)}`,
        `L$(ref)_coil _$(ref)_coil ${b} ${f('CoilInductance', '.1')}`,
      );
      if (id === 'relay_spdt') {
        const control = norm(
          'relay',
          `abs(v(${a},${b}))>${f('PickupVoltage', 3)}`,
        );
        emit(
          `B$(ref)_off _$(ref)_off 0 V={1-v(${control})}`,
          `S$(ref)_no ${p('COM')} ${p('NO')} ${control} 0 TS_$(ref)`,
          `S$(ref)_nc ${p('COM')} ${p('NC')} _$(ref)_off 0 TS_$(ref)`,
        );
      }
    } else {
      const ctrl = norm('state', f('State', id === 'push_break' ? 1 : 0));
      emit(`S$(ref)_a ${nums[0]} ${nums[1]} ${ctrl} 0 TS_$(ref)`);
      if (id === 'switch_spdt') {
        emit(
          `B$(ref)_off _$(ref)_off 0 V={1-v(${ctrl})}`,
          `S$(ref)_b ${nums[0]} ${nums[2]} _$(ref)_off 0 TS_$(ref)`,
        );
      }
    }
    if (id !== 'relay_coil')
      defs.push(
        `.model TS_$(ref) SW(Ron=${f('OnResistance', 0.1)} Roff=${f(
          'OffResistance',
          '1g',
        )} Vt=0.5 Vh=0)`,
      );
  } else if (['seven_segment_anode', 'seven_segment_cathode'].includes(id)) {
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'])
      emit(
        `D$(ref)_${name} ${
          id.endsWith('anode')
            ? p('COM') + ' ' + p(name)
            : p(name) + ' ' + p('COM')
        } TL_$(ref)`,
      );
    defs.push('.model TL_$(ref) D(Is=1e-20 N=2 Rs=10 Cjo=5p)');
  } else if (
    [
      'lamp',
      'speaker',
      'buzzer',
      'moisture_sensor',
      'rheostat',
      'ntc',
      'ldr',
      'strain_gauge',
      'resistance_wire',
    ].includes(id)
  ) {
    const [a, b] = pins
      .slice(0, 2)
      .map((x) => `%(${x.number ?? x.logical_number})`);
    let resistance = f(
      'Resistance',
      id === 'speaker' ? 8 : id === 'lamp' ? 100 : 1000,
    );
    if (id === 'lamp') {
      resistance = `${f('ColdResistance', 10)}*(1+${f(
        'TemperatureCoefficient',
        0.0045,
      )}*v(_$(ref)_thermal))`;
      emit(
        `B$(ref)_heat 0 _$(ref)_thermal I={v(${a},${b})*v(${a},${b})/max(1u,${resistance})}`,
        `C$(ref)_thermal _$(ref)_thermal 0 ${f('HeatCapacity', '.01')} IC=0`,
        `R$(ref)_thermal _$(ref)_thermal 0 ${f('ThermalResistance', 100)}`,
      );
    }
    if (id === 'ntc')
      resistance = `${f('R25', '10k')}*exp(${f('Beta', 3950)}*(1/(273.15+(${f(
        'Temperature',
        25,
      )}))-1/298.15))`;
    if (id === 'ldr')
      resistance = `max(${f('MinimumResistance', 100)},${f(
        'DarkResistance',
        '1meg',
      )}/(1+(${f('Illuminance', 100)})/${f('LuxScale', 1)}))`;
    if (id === 'strain_gauge')
      resistance = `${f('NominalResistance', 120)}*(1+${f(
        'GaugeFactor',
        2,
      )}*(${f('Strain', 0)}))`;
    if (id === 'moisture_sensor')
      resistance = `max(${f('WetResistance', '1k')},${f(
        'DryResistance',
        '1meg',
      )}*(1-min(1,max(0,${f('Moisture', 0.5)}))))`;
    if (id === 'speaker' || id === 'buzzer') {
      emit(
        `R$(ref)_voice ${a} _$(ref)_voice ${f(
          'VoiceResistance',
          id === 'speaker' ? 8 : 100,
        )}`,
        `L$(ref)_voice _$(ref)_voice _$(ref)_motion ${f('Inductance', '1m')}`,
        `R$(ref)_motion _$(ref)_motion ${b} ${f('MotionalResistance', 20)}`,
        `L$(ref)_motion _$(ref)_motion ${b} ${f('MotionalInductance', '10m')}`,
        `C$(ref)_motion _$(ref)_motion ${b} ${f(
          'MotionalCapacitance',
          '100u',
        )}`,
      );
    } else emit(`R$(ref) ${a} ${b} {max(1u,${resistance})}`);
  } else if (id === 'wheatstone_bridge') {
    for (const [i, a, b] of [
      [1, 'EXC+', 'SIG+'],
      [2, 'SIG+', 'EXC-'],
      [3, 'EXC+', 'SIG-'],
      [4, 'SIG-', 'EXC-'],
    ])
      emit(`R$(ref)_${i} ${p(a)} ${p(b)} ${f('Arm' + i, '1k')}`);
  } else if (
    [
      'darlington_npn',
      'darlington_pnp',
      'jfet_n',
      'jfet_p',
      'photodiode',
      'solar_cell',
      'thyristor',
      'comparator',
      'timer_555',
    ].includes(id)
  ) {
    if (id.startsWith('darlington')) {
      emit(
        `Q$(ref)_1 ${p('C')} ${p('B')} _$(ref)_mid TQ_$(ref)`,
        `Q$(ref)_2 ${p('C')} _$(ref)_mid ${p('E')} TQ_$(ref)`,
      );
      defs.push(
        `.model TQ_$(ref) ${
          id.endsWith('npn') ? 'NPN' : 'PNP'
        }(BF=100 IS=1e-14 VAF=100)`,
      );
    } else if (id.startsWith('jfet')) {
      emit(`J$(ref) ${p('D')} ${p('G')} ${p('S')} TJ_$(ref)`);
      defs.push(
        `.model TJ_$(ref) ${id.endsWith('_n') ? 'NJF' : 'PJF'}(Vto=${f(
          'PinchOff',
          id.endsWith('_n') ? -2 : 2,
        )} Beta=${f('Beta', '1m')})`,
      );
    } else if (id === 'photodiode' || id === 'solar_cell') {
      const a = p(has('A') ? 'A' : '+'),
        b = p(has('K') ? 'K' : '-');
      emit(
        `D$(ref) ${a} ${b} TD_$(ref)`,
        `I$(ref)_photo ${b} ${a} {${f(
          'Responsivity',
          id === 'solar_cell' ? '.01' : '1u',
        )}*(${f('Illuminance', 100)})}`,
        `R$(ref)_leak ${a} ${b} 1g`,
      );
      defs.push('.model TD_$(ref) D(Is=1e-12 N=1.5 Cjo=10p)');
    } else if (id === 'comparator')
      voltage(
        'out',
        p('OUT'),
        lo,
        `${v('IN+', p('IN-'))}>${f('Offset', 0)} ? max(0,${high}-${f(
          'Headroom',
          0.2,
        )}) : 0`,
      );
    else if (id === 'thyristor') {
      emit(
        `Q$(ref)_p _$(ref)_bn _$(ref)_bp ${p('A')} TP_$(ref)`,
        `Q$(ref)_n _$(ref)_bp _$(ref)_bn ${p('K')} TN_$(ref)`,
        `R$(ref)_gate ${p('G')} _$(ref)_bn 10`,
        `R$(ref)_shunt _$(ref)_bn ${p('K')} 1k`,
      );
      defs.push(
        '.model TP_$(ref) PNP(BF=20 IS=1e-14)\n.model TN_$(ref) NPN(BF=20 IS=1e-14)',
      );
    } else {
      const reset = norm(
          'reset',
          `${v('RESET_N', lo)}<0.7 || ${v('THRESH', lo)}>${v('CTRL', lo)}`,
        ),
        set = norm('set', `${v('TRIG', lo)}<0.5*${v('CTRL', lo)}`);
      state('0', '0', '0', reset, set, 0, true);
      drive('OUT', q(0));
      emit(
        `R$(ref)_div1 ${p('VCC')} ${p('CTRL')} 5k`,
        `R$(ref)_div2 ${p('CTRL')} ${p('GND')} 10k`,
      );
      const discharge = norm('discharge', `1-${q(0)}`);
      emit(`S$(ref)_dis ${p('DISCH')} ${p('GND')} ${discharge} 0 TS_$(ref)`);
      defs.push('.model TS_$(ref) SW(Ron=10 Roff=1e12 Vt=0.5 Vh=0)');
    }
  } else if (
    [
      'resistor',
      'capacitor',
      'capacitor_plates',
      'capacitor_polarised',
      'capacitor_variable',
      'inductor',
    ].includes(id)
  ) {
    const [a, b] = pins.map((x) => `%(${x.number ?? x.logical_number})`),
      kind = id === 'resistor' ? 'R' : id === 'inductor' ? 'L' : 'C';
    emit(
      `${kind}$(ref) ${a} ${b} ${f(
        'Value',
        kind === 'R' ? '1k' : kind === 'L' ? '1m' : '100n',
      )}`,
    );
  } else if (id === 'potentiometer') {
    emit(
      `R$(ref)_a ${p('END_A')} ${p('WIPER')} {max(1u,${f('Value', '10k')}*${f(
        'Wiper',
        0.5,
      )})}`,
      `R$(ref)_b ${p('WIPER')} ${p('END_B')} {max(1u,$(Value)*(1-$(Wiper)))}`,
    );
  } else if (['diode', 'diode_rectifier', 'led', 'zener'].includes(id)) {
    emit(`D$(ref) ${p('A')} ${p('K')} TD_$(ref)`);
    defs.push(
      `.model TD_$(ref) D(Is=${id === 'led' ? '1e-20' : '1e-12'} N=${
        id === 'led' ? 2 : 1.5
      } Rs=1 Bv=${f(
        'BreakdownVoltage',
        id === 'zener' ? 5.1 : 100,
      )} Ibv=1m Cjo=5p)`,
    );
  } else if (['bjt_npn', 'bjt_pnp'].includes(id)) {
    emit(`Q$(ref) ${p('C')} ${p('B')} ${p('E')} TQ_$(ref)`);
    defs.push(
      `.model TQ_$(ref) ${id === 'bjt_npn' ? 'NPN' : 'PNP'}(BF=${f(
        'Beta',
        100,
      )} IS=1e-14 VAF=100 Cje=10p Cjc=5p)`,
    );
  } else if (['mosfet_n', 'mosfet_p'].includes(id)) {
    emit(`M$(ref) ${p('D')} ${p('G')} ${p('S')} ${p('S')} TM_$(ref)`);
    defs.push(
      `.model TM_$(ref) ${id === 'mosfet_n' ? 'NMOS' : 'PMOS'}(LEVEL=1 VTO=${f(
        'Threshold',
        id === 'mosfet_n' ? 2 : -2,
      )} KP=${f('Kp', '.02')} LAMBDA=.02)`,
    );
  } else if (id === 'opamp')
    voltage(
      'out',
      p('OUT'),
      lo,
      `min(max(0,${high}-1),max(1,${f('Gain', '200k')}*${v(
        'IN+',
        p('IN-'),
      )}+(${high})/2))`,
    );
  else throw Error('No teaching model implemented for ' + id);

  // Functions reused in nested contexts must not inherit a symbol's reference.
  const modelText = lines.join('\n') + defs.join('\n');
  for (const key of Object.keys(fields))
    if (!modelText.includes('$(' + key + ')')) delete fields[key];
  const attributes = Object.entries(fields).map(([AttName, AttValue]) => ({
    AttName,
    AttValue,
    ShowAtt: 1,
  }));
  attributes.push({
    AttName: '$$SPICE',
    AttValue: lines.join('\n'),
    ShowAtt: 2,
  });
  const prolog = [...new Set(defs)]
    .join('\n')
    .replace(/\bTC_FF\b/g, 'TC_FF_$(ref)')
    .replace(/\bTC_LATCH\b/g, 'TC_LATCH_$(ref)');
  if (defs.length)
    attributes.push({
      AttName: '$$SPICE_PROLOG',
      AttValue: prolog,
      ShowAtt: 2,
    });
  attributes.push({
    AttName: 'Simulation model',
    AttValue: 'TinyCAD configurable educational equivalent',
    ShowAtt: 1,
  });
  return {
    attributes,
    fields,
    template: lines.join('\n'),
    prolog,
    backend: 'spice',
  };
}

export function applyTeachingModels(library, records) {
  for (const [i, record] of records.entries()) {
    const r = record.requirement,
      c = record.candidate;
    const model = teachingModel(r.id, r.pins, { edge: c.clockEdge });
    library.names[i].Attributes = [
      ...(library.names[i].Attributes || []).filter(
        (a) =>
          !a.AttName.startsWith('$$SPICE') &&
          !Object.hasOwn(model.fields, a.AttName),
      ),
      ...model.attributes,
    ];
  }
}
