import { saveAs } from 'file-saver';
import { NetlistData } from './netlistGenerator';
import { writeVHDL } from './netlistVHDL';
import { writeSpice } from './netlistSpice';

// Create netlist and output as a PCB file (PADS-PCB)
function writePADS(netlist: NetlistData, withValue: boolean) {
  let txt = '';
  txt += '*PADS-PCB*\n';

  // Output the Parts
  txt += '*PART*\n';
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i];
    const ref = symbol[1].text.find((v) => v.description == 'Ref')?.value;
    const value = symbol[1].text.find((v) => v.description == 'Name')?.value;
    const pkg =
      symbol[1].text.find((v) => v.description == 'Package')?.value ??
      "This part has no 'Package' attribute";

    if (withValue && !!value) {
      txt += `${ref.padEnd(8, ' ')}${value}@${pkg}\n`;
    } else {
      txt += `${ref.padEnd(8, ' ')}${pkg}\n`;
    }
  }

  // Now output the netlists
  txt += '\n*NET*\n';
  for (let index in netlist.nets) {
    const entries = netlist.nets[index].filter((entry) => !!entry.reference);

    // Only output nets with more than one entry (count > 1)
    if (entries.length <= 1) {
      continue;
    }

    const net = entries
      .map((entry) => `${entry.reference}.${entry.pin}`)
      .reduce(
        (prev, curr) => {
          const l = prev.length - 1;
          if (prev[l].length + curr.length > 127) {
            prev = [...prev, curr];
          } else if (prev[l].length == 0) {
            prev[l] = curr;
          } else {
            prev[l] += ' ' + curr;
          }
          return prev;
        },
        [''],
      )
      .join('\n');

    let label = Object.keys(netlist.labels).find(
      (key) => netlist.labels[key] === index,
    );
    if (!label) {
      label = `N${index.padStart(6, '0')}`;
    }

    txt += `*SIGNAL*  ${label}\n${net}\n`;
  }
  txt += '*END*\n';

  return txt;
}

// Create netlist and output as a Eagle PCB script
function writeEagle(netlist: NetlistData) {
  let txt = '';

  // Output the Parts
  let x_pos = 1;
  let y_pos = 1;
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i];
    const ref = symbol[1].text.find((v) => v.description == 'Ref')?.value;
    // const value = symbol[1].text.find((v) => v.description == 'Name')?.value;
    const pkg =
      symbol[1].text.find((v) => v.description == 'Package')?.value ??
      "This part has no 'Package' attribute";

    txt += `ADD '${ref}' ${pkg} R0 (0.${x_pos} 0.${y_pos});\n`;
    ++x_pos;
    if (x_pos === 10) {
      x_pos = 1;
      ++y_pos;
    }
  }

  txt += '\n\n';

  // Now output the netlists
  for (let index in netlist.nets) {
    const entries = netlist.nets[index].filter((entry) => !!entry.reference);

    // Only output if there's at least one reference
    if (entries.length === 0) {
      continue;
    }

    const net = entries
      .map((entry) => `   ${entry.reference} ${entry.pin}\n`)
      .join('');

    let label = Object.keys(netlist.labels).find(
      (key) => netlist.labels[key] === index,
    );
    if (!label) {
      label = `N${index.padStart(6, '0')}`;
    }

    txt += `SIGNAL ${label}\n${net}   ;\n`;
  }

  return txt;
}

// Create netlist and output as a Protel PCB script
function writeProtel(netlist: NetlistData) {
  let txt = '';

  // Output the Parts
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i];
    const ref = symbol[1].text.find((v) => v.description == 'Ref')?.value;
    const value = symbol[1].text.find((v) => v.description == 'Name')?.value;
    const pkg =
      symbol[1].text.find((v) => v.description == 'Package')?.value ??
      "This part has no 'Package' attribute";

    txt += `[\n${ref}\n${pkg}\n${value}\n\n\n\n]\n`;
  }

  // Now output the netlists
  for (let index in netlist.nets) {
    const entries = netlist.nets[index].filter((entry) => !!entry.reference);

    // Only output nets with more than one entry (count > 1)
    if (entries.length <= 1) {
      continue;
    }

    const net = entries
      .map((entry) => `${entry.reference}-${entry.pin}`)
      .join('\n');

    let label = Object.keys(netlist.labels).find(
      (key) => netlist.labels[key] === index,
    );
    if (!label) {
      label = `N${index.padStart(6, '0')}`;
    }

    txt += `(\n${label}\n${net}\n)\n`;
  }

  return txt;
}

// Create netlist and output as a PCB GPLEDA PCB script
function writePCB(netlist: NetlistData) {
  let txt = '';

  // Output the netlists
  for (let index in netlist.nets) {
    const entries = netlist.nets[index].filter((entry) => !!entry.reference);

    // Only output if there's at least one reference
    if (entries.length === 0) {
      continue;
    }

    // Build the net line with line wrapping after every ~40 characters
    let theLine = '';
    let count = 0;
    for (const entry of entries) {
      const add = `${entry.reference}-${entry.pin} `;
      theLine += add;
      count++;
      if (count > 40) {
        count = 0;
        theLine += ' \\\n ';
      }
    }

    let label = Object.keys(netlist.labels).find(
      (key) => netlist.labels[key] === index,
    );
    if (!label) {
      label = `N${index.padStart(6, '0')}`;
    }

    txt += ` ${label}   ${theLine}\n`;
  }

  return txt;
}




export function downloadNetlist(
  filename: string,
  file_type: string,
  netlist: NetlistData,
) {
  let txt = null;
  let ext = null;
  switch (file_type) {
    case 'SPICE':
      txt = writeSpice(netlist);
      ext = '.cir';
      break;
    case 'VHDL':
      txt = writeVHDL(netlist, filename);
      ext = '.vhdl';
      break;
    case 'PADS-PCB':
      txt = writePADS(netlist, false);
      ext = '.net';
      break;
    case 'PADS-PCB-WITH-VALUE':
      txt = writePADS(netlist, true);
      ext = '.net';
      break;
    case 'Eagle SCR':
      txt = writeEagle(netlist);
      ext = '.scr'; // Fixed extension for Eagle SCR
      break;
    case 'Protel':
      txt = writeProtel(netlist);
      ext = '.net';
      break;
    case 'gEDA PCB':
      txt = writePCB(netlist);
      ext = '.net';
      break;
  }

  txt = txt.replaceAll('\n', '\r\n');
  filename = filename.replace(/\.[^/.]+$/, '') + ext;

  var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, filename);
}
