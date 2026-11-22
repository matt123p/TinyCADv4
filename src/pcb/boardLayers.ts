export const boardLayers = [
  { id: 'F.Cu', label: 'Top copper', color: '#b17a2d', kicadId: 0 },
  { id: 'B.Cu', label: 'Bottom copper', color: '#397188', kicadId: 2 },
  { id: 'F.Adhes', label: 'Top adhesive', color: '#945b84', kicadId: 9 },
  { id: 'B.Adhes', label: 'Bottom adhesive', color: '#aa678d', kicadId: 11 },
  { id: 'F.Paste', label: 'Top solder paste', color: '#83877b', kicadId: 13 },
  { id: 'B.Paste', label: 'Bottom solder paste', color: '#789698', kicadId: 15 },
  { id: 'F.SilkS', label: 'Top silkscreen', color: '#604f21', kicadId: 5 },
  { id: 'B.SilkS', label: 'Bottom silkscreen', color: '#496576', kicadId: 7 },
  { id: 'F.Mask', label: 'Top solder mask', color: '#7e327c', kicadId: 1 },
  { id: 'B.Mask', label: 'Bottom solder mask', color: '#367669', kicadId: 3 },
  { id: 'Dwgs.User', label: 'User drawings', color: '#455c73', kicadId: 17, kicadName: 'User.Drawings' },
  { id: 'Cmts.User', label: 'User comments', color: '#4467a0', kicadId: 19, kicadName: 'User.Comments' },
  { id: 'Eco1.User', label: 'User Eco 1', color: '#548947', kicadId: 21, kicadName: 'User.Eco1' },
  { id: 'Eco2.User', label: 'User Eco 2', color: '#746c22', kicadId: 23, kicadName: 'User.Eco2' },
  { id: 'Edge.Cuts', label: 'PCB edge cuts', color: '#465b52', kicadId: 25 },
  { id: 'Margin', label: 'Margin', color: '#ad4f7e', kicadId: 27 },
  { id: 'F.CrtYd', label: 'Top courtyard', color: '#885888', kicadId: 31 },
  { id: 'B.CrtYd', label: 'Bottom courtyard', color: '#36778a', kicadId: 29 },
  { id: 'F.Fab', label: 'Top fabrication', color: '#6a5751', kicadId: 35 },
  { id: 'B.Fab', label: 'Bottom fabrication', color: '#556e67', kicadId: 33 },
] as const;

export type BoardLayerId = (typeof boardLayers)[number]['id'];
export type VisibleCopper = 'top' | 'bottom' | 'all' | 'none';

export const boardLayerById = new Map(boardLayers.map((layer) => [layer.id, layer]));

export function placedBoardLayer(layer: BoardLayerId, side: 'top' | 'bottom'): BoardLayerId {
  if (side === 'top' || !/^[FB]\./.test(layer)) return layer;
  return ((layer[0] === 'F' ? 'B' : 'F') + layer.slice(1)) as BoardLayerId;
}
