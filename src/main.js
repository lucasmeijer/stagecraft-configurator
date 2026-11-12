import { VENUES, STAGES, SCREENS, AUDIO, DELAYS, LIGHTING } from './catalog.js';
import { computeEverything, money, moneyK, pct, fmtKg, SPL_TARGET } from './calc.js';
import { StageScene, legendGradient } from './scene.js';

const cfg = { venue: 'convention', stage: 'm', screens: 'ledC', audio: 'line', lighting: 'rig', delays: false, audience: 2800, days: 2, crew: 28 };
let result = null;
let overlay = 'none';
const scenarios = [];
let activeScenario = null;

const $ = (s, el = document) => el.querySelector(s);
const left = $('#left'), right = $('#right');

const scene = new StageScene($('#viewport'), { onHover: showTooltip });

// ---------------------------------------------------------------------------
// Left panel
// ---------------------------------------------------------------------------
const SECTIONS = [
  { key: 'venue', title: 'Venue', cat: VENUES },
  { key: 'audienceBlock' },
  { key: 'stage', title: 'Stage', cat: STAGES },
  { key: 'screens', title: 'Screens & video', cat: SCREENS },
  { key: 'audio', title: 'Audio system', cat: AUDIO, extra: 'delays' },
  { key: 'lighting', title: 'Lighting', cat: LIGHTING },
];

function renderLeft() {
  let step = 0;
  left.innerHTML = SECTIONS.map((s) => {
    step++;
    if (s.key === 'audienceBlock') {
      const cap = VENUES[cfg.venue].capacity;
      return `<div class="sec"><h3><span><span class="step">${step}</span>Audience &amp; schedule</span></h3>
        <div class="slider"><div class="row"><span>Guests</span><span class="v" id="v-aud">${cfg.audience.toLocaleString()}</span></div>
          <input type="range" id="aud" min="100" max="${Math.round(cap * 1.2 / 50) * 50}" step="50" value="${cfg.audience}"><small>Venue capacity ${cap.toLocaleString()}</small></div>
        <div class="slider"><div class="row"><span>Show days</span><span class="v" id="v-days">${cfg.days}</span></div>
          <input type="range" id="days" min="1" max="4" step="1" value="${cfg.days}"><small>Equipment rental scales ~60% per extra day</small></div>
        <div class="slider tech"><div class="row"><span>Crew size</span><span class="v" id="v-crew">${cfg.crew}</span></div>
          <input type="range" id="crew" min="8" max="80" step="2" value="${cfg.crew}"><small>More crew = faster load-in, but higher labour cost</small></div>
      </div>`;
    }
    const opts = Object.entries(s.cat).map(([k, o]) => `
      <button class="opt ${cfg[s.key] === k ? 'on' : ''}" data-key="${s.key}" data-val="${k}">
        <span class="n">${o.name}</span><span class="delta" id="d-${s.key}-${k}"></span>
        <span class="d">${o.desc}</span>
        <span class="flag" id="f-${s.key}-${k}"></span>
      </button>`).join('');
    const extra = s.extra === 'delays' ? `
      <button class="opt ${cfg.delays ? 'on' : ''}" data-toggle="delays" style="margin-top:6px">
        <span class="n check"><input type="checkbox" ${cfg.delays ? 'checked' : ''} tabindex="-1"> ${DELAYS.name}</span><span class="delta" id="d-delays"></span>
        <span class="d">${DELAYS.desc}</span><span class="flag" id="f-delays"></span>
      </button>` : '';
    return `<div class="sec"><h3><span><span class="step">${step}</span>${s.title}</span></h3><div class="opts">${opts}</div>${extra}</div>`;
  }).join('');

  left.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.key;
    cfg[k] = b.dataset.val;
    if (k === 'venue') cfg.audience = Math.min(cfg.audience, VENUES[cfg.venue].capacity);
    activeScenario = null;
    renderLeft();
    update(true);
    if (k === 'venue') setTimeout(() => scene.setView(currentView), 30);
  }));
  left.querySelector('[data-toggle=delays]').addEventListener('click', () => { cfg.delays = !cfg.delays; activeScenario = null; renderLeft(); update(true); });
  for (const id of ['aud', 'days', 'crew']) {
    $('#' + id).addEventListener('input', (e) => {
      const v = +e.target.value;
      if (id === 'aud') cfg.audience = v; else cfg[id] = v;
      $('#v-' + id).textContent = v.toLocaleString();
      activeScenario = null;
      update(id === 'aud' ? 'debounce' : 'none');
    });
  }
}

// option deltas: what happens to total and load-in time if I pick this instead?
let deltaTimer;
function scheduleDeltas() {
  clearTimeout(deltaTimer);
  deltaTimer = setTimeout(renderDeltas, 120);
}
function renderDeltas() {
  const cur = result;
  const curErr = new Set(cur.issues.filter((i) => i.level === 'error').map((i) => i.title));
  const fill = (id, fid, alt, selected) => {
    const el = $('#' + id); if (!el) return;
    if (selected) { el.innerHTML = `<span class="z">included</span><span class="t">${cur.loadIn.toFixed(0)} h load-in</span>`; $('#' + fid).textContent = ''; return; }
    const r = computeEverything(alt);
    const d = r.total - cur.total, dh = r.loadIn - cur.loadIn;
    el.innerHTML = `<span class="${d > 0 ? 'p' : d < 0 ? 'm' : 'z'}">${d >= 0 ? '+' : '−'}${moneyK(Math.abs(d))}</span><span class="t">${dh >= 0 ? '+' : '−'}${Math.abs(dh).toFixed(1)} h</span>`;
    const newErr = r.issues.find((i) => i.level === 'error' && !curErr.has(i.title));
    const f = $('#' + fid);
    if (newErr) { f.textContent = '⚠ ' + newErr.title; f.className = 'flag err'; }
    else {
      const gain = altGain(cur, r);
      f.textContent = gain; f.className = 'flag';
      f.style.color = gain.startsWith('✓') ? '#86efac' : '';
    }
  };
  for (const s of SECTIONS) {
    if (!s.cat) continue;
    for (const k of Object.keys(s.cat)) fill(`d-${s.key}-${k}`, `f-${s.key}-${k}`, { ...cfg, [s.key]: k }, cfg[s.key] === k);
  }
  fill('d-delays', 'f-delays', { ...cfg, delays: !cfg.delays }, false);
  if (cfg.delays) { const el = $('#d-delays'); el.innerHTML = `<span class="z">included</span>` + el.innerHTML.replace(/<span class="[pmz]">.*?<\/span>/, '').replace('class="t">', 'class="t">remove: '); }
}
function altGain(cur, r) {
  const da = r.audio.pctOk - cur.audio.pctOk, ds = r.screen.pctReadable - cur.screen.pctReadable;
  if (da > 0.04) return `✓ audio coverage ${pct(cur.audio.pctOk)} → ${pct(r.audio.pctOk)}`;
  if (ds > 0.04) return `✓ screen readability ${pct(cur.screen.pctReadable)} → ${pct(r.screen.pctReadable)}`;
  if (da < -0.04) return `audio coverage drops to ${pct(r.audio.pctOk)}`;
  if (ds < -0.04) return `screen readability drops to ${pct(r.screen.pctReadable)}`;
  return '';
}

// ---------------------------------------------------------------------------
// Right panel
// ---------------------------------------------------------------------------
let shownTotal = 0;
function renderRight() {
  const r = result;
  const V = r.lay.V;
  const base = scenarios[0];
  const vs = base && activeScenario !== base ? r.total - base.res.total : null;
  const cats = r.budget.filter((b) => b.amount > 0);
  const loadPct = r.loadIn / V.accessHours;
  const sev = (x, w, e) => (x >= e ? 'bad' : x >= w ? 'warn' : '');
  const meter = (v, col) => `<div class="meter"><i style="width:${Math.min(100, v * 100)}%;background:${col}"></i></div>`;
  const col = (good) => (good ? 'var(--ok)' : 'var(--warn)');

  const maxH = Math.max(r.loadIn, V.accessHours) * 1.05;
  const deptCol = { rig: '#a78bfa', stage: '#8b93a7', video: '#4cc9f0', audio: '#f72585', light: '#ffd166', prog: '#06d6a0', reh: '#64748b' };
  const ganttRows = [];
  for (const p of r.phases) {
    if (p.parallel) for (const s of p.parallel) ganttRows.push({ name: s.name, start: p.start, hours: s.hours, color: deptCol[s.dept] });
    else ganttRows.push({ name: p.name, start: p.start, hours: p.hours, color: deptCol[p.dept] });
  }
  const ticks = [];
  const tstep = maxH > 50 ? 12 : maxH > 24 ? 6 : 4;
  for (let h = 0; h <= maxH; h += tstep) ticks.push(h);
  const errors = r.issues.filter((i) => i.level !== 'info');

  right.innerHTML = `
    <div class="total-card">
      <div class="lbl">Estimated production budget</div>
      <div class="big" id="bigTotal">${money(shownTotal || r.total)}</div>
      <div class="sub"><span>${money(r.perGuest)} / guest</span><span>${r.lay.seats.length.toLocaleString()} guests</span><span>${cfg.days} show day${cfg.days > 1 ? 's' : ''}</span></div>
      ${vs !== null ? `<div class="vs">vs Option A: <b style="color:${vs > 0 ? '#fca5a5' : '#86efac'}">${vs >= 0 ? '+' : '−'}${money(Math.abs(vs))}</b></div>` : ''}
      <div class="bar">${cats.map((b) => `<div title="${b.label}" style="flex-grow:${b.amount};background:${b.color}"></div>`).join('')}</div>
      <div class="blist">${cats.map((b) => `<span class="sw2" style="background:${b.color}"></span><span>${b.label}</span><span class="amt">${moneyK(b.amount)}</span>`).join('')}</div>
    </div>

    <div class="client-only">
      <h4>What this means for your guests</h4>
      <div class="guest-points">
        <div class="gp"><span class="ic">🔊</span><div><b>${pct(r.audio.pctOk)} hear it just right</b><span>${r.audio.pctLow > 0.05 ? `${pct(r.audio.pctLow)} in the back would struggle to hear clearly.` : r.audio.pctHigh > 0.05 ? `${pct(r.audio.pctHigh)} near the stage will find it loud.` : 'Even, comfortable sound in every seat.'}</span></div></div>
        <div class="gp"><span class="ic">👁</span><div><b>${r.screen.has ? pct(r.screen.pctReadable) + ' can read the screens' : 'No screens'}</b><span>${r.screen.has ? (r.screen.pctReadable > 0.9 ? 'Slides and close-ups readable from every seat.' : 'Rear guests will struggle to read slides.') : 'Guests rely on seeing the stage directly.'}</span></div></div>
        <div class="gp"><span class="ic">⏱</span><div><b>${r.loadIn.toFixed(0)} hours to build</b><span>${r.loadIn <= V.accessHours ? `Fits the venue's ${V.accessHours} h access window.` : `Needs ${(r.loadIn - V.accessHours).toFixed(0)} h more than the venue allows – extra venue day required.`}</span></div></div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi ${sev(loadPct, 0.85, 1)}"><div class="k">Load-in</div><div class="v">${r.loadIn.toFixed(1)} h</div><div class="s">window ${V.accessHours} h</div>${meter(loadPct, loadPct > 1 ? 'var(--err)' : col(loadPct < 0.85))}</div>
      <div class="kpi ${sev(1 - r.audio.pctOk, 0.1, 0.25)}"><div class="k">Audio coverage</div><div class="v">${pct(r.audio.pctOk)}</div><div class="s">guests ${SPL_TARGET[0]}–${SPL_TARGET[1]} dB</div>${meter(r.audio.pctOk, col(r.audio.pctOk > 0.9))}</div>
      <div class="kpi ${r.screen.has ? sev(1 - r.screen.pctReadable, 0.15, 0.4) : ''}"><div class="k">Screen readability</div><div class="v">${r.screen.has ? pct(r.screen.pctReadable) : '—'}</div><div class="s">≤ 8× image height</div>${meter(r.screen.pctReadable, col(r.screen.pctReadable > 0.85))}</div>
      <div class="kpi tech ${V.indoor ? sev(r.flown / V.rigLimitKg, 0.85, 1) : ''}"><div class="k">Rigging load</div><div class="v">${fmtKg(r.flown)}</div><div class="s">${V.indoor ? 'limit ' + fmtKg(V.rigLimitKg) : 'roof / ground support'}</div>${V.indoor ? meter(r.flown / V.rigLimitKg, r.flown > V.rigLimitKg ? 'var(--err)' : col(r.flown < V.rigLimitKg * 0.85)) : ''}</div>
      <div class="kpi tech ${V.power === 'house' ? sev(r.amps / V.amps, 0.85, 1) : ''}"><div class="k">Power draw</div><div class="v">${r.amps} A</div><div class="s">${V.power === 'house' ? 'house ' + V.amps + ' A' : 'generators'}</div>${V.power === 'house' ? meter(r.amps / V.amps, r.amps > V.amps ? 'var(--err)' : col(r.amps < V.amps * 0.85)) : ''}</div>
      <div class="kpi tech"><div class="k">Logistics</div><div class="v">${r.trucks} trucks</div><div class="s">${r.crew} crew · ${r.venueDays} venue days</div></div>
    </div>

    <h4><span>Build schedule</span><span>${r.loadIn.toFixed(1)} h</span></h4>
    <div class="gantt"><div class="g-wrap">
      ${ganttRows.map((g) => `<div class="g-row"><span class="nm">${g.name}</span><div class="g-track"><div class="g-bar" style="left:${(g.start / maxH) * 100}%;width:${Math.max(0.8, (g.hours / maxH) * 100)}%;background:${g.color}" title="${g.hours.toFixed(1)} h"></div></div></div>`).join('')}
      <div style="position:absolute;left:118px;right:0;top:0;bottom:0;pointer-events:none"><div class="g-limit" style="left:${(V.accessHours / maxH) * 100}%" title="Venue access window"></div></div>
      </div>
      <div class="g-axis">${ticks.map((h) => `<span style="left:${(h / maxH) * 100}%">${h}h</span>`).join('')}</div>
      <div class="g-note">Red dashed line = venue access window (${V.accessHours} h)</div>
    </div>

    <h4><span>Constraints &amp; trade-offs</span><span>${errors.length ? errors.length + ' to resolve' : ''}</span></h4>
    <div class="issues">
      ${r.issues.length ? r.issues.map((i) => `<div class="issue ${i.level} ${i.level === 'info' ? 'tech' : ''}"><div class="t">${i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠️' : 'ℹ️'} ${i.title}</div><div class="d">${i.detail}</div>${i.fix ? `<div class="f">→ ${i.fix}</div>` : ''}</div>`).join('') : ''}
      ${!errors.length ? '<div class="ok-msg">✓ This build is feasible within all venue constraints.</div>' : ''}
    </div>
  `;
  animateTotal(r.total);
}

let totalAnim;
function animateTotal(target) {
  cancelAnimationFrame(totalAnim);
  const from = shownTotal || target;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 450);
    shownTotal = from + (target - from) * (1 - (1 - k) ** 3);
    const el = $('#bigTotal');
    if (el) el.textContent = money(shownTotal);
    if (k < 1) totalAnim = requestAnimationFrame(step);
  };
  totalAnim = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// Legend & tooltip
// ---------------------------------------------------------------------------
function renderLegend() {
  const el = $('#legend');
  if (overlay === 'none') return el.classList.add('hidden');
  el.classList.remove('hidden');
  const r = result;
  if (overlay === 'audio') {
    el.innerHTML = `<div class="t">🔊 Predicted sound level</div>
      <div class="grad" style="background:${legendGradient('audio')}"></div>
      <div class="scale"><span>78 dB</span><span>90</span><span>103</span><span>111+</span></div>
      <div class="stat">Target ${SPL_TARGET[0]}–${SPL_TARGET[1]} dB(A): <b>${pct(r.audio.pctOk)}</b> of guests<br>
      <span style="color:var(--muted)">Range ${r.audio.min.toFixed(0)}–${r.audio.max.toFixed(0)} dB · cones = speaker throw to ${SPL_TARGET[0]} dB</span></div>`;
  } else {
    el.innerHTML = `<div class="t">👁 Screen sightlines</div>
      <div class="grad" style="background:${legendGradient('screen')}"></div>
      <div class="scale"><span>2×</span><span>4×</span><span>8×</span><span>13× H</span></div>
      <div class="stat">Viewing distance ÷ image height. ≤ 8× is comfortable.<br><b>${r.screen.has ? pct(r.screen.pctReadable) : '0%'}</b> of guests read comfortably<br>
      <span style="color:var(--muted)">Arcs = comfortable viewing zone per screen (±65°)</span></div>`;
  }
}

function showTooltip(info, px) {
  const el = $('#tooltip');
  if (!info) return el.classList.add('hidden');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="t">${info.title}</div>` + info.rows.map(([k, v]) => `<div class="r"><span>${k}</span><b>${v}</b></div>`).join('');
  const vp = $('#viewport').getBoundingClientRect();
  el.style.left = Math.min(px.x + 14, vp.width - el.offsetWidth - 8) + 'px';
  el.style.top = Math.min(px.y + 14, vp.height - el.offsetHeight - 8) + 'px';
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
function renderScenarios() {
  $('#scenarioChips').innerHTML = scenarios.map((s, i) => `<div class="chip ${activeScenario === s ? 'active' : ''}" data-i="${i}"><b>${s.name}</b>${moneyK(s.res.total)}<span class="x" data-del="${i}">✕</span></div>`).join('');
  $('#scenarioChips').querySelectorAll('.chip').forEach((c) => c.addEventListener('click', (e) => {
    const i = +c.dataset.i;
    if (e.target.dataset.del) { scenarios.splice(i, 1); scenarios.forEach((s, j) => (s.name = 'ABCDE'[j])); renderScenarios(); renderCompare(); renderRight(); return; }
    Object.assign(cfg, scenarios[i].cfg);
    activeScenario = scenarios[i];
    renderLeft(); update(true);
  }));
  $('#compareBtn').disabled = scenarios.length < 1;
  $('#saveScenario').disabled = scenarios.length >= 5;
}
$('#saveScenario').addEventListener('click', () => {
  const s = { name: 'ABCDE'[scenarios.length], cfg: { ...cfg }, res: result };
  scenarios.push(s);
  activeScenario = s;
  renderScenarios();
  renderRight();
  if (!$('#compare').classList.contains('hidden')) renderCompare();
});
$('#compareBtn').addEventListener('click', () => { $('#compare').classList.toggle('hidden'); renderCompare(); });

function renderCompare() {
  const el = $('#compare');
  if (el.classList.contains('hidden')) return;
  const cols = [...scenarios.map((s) => ({ name: 'Option ' + s.name, r: s.res })), ...(activeScenario ? [] : [{ name: 'Current', r: result }])];
  const rows = [
    ['Venue', (r) => r.lay.V.name], ['Screens', (r) => r.lay.SP.name], ['Audio', (r) => r.lay.A.name + (r.cfg.delays ? ' + delays' : '')], ['Lighting', (r) => r.lay.L.name],
    ['Total budget', (r) => r.total, money, 'min'], ['Per guest', (r) => r.perGuest, money, 'min'], ['Load-in', (r) => r.loadIn, (v) => v.toFixed(1) + ' h', 'min'],
    ['Audio coverage', (r) => r.audio.pctOk, pct, 'max'], ['Screen readability', (r) => r.screen.pctReadable, pct, 'max'], ['Blocking issues', (r) => r.issues.filter((i) => i.level === 'error').length, (v) => (v ? '⛔ ' + v : '✓ none'), 'min'],
  ];
  el.innerHTML = `<div class="head"><span>Compare options</span><button class="btn ghost" id="closeCmp">Close</button></div><table>
    <tr><th></th>${cols.map((c) => `<th>${c.name}</th>`).join('')}</tr>
    ${rows.map(([label, get, fmt, best]) => {
      const vals = cols.map((c) => get(c.r));
      const b = best ? (best === 'min' ? Math.min(...vals) : Math.max(...vals)) : null;
      return `<tr><td>${label}</td>${vals.map((v) => `<td class="${best && v === b && cols.length > 1 ? 'best' : ''}">${fmt ? fmt(v) : v}</td>`).join('')}</tr>`;
    }).join('')}
  </table>`;
  $('#closeCmp').onclick = () => el.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
let currentView = 'overview';
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x === b));
  currentView = b.dataset.view;
  scene.setView(currentView);
}));
document.querySelectorAll('#overlays button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#overlays button').forEach((x) => x.classList.toggle('on', x === b));
  overlay = b.dataset.overlay;
  scene.setOverlay(overlay);
  renderLegend();
}));
$('#clientMode').addEventListener('change', (e) => document.body.classList.toggle('client', e.target.checked));

// ---------------------------------------------------------------------------
let sceneTimer;
function update(mode = 'now') {
  if (mode === true) mode = 'now';
  result = computeEverything(cfg);
  renderRight();
  renderLegend();
  scheduleDeltas();
  renderScenarios();
  renderCompare();
  clearTimeout(sceneTimer);
  if (mode === 'now') scene.build(result);
  else if (mode === 'debounce') sceneTimer = setTimeout(() => scene.build(result), 80);
  else scene.res = result;
}

renderLeft();
update(true);
window.__app = { cfg, scene, update, renderLeft };
