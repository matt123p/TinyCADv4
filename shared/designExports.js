export const designExportFormats = {
  bom: {
    description: 'Bill of Materials',
    extension: '.csv',
    mime: 'text/csv',
  },
  'PADS-PCB': {
    description: 'PADS netlist',
    extension: '.net',
    mime: 'text/plain',
  },
  'PADS-PCB-WITH-VALUE': {
    description: 'PADS netlist with values',
    extension: '.net',
    mime: 'text/plain',
  },
  'Eagle SCR': {
    description: 'Eagle script',
    extension: '.scr',
    mime: 'text/plain',
  },
  Protel: {
    description: 'Protel netlist',
    extension: '.net',
    mime: 'text/plain',
  },
  'gEDA PCB': {
    description: 'gEDA netlist',
    extension: '.net',
    mime: 'text/plain',
  },
  SPICE: {
    description: 'SPICE netlist',
    extension: '.cir',
    mime: 'text/plain',
  },
  VHDL: { description: 'VHDL file', extension: '.vhdl', mime: 'text/plain' },
};

export function designExportName(name, format) {
  return name.replace(/\.[^/.]+$/, '') + designExportFormats[format].extension;
}
