// Audited against simulation/controlSymbols.ts, controls.ts and instruments.ts.
// These are dependencies of teaching circuits, never library artwork requests.
export const teachingNativeTools = {
  multimeter: { native_tool: 'meter' },
  oscilloscope: { native_tool: 'scope' },
  function_generator: { native_tool: 'generator' },
  bench_supply: { native_tool: 'supply' },
  voltage_probe: { native_tool: 'probe' },
  differential_probe: { native_tool: 'differential-probe' },
  current_probe: { native_tool: 'current-probe' },
  ammeter: { native_tool: 'meter', configuration: { mode: 'dcA' } },
  voltmeter: { native_tool: 'meter', configuration: { mode: 'dcV' } },
  ohmmeter: { native_tool: 'meter', configuration: { mode: 'ohm' } },
  source_dc: { native_tool: 'source', configuration: { type: 'voltage', waveform: 'dc' } },
  current_source: { native_tool: 'source', configuration: { type: 'current', waveform: 'dc' } },
  source_sine: { native_tool: 'source', configuration: { type: 'voltage', waveform: 'sine' } },
  source_pulse: { native_tool: 'source', configuration: { type: 'voltage', waveform: 'pulse' } },
  source_pwl: { native_tool: 'source', configuration: { type: 'voltage', waveform: 'pwl' } },
  source_fm: { native_tool: 'source', configuration: { type: 'voltage', waveform: 'fm' } },
  vcvs: { native_tool: 'controlled', configuration: { type: 'voltage' } },
  vccs: { native_tool: 'controlled', configuration: { type: 'current' } },
};
