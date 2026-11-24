import openjellybean from '../../bundled-libraries/spice/openjellybean.json';
import circsim from '../../bundled-libraries/spice/circsim.json';
import spiceFiles from '../../bundled-libraries/spice/spice-files.json';
import ngspiceSpecial from '../../bundled-libraries/spice/ngspice-special.json';
import ngspiceXspice from '../../bundled-libraries/spice/ngspice-xspice.json';
import sky130 from '../../bundled-libraries/spice/sky130.json';
import gf180mcu from '../../bundled-libraries/spice/gf180mcu.json';
import ihpSg13g2 from '../../bundled-libraries/spice/ihp-sg13g2.json';
import basic from '../../bundled-libraries/spice/basic.json';
import type { SpiceModelPack } from './catalogBindings';

export const bundledSpiceCatalogs = [
  openjellybean, circsim, spiceFiles, ngspiceSpecial, ngspiceXspice,
  sky130, gf180mcu, ihpSg13g2, { ...basic, pack: { ...basic.pack, format: 'templates' as const } },
];

export const bundledSpicePacks: SpiceModelPack[] = bundledSpiceCatalogs.map(({ pack }) => pack);
