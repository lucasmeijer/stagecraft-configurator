import { VENUES, STAGES, SCREENS, AUDIO, DELAYS, LIGHTING, RATES } from './catalog.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Physical layout derived from configuration
// ---------------------------------------------------------------------------
export function computeLayout(cfg) {
  const V = VENUES[cfg.venue];
  const S = STAGES[cfg.stage];
  const z0 = -V.d / 2 + 2;                 // upstage edge
  const zFront = z0 + S.d;                  // downstage lip
  const seated = V.layout === 'seated';
  const pitchX = seated ? 0.56 : 0.62;
  const pitchZ = seated ? 0.95 : 0.62;
  const ear = seated ? 1.2 : 1.65;

  // ---- audience ----
  const requested = cfg.audience;
  const n = Math.min(requested, V.capacity);
  const availW = V.w - (seated ? 6 : 8);
  const zStart = zFront + (seated ? 3 : 2.5);
  const zEndMax = V.d / 2 - 2;
  const width = Math.min(availW, Math.max(S.w + 6, Math.sqrt(n * pitchX * pitchZ) * 1.1, (n * pitchX * pitchZ * 1.25) / (zEndMax - zStart - 3)));
  const fohZ = zStart + Math.min(32, (zEndMax - zStart) * 0.55);
  const seats = [];
  const aisle = seated ? 1.8 : 0;
  let z = zStart;
  outer: while (z < zEndMax) {
    for (let x = -width / 2; x <= width / 2; x += pitchX) {
      if (seats.length >= n) break outer;
      if (Math.abs(x) < aisle / 2) continue;
      if (S.thrust && Math.abs(x) < 3 && z < zFront + 6.5) continue;
      if (Math.abs(x) < 3.5 && Math.abs(z - fohZ) < 2.5) continue; // FOH mix position
      const jitter = seated ? 0 : (Math.sin(seats.length * 12.9898) * 0.25);
      seats.push({ x: x + jitter, z: z + (seated ? 0 : Math.cos(seats.length * 78.233) * 0.15) });
    }
    z += pitchZ;
  }
  const zBack = seats.length ? seats[seats.length - 1].z : zStart;
  const audDepth = zBack - zStart;

  // ---- screens ----
  const SP = SCREENS[cfg.screens];
  const screens = SP.screens.map((s) => {
    if (s.side) {
      const x = s.x * (S.w / 2 + s.w / 2 + 1.5);
      return { ...s, cx: x, cy: S.h + s.bottom + s.h / 2, cz: zFront - 1.5, yaw: -s.x * 14 * DEG };
    }
    return { ...s, cx: 0, cy: S.h + s.bottom + s.h / 2, cz: z0 + 0.4, yaw: 0 };
  });

  // ---- audio sources ----
  const A = AUDIO[cfg.audio];
  const targetZ = zStart + audDepth * 0.66;
  const sources = [];
  for (const s of A.sources) {
    if (s.front) {
      const k = 4;
      for (let i = 0; i < k; i++) {
        const x = (-0.5 + (i + 0.5) / k) * S.w * 0.85;
        sources.push({ ...s, x, y: S.h + 0.25, z: zFront + 0.2, yaw: 0, pitch: -8 * DEG, kind: 'front' });
      }
      continue;
    }
    const sign = Math.sign(s.side);
    const x = s.outfill ? sign * (S.w / 2 + 4.5) : sign * (S.w / 2 + 1.6);
    let y = s.flown ? s.h + S.h * 0.5 : S.h + s.h * 0.6;
    if (V.indoor && s.flown) y = Math.min(y, V.ceiling - 1.4);
    const zz = zFront - 0.6;
    const yaw = s.outfill ? sign * 38 * DEG : sign * 4 * DEG;
    const dist = Math.max(6, targetZ - zz);
    const pitch = -Math.atan2(y - ear, dist) - (s.line ? 2 * DEG : 0);
    sources.push({ ...s, x, y, z: zz, yaw, pitch, kind: s.outfill ? 'outfill' : 'main' });
  }
  if (cfg.delays) {
    const dz = zStart + audDepth * 0.48;
    const dx = Math.max(6, width / 4);
    for (const sign of [-1, 1]) {
      const y = 6.5;
      sources.push({ x: sign * dx, y, z: dz, yaw: 0, pitch: -Math.atan2(y - ear, audDepth * 0.3), spl1m: 126, hCov: 100, vCov: 25, line: true, len: 3, kind: 'delay' });
    }
  }

  // ---- trusses ----
  const L = LIGHTING[cfg.lighting];
  const trussY = V.indoor ? Math.min(V.ceiling - 0.8, S.h + 9) : S.h + 10;

  return { V, S, SP, A, L, z0, zFront, zStart, zBack, audDepth, width, fohZ, seats, seated, ear, screens, sources, trussY, requested, n };
}

// ---------------------------------------------------------------------------
// Acoustic model: incoherent sum of directional sources with simple line-source near field
// ---------------------------------------------------------------------------
export function splAt(sources, px, py, pz, absorb = 0.012) {
  let p = 0;
  for (const s of sources) {
    const vx = px - s.x, vy = py - s.y, vz = pz - s.z;
    const d = Math.max(1, Math.hypot(vx, vy, vz));
    const az = Math.atan2(vx, vz);
    const el = Math.atan2(vy, Math.hypot(vx, vz));
    let dh = Math.abs(az - s.yaw);
    if (dh > Math.PI) dh = 2 * Math.PI - dh;
    const dv = Math.abs(el - s.pitch);
    let att = 6 * (dh / (s.hCov * DEG / 2)) ** 2 + 6 * (dv / (s.vCov * DEG / 2)) ** 2;
    att = Math.min(att, 28);
    let loss;
    if (s.line) {
      const dc = (s.len || 4) * 2;
      loss = d < dc ? 10 * Math.log10(d) : 10 * Math.log10(dc) + 20 * Math.log10(d / dc);
    } else loss = 20 * Math.log10(d);
    const L = s.spl1m - 13 - loss - att - absorb * d; // -13: program level vs max SPL
    p += 10 ** (L / 10);
  }
  return p > 0 ? 10 * Math.log10(p) : 0;
}

export const SPL_TARGET = [90, 105];

export function audioMetrics(lay) {
  const out = new Float32Array(lay.seats.length);
  let ok = 0, low = 0, high = 0, min = 999, max = 0;
  lay.seats.forEach((s, i) => {
    const v = splAt(lay.sources, s.x, lay.ear, s.z, lay.V.indoor ? 0.012 : 0.05);
    out[i] = v;
    if (v < SPL_TARGET[0]) low++; else if (v > SPL_TARGET[1]) high++; else ok++;
    min = Math.min(min, v); max = Math.max(max, v);
  });
  const n = Math.max(1, lay.seats.length);
  return { values: out, pctOk: ok / n, pctLow: low / n, pctHigh: high / n, min, max };
}

// Screen legibility: viewing distance / image height (≤4 excellent, ≤6 good, ≤8 acceptable)
export function screenScoreAt(lay, x, z) {
  let best = 99;
  for (const sc of lay.screens) {
    const dx = x - sc.cx, dz = z - sc.cz, dy = lay.ear - sc.cy;
    const d = Math.hypot(dx, dy, dz);
    const nx = Math.sin(sc.yaw), nz = Math.cos(sc.yaw);
    const cos = (dx * nx + dz * nz) / Math.max(0.01, Math.hypot(dx, dz));
    const offAxis = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
    if (offAxis > 65) continue;
    best = Math.min(best, (d / sc.h) * (1 + Math.max(0, offAxis - 35) / 40));
  }
  return best;
}

export function screenMetrics(lay) {
  const out = new Float32Array(lay.seats.length);
  let readable = 0;
  const has = lay.screens.length > 0;
  lay.seats.forEach((s, i) => {
    const best = has ? screenScoreAt(lay, s.x, s.z) : 99;
    out[i] = best;
    if (best <= 8) readable++;
  });
  return { values: out, pctReadable: has ? readable / Math.max(1, lay.seats.length) : 0, has };
}

// ---------------------------------------------------------------------------
// Budget, schedule, constraints
// ---------------------------------------------------------------------------
export function computeEverything(cfg) {
  const lay = computeLayout(cfg);
  const { V, S, SP, A, L } = lay;
  const audio = audioMetrics(lay);
  const screen = screenMetrics(lay);
  const issues = [];
  const add = (level, title, detail, fix) => issues.push({ level, title, detail, fix });

  const rentalMult = 1 + 0.6 * (cfg.days - 1);
  const D = cfg.delays ? DELAYS : { cost: 0, crewHours: 0, flownKg: 0, amps: 0, truck: 0 };

  // ---- rigging / structure ----
  let flown = SP.flownKg + A.flownKg + L.flownKg + D.flownKg;
  let structure = 0, structureHours = 0, structureItems = [];
  if (!V.indoor) {
    if (flown > 0) {
      structure += RATES.stageRoof; structureHours += RATES.stageRoofHours;
      structureItems.push('Stage roof system');
      add('info', 'Stage roof required', `Open-air venue: ${fmtKg(flown)} of flown gear needs a roof structure.`, 'Included automatically.');
    }
    if (SP.screens.some((s) => s.side)) {
      structure += RATES.groundSupport; structureHours += RATES.groundSupportHours; structureItems.push('IMAG ground-support towers');
    }
  } else if (flown > V.rigLimitKg) {
    structure += RATES.groundSupport; structureHours += RATES.groundSupportHours; structureItems.push('Ground-support towers');
    add('warn', 'Rigging load over venue limit', `${fmtKg(flown)} flown vs ${fmtKg(V.rigLimitKg)} allowed. Ground-support towers added (+${money(RATES.groundSupport)}, +${RATES.groundSupportHours} crew-h).`, 'Pick a lighter screen / lighting package to avoid.');
  }

  // ---- ceiling height ----
  if (V.indoor) {
    for (const sc of lay.screens) {
      const top = sc.cy + sc.h / 2;
      if (top > V.ceiling - 0.8) {
        add('error', 'Screen does not fit under ceiling', `${SP.name}: top edge at ${top.toFixed(1)} m, usable trim height ${(V.ceiling - 0.8).toFixed(1)} m.`, 'Choose a smaller screen or a taller venue.');
        break;
      }
    }
    if (L.truss > 1 && V.ceiling < 8) add('warn', 'Low trim height', `Trusses at ${lay.trussY.toFixed(1)} m will be in sightlines of the back rows.`, 'Consider stage-only lighting.');
  }
  if (cfg.screens === 'proj' && L.movers >= 18) add('warn', 'Projection will wash out', 'Stage lighting intensity reduces projected contrast.', 'Use LED wall for high-intensity lighting.');

  // ---- power ----
  const amps = SP.amps + A.amps + L.amps + D.amps + 60; // +60 FOH/backline/misc
  let power = 0;
  if (V.power === 'generator') {
    power = Math.ceil(amps / 100) * RATES.generatorPer100A * (cfg.days + 1);
    add('info', 'Generator power', `${amps} A demand → ${Math.ceil(amps / 100)} × 100 A generator capacity incl. fuel.`, '');
  } else if (amps > V.amps) {
    power = Math.ceil((amps - V.amps) / 100) * RATES.generatorPer100A * (cfg.days + 1);
    add('warn', 'House power insufficient', `${amps} A required vs ${V.amps} A available. Supplemental generator added.`, 'Reduce lighting / LED package.');
  }

  // ---- capacity ----
  if (lay.requested > V.capacity) add('error', 'Over venue capacity', `${lay.requested.toLocaleString()} guests requested; ${V.name} holds ${V.capacity.toLocaleString()}.`, 'Choose a larger venue.');
  if (S.w > V.w * 0.6) add('warn', 'Stage dominates room', `${S.w} m stage in a ${V.w} m room reduces seating.`, 'Smaller stage.');

  // ---- audio ----
  if (audio.pctLow > 0.08) add(audio.pctLow > 0.25 ? 'error' : 'warn', 'Audio coverage gaps', `${pct(audio.pctLow)} of guests below ${SPL_TARGET[0]} dB.`, lay.audDepth > 30 && !cfg.delays ? 'Add delay towers.' : 'Upgrade to a larger PA.');
  if (audio.pctHigh > 0.08) add('warn', 'Too loud near stage', `${pct(audio.pctHigh)} of guests above ${SPL_TARGET[1]} dB.`, 'Add front-fills / re-aim mains.');
  if (cfg.delays && lay.audDepth < 22) add('info', 'Delays may be unnecessary', `Audience only ${lay.audDepth.toFixed(0)} m deep.`, 'Remove delay towers to save ' + money(DELAYS.cost));

  // ---- screens ----
  if (screen.has && screen.pctReadable < 0.85) add(screen.pctReadable < 0.6 ? 'error' : 'warn', 'Screen too small for the room', `Only ${pct(screen.pctReadable)} of guests can comfortably read content (≤ 8× image height).`, 'Larger LED wall or IMAG side screens.');
  if (!screen.has && lay.audDepth > 18) add('warn', 'No screens for a deep room', `Back rows are ${lay.audDepth.toFixed(0)} m from stage – presenters will be tiny.`, 'Add IMAG screens.');

  // ---- schedule ----
  const C = cfg.crew;
  const trucks = Math.max(1, Math.ceil(S.truck + SP.truck + A.truck + L.truck + D.truck + (structure ? 1 : 0) + 0.3));
  const phases = [];
  const unload = trucks * 0.6 / Math.min(1, C / 10) ;
  phases.push({ name: 'Unload & rigging', dept: 'rig', hours: unload + (flown / 400 + structureHours) / Math.min(C, 14) + 1 });
  phases.push({ name: 'Stage build', dept: 'stage', hours: S.crewHours / Math.min(C, 14) });
  const sys = [
    { name: 'Video install', dept: 'video', ch: SP.crewHours },
    { name: 'Audio install', dept: 'audio', ch: A.crewHours + D.crewHours },
    { name: 'Lighting install', dept: 'light', ch: L.crewHours },
  ].filter((s) => s.ch > 0);
  const totalSys = sys.reduce((a, s) => a + s.ch, 0);
  for (const s of sys) s.hours = Math.max(s.ch / Math.max(2, C * s.ch / totalSys), s.ch / 12);
  const sysDur = Math.max(...sys.map((s) => s.hours));
  phases.push({ name: 'Systems install', dept: 'sys', hours: sysDur, parallel: sys });
  const focus = Math.max(L.programHours, SP.crewHours ? 3 : 0, 2 + (cfg.delays ? 1 : 0));
  phases.push({ name: 'Focus, program & tune', dept: 'prog', hours: focus });
  phases.push({ name: 'Tech rehearsal', dept: 'reh', hours: 3 });
  let t = 0;
  for (const p of phases) { p.start = t; t += p.hours; }
  const loadIn = t;
  if (loadIn > V.accessHours) add('error', 'Load-in exceeds venue access', `${loadIn.toFixed(1)} h needed, venue grants ${V.accessHours} h.`, 'Increase crew size or book a pre-rig day.');
  else if (loadIn > V.accessHours * 0.85) add('warn', 'Tight load-in', `${loadIn.toFixed(1)} h of ${V.accessHours} h access window used.`, 'Add crew buffer.');

  // labour: load-in + load-out (45%), overtime past 10h per 12h call
  const crewH = loadIn + loadIn * 0.45 + cfg.days * 4; // show-call technicians
  const callDays = Math.ceil(crewH / 12);
  const ot = Math.max(0, crewH - callDays * 10);
  const labor = C * ((crewH - ot) * RATES.crewHour + ot * RATES.crewHour * RATES.overtimeMult);
  const idle = phases.reduce((a, p) => a + p.hours, 0) * C - (S.crewHours + totalSys);
  if (C > 40 && loadIn < V.accessHours * 0.5) add('info', 'Crew may be oversized', `Load-in finishes in ${loadIn.toFixed(1)} h — well within the window.`, 'Reduce crew to save labour.');

  const venueDays = cfg.days + Math.ceil(loadIn / 16);
  const budget = [
    { key: 'stage', label: 'Staging', amount: S.cost * rentalMult, color: '#8b93a7' },
    { key: 'video', label: 'Video / LED', amount: SP.cost * rentalMult, color: '#4cc9f0' },
    { key: 'audio', label: 'Audio', amount: (A.cost + D.cost) * rentalMult, color: '#f72585' },
    { key: 'light', label: 'Lighting', amount: L.cost * rentalMult, color: '#ffd166' },
    { key: 'struct', label: 'Rigging & structure', amount: structure + flown * 1.2, color: '#a78bfa' },
    { key: 'power', label: 'Power', amount: power, color: '#fb8500' },
    { key: 'labor', label: 'Labour', amount: labor, color: '#06d6a0' },
    { key: 'truck', label: 'Trucking', amount: trucks * RATES.truck, color: '#94a3b8' },
    { key: 'venue', label: 'Venue days', amount: venueDays * V.venueDayRate, color: '#64748b' },
  ];
  const sub = budget.reduce((a, b) => a + b.amount, 0);
  budget.push({ key: 'pm', label: 'Prod. mgmt & contingency', amount: sub * (RATES.productionMgmt + RATES.contingency), color: '#475569' });
  const total = budget.reduce((a, b) => a + b.amount, 0);

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return {
    cfg, lay, audio, screen, issues, budget, total, perGuest: total / Math.max(1, lay.seats.length),
    phases, loadIn, trucks, amps, flown, crew: C, venueDays, structureItems, idle,
  };
}

export const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
export const moneyK = (v) => (Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : '$' + Math.round(v / 1000) + 'k');
export const pct = (v) => Math.round(v * 100) + '%';
export const fmtKg = (v) => Math.round(v).toLocaleString('en-US') + ' kg';
