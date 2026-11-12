// Product / service catalog for the configurator.
// All money in USD. crewHours = person-hours to install. flownKg = weight hung from venue rigging.
// amps = 3-phase 208V amps draw. truck = fraction of a 53' trailer.

export const VENUES = {
  ballroom: {
    name: 'Hotel Ballroom', desc: '40 × 32 m · 7.5 m ceiling',
    w: 40, d: 32, ceiling: 7.5, rigLimitKg: 4500, amps: 400, capacity: 1000,
    accessHours: 24, layout: 'seated', indoor: true, venueDayRate: 6500, power: 'house',
  },
  convention: {
    name: 'Convention Hall', desc: '80 × 54 m · 14 m ceiling',
    w: 80, d: 54, ceiling: 14, rigLimitKg: 22000, amps: 1200, capacity: 5200,
    accessHours: 36, layout: 'seated', indoor: true, venueDayRate: 18000, power: 'house',
  },
  outdoor: {
    name: 'Outdoor Festival Field', desc: '120 × 130 m · open air',
    w: 120, d: 130, ceiling: 40, rigLimitKg: 0, amps: 0, capacity: 22000,
    accessHours: 72, layout: 'standing', indoor: false, venueDayRate: 12000, power: 'generator',
  },
};

export const STAGES = {
  s: { name: 'Compact riser', desc: '12 × 6 m', w: 12, d: 6, h: 1.0, cost: 4800, crewHours: 24, truck: 0.4 },
  m: { name: 'Standard stage', desc: '18 × 9 m', w: 18, d: 9, h: 1.2, cost: 9500, crewHours: 48, truck: 0.8 },
  l: { name: 'Concert stage', desc: '24 × 12 m + thrust', w: 24, d: 12, h: 1.5, cost: 21000, crewHours: 96, truck: 1.6, thrust: true },
};

// Screen packages. Each screen: x offset (relative to stage centre), w, h, bottom (m above stage deck), type
export const SCREENS = {
  none: { name: 'No screens', desc: 'Stage only', screens: [], cost: 0, crewHours: 0, flownKg: 0, amps: 0, truck: 0 },
  proj: {
    name: 'Projection pair', desc: '2 × 5 m screens, 20K lumen',
    screens: [{ x: -1, w: 5, h: 2.8, bottom: 1.6, side: true, type: 'proj' }, { x: 1, w: 5, h: 2.8, bottom: 1.6, side: true, type: 'proj' }],
    cost: 11500, crewHours: 32, flownKg: 400, amps: 40, truck: 0.5, note: 'Needs dimmed room; washed out by stage lighting.',
  },
  ledC: {
    name: 'Centre LED wall', desc: '8 × 4.5 m, 2.6 mm',
    screens: [{ x: 0, w: 8, h: 4.5, bottom: 0.4, type: 'led' }],
    cost: 26000, crewHours: 56, flownKg: 1300, amps: 90, truck: 1.0,
  },
  ledImag: {
    name: 'LED wall + IMAG', desc: '12 × 6 m centre + 2 × 5 m IMAG + cameras',
    screens: [{ x: 0, w: 12, h: 6, bottom: 1.2, type: 'led' }, { x: -1, w: 5, h: 3, bottom: 2.5, side: true, type: 'led' }, { x: 1, w: 5, h: 3, bottom: 2.5, side: true, type: 'led' }],
    cost: 58000, crewHours: 120, flownKg: 3400, amps: 240, truck: 2.0, note: 'Includes 3-camera IMAG package + switcher.',
  },
  ledPano: {
    name: 'Panoramic LED', desc: '24 × 7 m wraparound + IMAG',
    screens: [{ x: 0, w: 24, h: 7, bottom: 0.6, type: 'led', curved: true }, { x: -1, w: 6, h: 3.4, bottom: 3, side: true, type: 'led' }, { x: 1, w: 6, h: 3.4, bottom: 3, side: true, type: 'led' }],
    cost: 112000, crewHours: 230, flownKg: 6900, amps: 460, truck: 3.5,
  },
};

// Audio systems. spl1m = dB SPL at 1 m on-axis; hCov/vCov = coverage degrees; line = line source (cylindrical near-field)
export const AUDIO = {
  point: {
    name: 'Point-source PA', desc: '2 tops + 2 subs on stands', cost: 4200, crewHours: 12, flownKg: 0, amps: 30, truck: 0.3,
    sources: [{ side: -1, h: 3.2, spl1m: 131, hCov: 90, vCov: 40, line: false, flown: false }, { side: 1, h: 3.2, spl1m: 131, hCov: 90, vCov: 40, line: false, flown: false }],
  },
  line: {
    name: 'Flown line array', desc: 'L/R 12-box arrays + ground subs', cost: 21000, crewHours: 48, flownKg: 1900, amps: 120, truck: 1.2,
    sources: [{ side: -1, h: 7.5, spl1m: 133, hCov: 100, vCov: 22, line: true, flown: true, len: 5 }, { side: 1, h: 7.5, spl1m: 133, hCov: 100, vCov: 22, line: true, flown: true, len: 5 }],
  },
  lineFull: {
    name: 'Line array + fills', desc: 'Main L/R, out-fills, front-fills, cardioid subs', cost: 38000, crewHours: 80, flownKg: 3000, amps: 190, truck: 1.8,
    sources: [
      { side: -1, h: 8, spl1m: 134, hCov: 90, vCov: 18, line: true, flown: true, len: 6 },
      { side: 1, h: 8, spl1m: 134, hCov: 90, vCov: 18, line: true, flown: true, len: 6 },
      { side: -1.6, h: 6.5, spl1m: 129, hCov: 90, vCov: 30, line: true, flown: true, len: 3, outfill: true },
      { side: 1.6, h: 6.5, spl1m: 129, hCov: 90, vCov: 30, line: true, flown: true, len: 3, outfill: true },
      { side: 0, h: 1.0, spl1m: 118, hCov: 120, vCov: 60, line: false, flown: false, front: true },
    ],
  },
};

export const DELAYS = { name: 'Delay towers', desc: '2 delay positions mid-house, time-aligned', cost: 9500, crewHours: 24, flownKg: 0, amps: 40, truck: 0.5 };

export const LIGHTING = {
  basic: { name: 'Basic stage wash', desc: '16 LED wash on stands, front light', cost: 5200, crewHours: 16, flownKg: 300, amps: 40, truck: 0.4, movers: 0, truss: 1, programHours: 2 },
  rig: { name: 'Truss rig + movers', desc: '3 truss lines, 18 moving heads', cost: 19500, crewHours: 64, flownKg: 2200, amps: 160, truck: 1.2, movers: 18, truss: 3, programHours: 6 },
  concert: { name: 'Concert lighting', desc: 'Pods + 40 movers, haze, follow-spots', cost: 52000, crewHours: 150, flownKg: 5200, amps: 380, truck: 2.5, movers: 40, truss: 5, programHours: 12 },
};

export const RATES = {
  crewHour: 68,            // blended stagehand rate
  overtimeMult: 1.5,       // beyond 10h per crew day
  truck: 2800,             // per trailer round-trip
  generatorPer100A: 1400,  // per show day incl. fuel
  groundSupport: 16000,    // ground-support towers for outdoor / overloaded rigging
  groundSupportHours: 60,
  stageRoof: 38000,
  stageRoofHours: 140,
  productionMgmt: 0.10,    // % of equipment+labor
  contingency: 0.07,
};
