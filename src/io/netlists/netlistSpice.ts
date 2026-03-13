import { NetlistData } from './netlistGenerator';
import { updateSymbol } from '../../manipulators/updateSymbol';
import { dsnSymbol } from '../../model/dsnItem';

function getPinInfo(val: string, symbol: dsnSymbol, netlist: NetlistData) {
    const updater = new updateSymbol(symbol);
    const pins = updater.active_points();

    // Look up the pin number first, then if not found, see if it can be found as a pin name instead.
    // This maintains strict compatibility with a PSpice extended feature that allows macros to reference
    // either the pin number (very common) or the pin name (a little less common)
    let pin = pins.find(p => p[2].number === val);
    if (!pin) pin = pins.find(p => p[2].name === val);

    if (pin) {
        const pinNum = pin[2].number;
        const refDes = symbol.text.find(t => t.description === 'Ref')?.value;

        for (let nid in netlist.nets) {
            const nodes = netlist.nets[nid];
            const found = nodes.find(n => n.reference === refDes && n.pin === pinNum);
            if (found) {
                return { pin, netId: nid, nodeCount: nodes.length, pinNum };
            }
        }
        // Exists but not connected to other components in a recognized net
        return { pin, netId: null, nodeCount: 1, pinNum };
    }
    return null;
}

function evalSpiceMacro(
    macro: string,
    symbol: dsnSymbol,
    netlist: NetlistData,
    sheetName: string
): boolean {
    const brk = macro.indexOf('(');
    if (brk === -1) return false;

    const op = macro.substring(0, brk).trim();
    let value = macro.substring(brk + 1).trim();
    if (value.endsWith(')')) {
        value = value.substring(0, value.length - 1);
    }
    value = value.trim();

    if (op === 'defined') {
        return !!symbol.text.find(t => t.description === value);
    } else if (op === 'not_defined') {
        return !symbol.text.find(t => t.description === value);
    } else if (op === 'empty') {
        const attr = symbol.text.find(t => t.description === value);
        return !attr || attr.value === '';
    } else if (op === 'not_empty') {
        const attr = symbol.text.find(t => t.description === value);
        return !!(attr && attr.value !== '');
    } else if (op === 'connected') {
        const info = getPinInfo(value, symbol, netlist);
        return info ? info.nodeCount > 1 : false;
    } else if (op === 'not_connected') {
        const info = getPinInfo(value, symbol, netlist);
        return info ? info.nodeCount === 1 : false;
    } else if (op === 'include') {
        // Not implemented
        return false;
    }
    return false;
}

// Helper to expand SPICE variables
function expandSpice(
    spice: string,
    symbol: dsnSymbol,
    netlist: NetlistData,
    sheetName: string
): string {
    let res = '';
    let mode = 'normal';
    let lookup = '';
    
    // For macro expansion
    let macroStrings: string[] = [];
    let brackets = 0;

    const getRefDes = () => {
        return symbol.text.find(t => t.description === 'Ref')?.value || '';
    };

    // Returns the net label (for %) or null if not found
    const findNetLabel = (val: string): string | null => {
        const info = getPinInfo(val, symbol, netlist);
        if (info && info.netId) {
            // Check preferredLabel first (user-assigned labels)
            let label = Object.keys(netlist.labels).find(key => netlist.labels[key] === info.netId);
            if (label) {
                return label;
            }
            // Construct a label from the net id
            return `_N_${info.netId}`;
        }
        return null;
    };

    // Returns the raw net number (for @)
    const findNetNumber = (val: string): string | null => {
        const info = getPinInfo(val, symbol, netlist);
        if (info && info.netId) {
            return info.netId;
        }
        return null;
    };

    const findAttr = (val: string): { found: boolean; value: string } => {
        // Special handling for 'ref' and 'refnum' like C++ get_attr
        if (val.toLowerCase() === 'ref') {
            const refDes = getRefDes();
            return { found: !!refDes, value: refDes };
        } else if (val.toLowerCase() === 'refnum') {
            // Use the reference number (minus the reference character)
            const refDes = getRefDes();
            const match = refDes.match(/[0-9]+/);
            if (match) {
                return { found: true, value: match[0] };
            }
            return { found: !!refDes, value: refDes };
        }
        const attr = symbol.text.find(t => t.description === val);
        return { found: !!attr, value: attr ? attr.value : '' };
    };

    for (let i = 0; i < spice.length; i++) {
        const c = spice[i];
        if (mode === 'normal') {
            if (c === '%') mode = 'awaiting_pin';
            else if (c === '@') mode = 'awaiting_net';
            else if (c === '$') mode = 'awaiting_attr';
            else if (c === '?') mode = 'awaiting_macro';
            else if (c === '\\') mode = 'awaiting_escape';
            else if (c === '\r') {
                // Filter out \r to prevent \r\r\n sequences in output
                // (each \n may get expanded to \r\n by the runtime)
            }
            else res += c;
        } else if (mode === 'awaiting_escape') {
            res += c;
            mode = 'normal';
        } else if (mode === 'awaiting_pin') {
            if (c === '(') { mode = 'reading_pin'; lookup = ''; }
            else { res += c; mode = 'normal'; }
        } else if (mode === 'reading_pin') {
            if (c === ')') {
                // %() expands pin to net label name
                const label = findNetLabel(lookup);
                if (label !== null) {
                    res += label;
                } else {
                    res += `<pin '${lookup}' not found>`;
                }
                mode = 'normal';
            } else {
                lookup += c;
            }
        } else if (mode === 'awaiting_attr') {
            if (c === '(') { mode = 'reading_attr'; lookup = ''; }
            else { res += c; mode = 'normal'; }
        } else if (mode === 'reading_attr') {
            if (c === ')') {
                const attrResult = findAttr(lookup);
                if (attrResult.found) {
                    res += attrResult.value;
                } else {
                    res += `<attr '${lookup}' not found>`;
                }
                mode = 'normal';
            } else {
                lookup += c;
            }
        } else if (mode === 'awaiting_net') {
            if (c === '(') { mode = 'reading_net'; lookup = ''; }
            else { res += c; mode = 'normal'; }
        } else if (mode === 'reading_net') {
            if (c === ')') {
                // @() expands pin to raw net number
                const netNum = findNetNumber(lookup);
                if (netNum !== null) {
                    res += netNum;
                } else {
                    res += `<pin '${lookup}' not found>`;
                }
                mode = 'normal';
            } else {
                lookup += c;
            }
        } else if (mode === 'awaiting_macro') {
            if (c === '(') {
                mode = 'reading_macro';
                lookup = '';
                brackets = 1;
                macroStrings = [];
            } else {
                res += c;
                mode = 'normal';
            }
        } else if (mode === 'reading_macro') {
            if (c === '\\') {
                if (brackets === 1) mode = 'awaiting_macro_escape';
                else lookup += '\\';
            } else if (c === ',') {
                if (brackets === 1) {
                    macroStrings.push(lookup);
                    lookup = '';
                } else {
                    lookup += c;
                }
            } else if (c === '(') {
                brackets++;
                lookup += c;
            } else if (c === ')') {
                brackets--;
                if (brackets === 0) {
                    macroStrings.push(lookup);
                    const r = evalSpiceMacro(macroStrings[0], symbol, netlist, sheetName);
                    let insert = '';
                    if (r && macroStrings.length > 1) insert = macroStrings[1];
                    else if (!r && macroStrings.length > 2) insert = macroStrings[2];

                    // Recursive expansion
                    res += expandSpice(insert, symbol, netlist, sheetName);

                    macroStrings = [];
                    lookup = '';
                    mode = 'normal';
                } else {
                    lookup += c;
                }
            } else {
                lookup += c;
            }
        } else if (mode === 'awaiting_macro_escape') {
            lookup += c;
            mode = 'reading_macro';
        }
    }
    return res;
}

export function writeSpice(netlist: NetlistData) {
    let txt = '';
    const now = new Date();
    txt += `* Schematics Netlist created on ${now.toISOString()} *\n`;
    
    // Prolog - with priority support (0-9, output in ascending order)
    // Each priority level contains a Set of unique prolog strings
    const prologLines: Set<string>[] = Array.from({ length: 10 }, () => new Set());
    
    netlist.symbols.forEach(symRef => {
        const symbol = symRef[1];
        const prolog = symbol.text.find(t => t.description === '$$SPICE_PROLOG')?.value;
        if (prolog) {
            // Get priority (default 5)
            let priority = 5;
            const priorityAttr = symbol.text.find(t => t.description === '$$SPICE_PROLOG_PRIORITY')?.value;
            if (priorityAttr) {
                const p = parseInt(priorityAttr, 10);
                if (!isNaN(p) && p >= 0 && p <= 9) {
                    priority = p;
                }
            }
            prologLines[priority].add(expandSpice(prolog, symbol, netlist, symRef[0]));
        }
    });
    
    // Output prologs in priority order (0 first)
    for (let priority = 0; priority < 10; priority++) {
        prologLines[priority].forEach(p => {
            if (p) txt += `${p}\n`;
        });
    }

    // Symbols
    for (let i = 0; i < netlist.symbols.length; ++i) {
        const symRef = netlist.symbols[i];
        const symbol = symRef[1];
        
        let spice = symbol.text.find(t => t.description === '$$SPICE')?.value;
        if (spice) {
            const expanded = expandSpice(spice, symbol, netlist, symRef[0]);
            if (expanded) txt += `${expanded}\n`;
        } else {
            // Output NO_MODEL warning like C++ does
            const refDes = symbol.text.find(t => t.description === 'Ref')?.value || 'Unknown';
            txt += `NO_MODEL found on ${refDes}\n`;
        }
    }
    
    // Epilog - with priority support (0-9, output in descending order)
    const epilogLines: Set<string>[] = Array.from({ length: 10 }, () => new Set());
    
    netlist.symbols.forEach(symRef => {
        const symbol = symRef[1];
        const epilog = symbol.text.find(t => t.description === '$$SPICE_EPILOG')?.value;
        if (epilog) {
            // Get priority (default 5)
            let priority = 5;
            const priorityAttr = symbol.text.find(t => t.description === '$$SPICE_EPILOG_PRIORITY')?.value;
            if (priorityAttr) {
                const p = parseInt(priorityAttr, 10);
                if (!isNaN(p) && p >= 0 && p <= 9) {
                    priority = p;
                }
            }
            epilogLines[priority].add(expandSpice(epilog, symbol, netlist, symRef[0]));
        }
    });

    // Output epilogs in reverse priority order (9 first)
    for (let priority = 9; priority >= 0; priority--) {
        epilogLines[priority].forEach(p => {
            if (p) txt += `${p}\n`;
        });
    }
    
    return txt;
}
