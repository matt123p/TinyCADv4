import { NetlistData } from './netlistGenerator';
import { updateSymbol } from '../../manipulators/updateSymbol';

// Bus properties parser - matches C++ Bus_Properties class
interface BusProperties {
  name: string;
  is_bus: boolean;
  start: number;
  end: number;
  type: 'internal' | 'input' | 'output';
}

function parseBusProperties(ref: string, type: 'internal' | 'input' | 'output' = 'internal'): BusProperties {
  const result: BusProperties = {
    name: ref,
    is_bus: false,
    start: 0,
    end: 0,
    type: type
  };

  // Parse bus notation like "A(7:0)" or "B(3)"
  const match = ref.match(/^([^(]+)\((\d+)(?::(\d+))?\)$/);
  if (match) {
    result.name = match[1];
    result.is_bus = true;
    result.start = parseInt(match[2], 10);
    result.end = match[3] !== undefined ? parseInt(match[3], 10) : result.start;
    // Ensure end <= start (C++ does: if (end > start) end = start)
    if (result.end > result.start) result.end = result.start;
  }

  return result;
}

// Format signal declaration for VHDL (matches print_signal_dec / _ftprintf_signal_dec)
function formatSignalDec(bus: BusProperties): string {
  const inOrOut = bus.type === 'input' ? 'in ' : bus.type === 'output' ? 'out ' : '';
  
  if (bus.is_bus) {
    return `${bus.name}: ${inOrOut}std_logic_vector(${bus.start} downto ${bus.end})`;
  } else {
    return `${bus.name}: ${inOrOut}std_logic`;
  }
}

// Format signal reference for VHDL (matches _ftprintf_signal_ref)
function formatSignalRef(ref: string): string {
  const bus = parseBusProperties(ref);
  if (bus.is_bus) {
    if (bus.start === bus.end) {
      return `${bus.name}(${bus.start})`;
    } else {
      return `${bus.name}(${bus.start} downto ${bus.end})`;
    }
  } else {
    return bus.name;
  }
}

// Signals class - stores all signals accessed by signal name (matches C++ Signals class)
class Signals {
  private signals: Map<string, BusProperties> = new Map();

  add(bus: BusProperties): void {
    const existing = this.signals.get(bus.name);
    if (!existing) {
      this.signals.set(bus.name, { ...bus });
    } else {
      // Expand the bus range
      existing.start = Math.max(bus.start, existing.start);
      existing.end = Math.min(bus.end, existing.end);
    }
  }

  get(name: string): BusProperties | undefined {
    return this.signals.get(name);
  }

  forEach(callback: (bus: BusProperties) => void): void {
    this.signals.forEach(callback);
  }
}

// Create netlist and output as VHDL
export function writeVHDL(netlist: NetlistData, filename: string) {
  let txt = '';
  const short_filename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');

  txt += '-- File Created by TinyCad VHDL\n';
  txt += 'library ieee;\n';
  txt += 'use ieee.std_logic_1164.all;\n\n';
  txt += `entity ${short_filename} is\n`;

  // Data structures matching C++ implementation
  const referencedComponents = new Set<string>();
  const signals = new Signals();
  const mapReferenceName: { [ref: string]: string } = {};  // Maps reference to component name
  const mapPinNumberToPos: { [compName: string]: { [pinNum: string]: number } } = {};  // Maps pin number to position
  const mapPinNumberToName: { [compName: string]: { [pinNum: string]: string } } = {};  // Maps pin number to pin name
  const signalLabels: { [netId: string]: string } = {};  // Maps net index to net label
  const portmaps: { [ref: string]: { [pos: number]: string } } = {};  // Maps reference and position to signal label

  // Writes the INPUT ports
  let portStr = '';
  let first = true;
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i][1];
    const name = symbol._symbol?.name?.value || '';

    if (name === 'INPUT') {
      if (!first) portStr += ';\n\t\t';
      else first = false;

      const ref = symbol.text.find(t => t.description === 'Ref')?.value || '';
      const bus = parseBusProperties(ref, 'input');
      portStr += formatSignalDec(bus);
      signals.add(bus);
    }
  }

  // Writes the OUTPUT ports
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i][1];
    const name = symbol._symbol?.name?.value || '';

    if (name === 'OUTPUT') {
      if (!first) portStr += ';\n\t\t';
      else first = false;

      const ref = symbol.text.find(t => t.description === 'Ref')?.value || '';
      const bus = parseBusProperties(ref, 'output');
      portStr += formatSignalDec(bus);
      signals.add(bus);
    }
  }

  if (portStr) {
    txt += '\tport(\t';
    txt += portStr;
    txt += ');\n';
  }
  txt += `end ${short_filename};\n`;

  // Writes the Architecture
  txt += `\narchitecture structural of ${short_filename} is\n`;

  // Go through all the components in the design
  for (let i = 0; i < netlist.symbols.length; ++i) {
    const symbol = netlist.symbols[i][1];
    const name = symbol._symbol?.name?.value || '';
    const ref = symbol.text.find(t => t.description === 'Ref')?.value || '';

    mapReferenceName[ref] = name;

    // Do we need to output this component?
    if (name && !referencedComponents.has(name) && name !== 'INPUT' && name !== 'OUTPUT') {
      referencedComponents.add(name);

      txt += `\tcomponent ${name}\n \t\tport(\t`;

      const updater = new updateSymbol(symbol);
      const activePoints = updater.active_points();
      
      // Initialize maps for this component
      if (!mapPinNumberToPos[name]) mapPinNumberToPos[name] = {};
      if (!mapPinNumberToName[name]) mapPinNumberToName[name] = {};

      let position = 0;
      let firstPin = true;

      // Writes the input pins (elec === 0)
      for (let j = 0; j < activePoints.length; ++j) {
        const pin = activePoints[j][2];
        if (pin.elec === 0) {  // Input pin
          if (!firstPin) txt += ';\n\t\t\t';
          else firstPin = false;

          if (mapPinNumberToPos[name][pin.number] !== undefined) {
            txt += `ERROR: Duplicated pin number, ${name} pin number ${pin.number}\n`;
          }

          const pinBus = parseBusProperties(pin.name, 'input');
          txt += formatSignalDec(pinBus);
          mapPinNumberToPos[name][pin.number] = position++;
          mapPinNumberToName[name][pin.number] = pin.name;
        }
      }

      // Writes the output pins (elec === 1)
      for (let j = 0; j < activePoints.length; ++j) {
        const pin = activePoints[j][2];
        if (pin.elec === 1) {  // Output pin
          if (!firstPin) txt += ';\n\t\t\t';
          else firstPin = false;

          if (mapPinNumberToPos[name][pin.number] !== undefined) {
            txt += `ERROR: Duplicated pin number, ${name} pin number ${pin.number}\n`;
          }

          const pinBus = parseBusProperties(pin.name, 'output');
          txt += formatSignalDec(pinBus);
          mapPinNumberToPos[name][pin.number] = position++;
          mapPinNumberToName[name][pin.number] = pin.name;
        }
      }

      txt += ');\n \tend component;\n';
    }
  }

  // Writes the Signals - iterate through nets
  for (const netId in netlist.nets) {
    const nodes = netlist.nets[netId];
    
    let theLabel = '';
    let labeled = false;
    let inOut = false;
    let busSize = 0;

    // Search all the nodes of the net for a label
    for (const node of nodes) {
      // Check for explicit label
      const labelKey = Object.keys(netlist.labels).find(key => netlist.labels[key] === netId);
      if (labelKey && !labeled) {
        theLabel = labelKey;
        labeled = true;
        const bus = parseBusProperties(theLabel);
        const newBusSize = bus.start - bus.end + 1;
        if (!busSize) busSize = newBusSize;
        else if (busSize !== newBusSize) {
          txt += `ERROR: Different BUS sizes at label ${theLabel}\n`;
        }
      }

      // Check for INPUT/OUTPUT which automatically label the net
      if (node.reference) {
        const sym = netlist.symbols.find(s => 
          s[1].text.find(t => t.description === 'Ref')?.value === node.reference
        );
        if (sym) {
          const symName = sym[1]._symbol?.name?.value || '';
          if (symName === 'INPUT' || symName === 'OUTPUT') {
            theLabel = node.reference;
            labeled = true;
            inOut = true;
            const bus = parseBusProperties(theLabel);
            const newBusSize = bus.start - bus.end + 1;
            if (!busSize) busSize = newBusSize;
            else if (busSize !== newBusSize) {
              txt += `ERROR: Different BUS sizes at IN/OUT ${theLabel}\n`;
            }
          } else if (node.pin) {
            const pinName = mapPinNumberToName[symName]?.[node.pin];
            if (pinName) {
              const bus = parseBusProperties(pinName);
              const newBusSize = bus.start - bus.end + 1;
              if (!busSize) busSize = newBusSize;
              else if (busSize !== newBusSize) {
                txt += `ERROR: Different BUS sizes: ${node.reference} pin name ${pinName}, pin number ${node.pin}\n`;
              }
            }
          }
        }
      }
    }

    // Generate default label if not labeled
    if (!labeled) {
      const labelNum = parseInt(netId, 10);
      if (busSize <= 1) {
        theLabel = `N${labelNum.toString().padStart(2, '0')}`;
      } else {
        theLabel = `N${labelNum.toString().padStart(2, '0')}(${busSize - 1}:0)`;
      }
    }
    signalLabels[netId] = theLabel;

    if (!inOut) {
      const bus = parseBusProperties(theLabel, 'internal');
      signals.add(bus);
    }
  }

  // Output internal signals
  signals.forEach(bus => {
    if (bus.type === 'internal') {
      txt += '\tsignal ';
      txt += formatSignalDec(bus);
      txt += ';\n';
    }
  });

  txt += 'begin\n';

  // Go through all the signals (nets) and add them to the components portmap
  for (const netId in netlist.nets) {
    const nodes = netlist.nets[netId];
    const theLabel = signalLabels[netId];

    for (const node of nodes) {
      if (node.reference) {
        const sym = netlist.symbols.find(s => 
          s[1].text.find(t => t.description === 'Ref')?.value === node.reference
        );
        if (sym) {
          const symName = sym[1]._symbol?.name?.value || '';
          if (symName !== 'INPUT' && symName !== 'OUTPUT' && node.pin) {
            if (!portmaps[node.reference]) portmaps[node.reference] = {};
            const pos = mapPinNumberToPos[symName]?.[node.pin];
            if (pos !== undefined) {
              portmaps[node.reference][pos] = theLabel;
            }
          }
        }
      }
    }
  }

  // Prints to the file the port map of all the components
  const sortedRefs = Object.keys(portmaps).sort();
  for (const ref of sortedRefs) {
    const componentName = mapReferenceName[ref];
    txt += `\t${ref}: ${componentName} port map (`;

    const singlePortmap = portmaps[ref];
    const sortedPositions = Object.keys(singlePortmap).map(Number).sort((a, b) => a - b);
    
    let firstSig = true;
    for (const pos of sortedPositions) {
      if (firstSig) firstSig = false;
      else txt += ', ';

      let theLabel = singlePortmap[pos];

      // Use just the signal name if adequate
      const bus = parseBusProperties(theLabel);
      if (bus.is_bus) {
        const signalBus = signals.get(bus.name);
        if (signalBus && bus.start === signalBus.start && bus.end === signalBus.end) {
          theLabel = bus.name;
        }
      }

      txt += formatSignalRef(theLabel);
    }

    txt += ');\n';
  }

  txt += 'end structural;\n';
  return txt;
}
