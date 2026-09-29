/* Everything that is DOM: one sheet, four destinations, and the modals.
 *
 * The structure follows two axes over the same records. A task, a note and a
 * photo each belong to a plant AND to a date, so each appears in exactly two
 * places, once per axis, and the views cross-link rather than repeat:
 *
 *   Plants   the plant axis  — how each plant is doing, across time
 *   Calendar the date axis   — what a given day holds, across plants
 *   Photos   the image index — the same photos, browsed by eye
 *   Update   the one composer, pre-filled by whatever context opened it
 *
 * A photo is always shown attached to the entry it was posted with; it is never
 * a loose grid inside a plant or a day.
 *
 * Renders HTML and calls into data.js. Never touches Three.js directly; it talks
 * to the scene through the small `scene` object handed to mount().
 */

import * as D from './data.js';
import { billboardFor } from './art.js';
import { TONE_RING } from './layout.js';

const $ = (s) => document.querySelector(s);
const esc = D.esc;

/* ---------- view state ---------- */
let tab = null;                 // 'plants' | 'cal' | 'photos' | 'note'
let plantId = null;             // set when drilled into a plant
let cursor = D.todayISO();
let calView = D.store.get('calView3d') || 'day';
const view = { y: new Date().getFullYear(), m: new Date().getMonth() };
const syncViewFromCursor = () => { const d = new Date(cursor); view.y = d.getFullYear(); view.m = d.getMonth(); };
const DAYS_SPAN = 5;
let feedFilter = '';
let editing = null;
let busy = '';
let scene = null;
let lastFocus = null;

const TONE_NOTE = {
  good: "AI's read — nothing needs doing.",
  watch: "AI's read — fine, worth an eye on it.",
  bad: "AI's read — something needs attention.",
};
const TITLES = { plants: 'Plants', cal: 'Calendar', photos: 'Photos', note: 'New update' };

/* The same drawing that stands in the pot, so a plant looks the same everywhere. */
const artFor = (p) => billboardFor(p.species, p.stage).svg;

/* ---------- the season axis ---------- */
const spos = D.spos;
const TICKS = [['Jul', '2026-07-01'], ['Aug', '2026-08-01'], ['Sep', '2026-09-01'], ['Oct', '2026-10-01']];
const ticksHTML = () => `<div class="ticks flush">${TICKS.map(([l, d]) => `<b style="left:${spos(d)}%">${l}</b>`).join('')}</div>`;
const legendHTML = (withToday) => `<div class="legend">
  <span><i class="sw grow"></i> growing</span><span><i class="sw flower"></i> flowering</span>
  <span><i class="sw fruit"></i> fruiting</span><span><i class="sw harvest"></i> harvest</span>
  ${withToday ? '<span><i class="sw now"></i> today</span>' : ''}</div>`;
function trackHTML(key) {
  const r = D.SEASON.find((x) => x.key === key);
  const t = spos(D.todayISO());
  const bars = r ? r.ph.map(([c, f, to]) =>
    `<i class="bar ${c}" style="left:${spos(f)}%;width:${Math.max(spos(to) - spos(f), 1.5)}%"></i>`).join('') : '';
  return `<span class="track">${bars}${t >= 0 && t <= 100 ? `<i class="tline" style="left:${t}%"></i>` : ''}</span>`;
}

/* ---------- the one composer ----------
   Same component wherever you write; context only pre-fills it. Plant and date
   stay editable, so "note about this plant", "note for the 8th" and "just tell
   the AI" are one flow rather than three. */
const comp = { ctx: '', text: '', staged: [], plant: null, date: D.todayISO(), picking: false, fromPhoto: null };
function useComposer(ctx, { plant = null, date = null } = {}) {
  if (comp.ctx === ctx) return;
  clearComposer();
  comp.ctx = ctx;
  comp.plant = plant;
  comp.date = date || D.todayISO();
}
function clearComposer() {
  comp.staged.forEach((s) => URL.revokeObjectURL(s.url));
  comp.staged = []; comp.text = ''; comp.picking = false; comp.fromPhoto = null;
}

function composerHTML({ lockPlant = null, bare = false } = {}) {
  const pid = lockPlant || comp.plant;
  const p = pid === '__all' ? { name: 'Whole balcony' } : (pid ? D.plantById(pid) : null);
  const canSave = comp.staged.length > 0 || !!comp.text.trim();
  const open = bare ? '<div class="composer bare">' : '<section class="composer">';
  return `${open}
    <label class="vhid" for="ctext">New update</label>
    <textarea id="ctext" placeholder="What's happening?">${esc(comp.text)}</textarea>
    ${comp.staged.length ? `<div class="cshots">${comp.staged.map((s, i) => `
      <div class="cshot"><img src="${s.url}" alt="">
        <button class="rm" data-act="unstage" data-val="${i}" aria-label="Remove photo">×</button></div>`).join('')}</div>` : ''}
    <div class="cbar">
      <button data-act="attach" aria-label="Add photo">📷</button>
      ${lockPlant
        ? `<span class="chipbtn set">${esc(p ? p.name : '')}</span>`
        : `<button class="chipbtn${p ? ' set' : ''}" data-act="pickplant">${p ? esc(p.name) : 'Which plant?'}</button>`}
      <input type="date" id="cdate" value="${comp.date}" max="${D.todayISO()}" aria-label="Date">
      <span class="grow"></span>
      <button class="save" data-act="save" data-val="${esc(lockPlant || '')}" ${canSave ? '' : 'disabled'}>Save</button>
    </div>
    ${comp.picking && !lockPlant ? `<div class="picker-inline">
      <button data-act="setplant" data-val="">✨ Let the AI decide</button>
      <button data-act="setplant" data-val="__all">🪴 Whole balcony</button>
      ${D.plants().map((x) => `<button data-act="setplant" data-val="${esc(x.id)}">${esc(x.name)}</button>`).join('')}
    </div>` : ''}
    ${comp.fromPhoto ? `<p class="hintline">Date taken from the photo (${esc(comp.fromPhoto)}).</p>` : ''}
    ${!lockPlant && !p ? '<p class="hintline">Leave the plant unset and the AI files it for you.</p>' : ''}
  ${bare ? '</div>' : '</section>'}`;
}

/* A photo carries the day it was taken, so it dates the entry rather than the
   day you happen to be looking at. EXIF must be read from the original file:
   the canvas resize below re-encodes and drops every tag. */
async function exifDate(file) {
  try {
    if (!/jpe?g/i.test(file.type)) return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      if (v.getUint8(off) !== 0xFF) return null;
      const marker = v.getUint8(off + 1), size = v.getUint16(off + 2);
      if (marker === 0xE1 && v.getUint32(off + 4) === 0x45786966) return readTiff(v, off + 10);
      if (marker === 0xDA) return null;                       // start of scan: no EXIF here
      off += 2 + size;
    }
  } catch (e) {}
  return null;
}
function readTiff(v, base) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  if (u16(base + 2) !== 42) return null;
  let ifd = base + u32(base + 4);
  const WANT = [0x9003, 0x9004, 0x0132];                      // original, digitised, modified
  for (let pass = 0; pass < 2 && ifd > base; pass++) {
    const n = u16(ifd);
    let exifIFD = 0;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12, tag = u16(e);
      if (tag === 0x8769) exifIFD = base + u32(e + 8);
      if (WANT.includes(tag)) {
        const cnt = u32(e + 4), at = base + u32(e + 8);
        let s = '';
        for (let k = 0; k < cnt - 1 && at + k < v.byteLength; k++) s += String.fromCharCode(v.getUint8(at + k));
        const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      }
    }
    ifd = exifIFD;
  }
  return null;
}

function shrink(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1000 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = img.width * s; cv.height = img.height * s;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => res(b || file), 'image/jpeg', 0.82);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

async function saveComposer(lockPlant) {
  const text = comp.text.trim();
  const date = $('#cdate')?.value || D.todayISO();
  if (!text && !comp.staged.length) return;
  const btn = $('[data-act="save"]');
  if (btn) btn.disabled = true;

  const subject = lockPlant || comp.plant;
  const plantFor = subject && subject !== '__all' ? subject : null;
  const photoTag = subject === '__all' ? '' : (plantFor || '');

  const photoIds = [];
  for (const s of comp.staged) {
    const rec = await D.uploadOne(s.blob, date, photoTag);
    if (!rec) { if (btn) btn.disabled = false; return; }
    photoIds.push(rec.id);
  }
  const entry = await D.saveEntry({ date, text, photoIds, plantId: plantFor });
  if (!entry) { if (btn) btn.disabled = false; return; }
  clearComposer();
  if (tab === 'note') closeSheet();
  renderAll();
  D.refreshSoon();
}

/* ---------- small pieces ---------- */
function taskRowHTML(date, t, canDo, terse) {
  const done = D.isDone(date, t.key);
  const over = /overdue/i.test(t.what || '');
  return `<div class="trow ${done ? 'checked' : ''}">
    <span class="ico" aria-hidden="true">${esc(t.ico)}</span>
    <span class="tb"><span class="what">${esc(t.what.replace(/\s*\(overdue\)/i, ''))}${over ? ' <b class="over">· overdue</b>' : ''}</span>
      ${t.why && !terse ? `<span class="why">${esc(t.why)}</span>` : ''}</span>
    ${canDo ? `<button class="done-btn" data-act="done" data-date="${date}" data-key="${esc(t.key)}"
       aria-pressed="${done}">Done${done ? ' ✓' : ''}</button>` : ''}
  </div>`;
}
const alertHTML = (a, terse) => `<div class="alert-row"><span class="ico" aria-hidden="true">${esc(a.ico)}</span>
  <div><div class="what">${esc(a.what)}</div>
  ${terse ? '' : `<div class="who">${esc(a.why)}</div>`}</div></div>`;

/* ---------- top bar ---------- */
function renderTop() {
  const tw = D.wxOf(D.todayISO());
  $('#now-wx').innerHTML = D.forecast
    ? `<span aria-hidden="true">${D.wxIcon(tw) || '🌡️'}</span> ${Math.round(D.forecast.nowT)}°`
      + `<span class="rh"> · ${D.forecast.rh}% RH</span>`
    : '…';
  const pu = $('#plan-upd');
  if (D.planDoc && D.planDoc.generatedAt) { pu.hidden = false; pu.textContent = ` · plan ${D.relTime(D.planDoc.generatedAt)}`; }
  else pu.hidden = true;
  $('#busy').hidden = !busy;
  $('#busy span').textContent = busy;
  $('#lockbtn').hidden = !D.isUnlocked();

  const T = D.todayISO();
  const due = D.flatTasks(T).filter((t) => !D.isDone(T, t.key)).length;
  const chip = $('#today-chip');
  chip.textContent = due ? `${due} task${due > 1 ? 's' : ''} today` : 'Nothing due today';
  chip.classList.toggle('warn', due > 0);
}

/* ---------- the sheet ---------- */
export function openTab(which) {
  if (tab === which && !(which === 'plants' && plantId)) return closeSheet();
  if (!tab) lastFocus = document.activeElement;
  tab = which;
  if (which !== 'plants') plantId = null;
  if (which === 'note') useComposer('note');
  render();
  $('#sheet').hidden = false;
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
}
export function openPlant(pid) {
  if (!D.plantById(pid)) return;
  if (!tab) lastFocus = document.activeElement;
  tab = 'plants'; plantId = pid; editing = null;
  useComposer('plant:' + pid, { plant: pid });
  render();
  $('#sheet').hidden = false;
  requestAnimationFrame(() => $('#sheet').classList.add('open'));
  scene.select(pid);
  scene.focus(pid);
}
export function closeSheet() {
  $('#sheet').classList.remove('open');
  setTimeout(() => { $('#sheet').hidden = true; }, 240);
  tab = null; plantId = null; editing = null;
  clearComposer(); comp.ctx = '';
  scene.select(null);
  syncTabs();
  if (lastFocus && lastFocus.isConnected) lastFocus.focus();
}
const backToList = () => { plantId = null; scene.select(null); render(); };

function syncTabs() {
  document.querySelectorAll('#tabbar button[data-tab]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
}

function render() {
  syncTabs();
  if (!tab) return;
  $('#sheet-back').hidden = !(tab === 'plants' && plantId);
  $('#sheet-meta').innerHTML = '';
  if (tab === 'plants' && plantId) return fillPlant();
  $('#sheet-title').textContent = TITLES[tab] || '';
  const body = $('#sheet-body');
  if (tab === 'plants') body.innerHTML = plantsHTML();
  else if (tab === 'cal') { body.innerHTML = calHTML(); if (calView === 'month') wireGrid(); }
  else if (tab === 'photos') body.innerHTML = photosHTML();
  else if (tab === 'note') body.innerHTML = `<p class="lead">Tell the garden what changed. Pick a plant if you know
    it, or leave it to the AI.</p>${composerHTML()}`;
}

/* ---------- Plants: the chart is the list ---------- */
function plantsHTML() {
  const list = D.plants();
  let h = legendHTML(true);
  for (const area of ['balcony', 'indoor']) {
    const mine = list.filter((p) => p.area === area);
    if (!mine.length) continue;
    h += `<div class="areahd"><span>${D.AREA_LABEL[area]}</span><i></i><span>${mine.length}</span></div>`;
    h += mine.map((p) => {
      const health = p.health;
      return `<button class="prow" data-act="plant" data-val="${esc(p.id)}">
        <span class="art" aria-hidden="true">${artFor(p)}</span>
        <span class="top"><span class="nm">${esc(p.name)}</span></span>
        <span class="cond ${health ? esc(health.tone) : ''}">${health ? esc(health.label) : '—'}</span>
        ${trackHTML(D.KEY_BY_ID[p.id])}
      </button>`;
    }).join('');
  }
  return h;
}

/* ---------- a plant ---------- */
function fillPlant() {
  const p = D.plantById(plantId);
  if (!p) { backToList(); return; }
  const key = D.KEY_BY_ID[p.id];
  const pr = D.PROFILE[key] || { t: p.name, src: '', body: [] };
  const since = D.dBetween(p.last, D.todayISO());
  const h = p.health;
  const iss = ((h && h.issues) || []).map((i) => esc(i.label || i.type)).join(', ');
  const T = D.todayISO();
  const todays = D.tasksForPlant(T, p.id).filter((t) => !D.isDone(T, t.key));

  $('#sheet-title').textContent = pr.t || p.name;
  $('#sheet-meta').innerHTML = `<span>${D.AREA_LABEL[p.area]}</span><span>· 🪴 ${esc(p.stage)}</span>`
    + `<span>· watered ${since <= 0 ? 'today' : since + ' d ago'}</span>`;

  $('#sheet-body').innerHTML =
    (todays.length ? `<section class="card"><h3 class="sec-hd">Needs doing</h3>
      ${todays.map((t) => taskRowHTML(T, t, true, false)).join('')}</section>` : '')
    + `<section class="card"><h3 class="sec-hd">Condition</h3>
      ${h ? `<div class="kunto"><span class="hb ${esc(h.tone)}">${esc(h.label)}</span></div>
        <p class="guide-p dim">${esc(TONE_NOTE[h.tone] || '')}</p>` : ''}
      ${iss ? `<div class="alert-row"><span class="ico" aria-hidden="true">⚠️</span><div><div class="what">${iss}</div></div></div>` : ''}
      ${p.observations ? `<p class="guide-p dim-i">${esc(p.observations)}</p>` : ''}
      ${ticksHTML()}${trackHTML(key)}${legendHTML(false)}</section>`
    + `<section class="card"><h3 class="sec-hd">Journal<span class="cnt">${p.notes.length}</span></h3>
      ${composerHTML({ lockPlant: p.id, bare: true })}
      <div class="jlist">${plantJournalHTML(p)}</div></section>`
    + `<details class="fold"><summary>Care</summary><div class="fbody">
      ${(pr.body || []).map((b) => `<p class="guide-p">${esc(b)}</p>`).join('')}
      ${pr.src ? `<p class="guide-p src">${esc(pr.src)}</p>` : ''}
      ${D.REAL[key] ? `<figure class="realfig"><img src="${D.REAL[key][0]}" alt="${esc(D.REAL[key][1])}" loading="lazy"
        onerror="this.parentElement.style.display='none'"><figcaption>${esc(D.REAL[key][1])}</figcaption></figure>` : ''}
    </div></details>`;
}

const editBoxHTML = (kind, id, plantFor, text) => `<div class="jedit">
  <textarea id="etext">${esc(text)}</textarea>
  <div class="erow"><button data-act="edit-cancel">Cancel</button>
    <button class="go" data-act="edit-save" data-val="${esc(id)}" data-plant="${esc(plantFor || '')}" data-kind="${kind}">Save</button>
  </div></div>`;

/* Photos ride with the entry they were posted with. */
const shotsFor = (list) => list.length
  ? `<div class="jshots">${list.map((x) => `<button data-act="view" data-val="${esc(x.id)}"
      aria-label="${esc(D.shortDate(x.date))}"><img src="${D.photoURL(x.id)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>`
  : '';

function plantJournalHTML(p) {
  const notes = D.shown(p.notes).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  if (!notes.length) return '<div class="none">No entries yet</div>';
  const photos = D.photosFor(p.id);
  return notes.map((n) => {
    if (editing && editing.kind === 'note' && editing.id === n.id)
      return `<div class="jent"><div class="jbody"><div class="jname">${esc(D.shortDate(n.date))}</div>
        ${editBoxHTML('note', n.id, p.id, n.text)}</div></div>`;
    return `<div class="jent">
      <div class="jbody">
        <div class="jname">${esc(D.shortDate(n.date))}${n.ai ? ' <span class="ai" title="AI&#39;s reading">✨</span>' : ''}</div>
        <div class="jtext">${esc(n.text)}</div>
        ${shotsFor(photos.filter((x) => x.date === n.date))}
      </div>
      <span class="jacts">
        <button class="jdel" data-act="note-edit" data-val="${esc(n.id)}" data-plant="${esc(p.id)}" aria-label="Edit">✎</button>
        <button class="jdel" data-act="note-del" data-val="${esc(p.id)}" data-note="${esc(n.id)}" aria-label="Delete">🗑</button>
      </span>
    </div>`;
  }).join('');
}

/* ---------- Calendar: the date axis ---------- */
function calHTML() {
  const T = D.todayISO();
  const seg = ['day', 'days', 'month'].map((v) =>
    `<button data-act="calview" data-val="${v}" aria-selected="${v === calView}">${{ day: 'Day', days: '5 days', month: 'Month' }[v]}</button>`).join('');
  const onToday = calView === 'month'
    ? (view.y === new Date().getFullYear() && view.m === new Date().getMonth())
    : cursor === T;
  /* The Today button keeps its space when hidden, so the arrows never shift. */
  const nav = `<div class="calbar">
    <div class="seg" role="tablist">${seg}</div>
    <div class="navs">
      <button data-act="step" data-val="-1" aria-label="Previous">‹</button>
      <button data-act="step" data-val="1" aria-label="Next">›</button>
      <button data-act="today" class="todaybtn"${onToday ? ' style="visibility:hidden"' : ''}>Today</button>
    </div></div>`;
  if (calView === 'month') return nav + `<div class="monthnav"><div class="kuu">${D.KUUT[view.m]}<b>.</b></div>
    <span class="sub">${view.y}</span></div>` + monthGridHTML();
  if (calView === 'day') return nav + dayHTML(cursor, true);
  let h = '';
  for (let i = 0; i < DAYS_SPAN; i++) h += dayHTML(D.addDays(cursor, i), false);
  return nav + h;
}

function dayHTML(date, detail) {
  const T = D.todayISO();
  const d = D.dayOf(date);
  const wx = D.wxOf(date);
  const dt = new Date(date);
  /* Nothing happened on a day that has not happened: a future day carries the
     plan and the forecast only, with no journal and no composer. */
  const future = date > T;
  const head = `<div class="dhd">
    <span class="dwd">${D.VKO[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.</span>
    ${date === T ? '<span class="dtoday">today</span>' : ''}
    ${wx ? `<span class="dwx">${D.wxIcon(wx)} ${Math.round(wx.tmax)}° / ${Math.round(wx.tmin)}° · rain ${wx.pop}%</span>` : ''}
  </div>`;
  const body = d.alerts.map((a) => alertHTML(a, !detail)).join('')
    + (d.groups.length ? d.groups.map((g) => `<div class="pgroup">
        <div class="pbody"><button class="pname" data-act="plant" data-val="${esc(g.plant.id)}">${esc(g.plant.name)}</button>
          ${g.tasks.map((t) => taskRowHTML(date, t, date === T, !detail)).join('')}</div></div>`).join('')
      : `<div class="none">${date < T ? 'A past day.' : 'Nothing due'}</div>`);
  return `<section class="dayblock${date === T ? ' isnow' : ''}">${head}${body}
    ${detail && !future ? dayJournalHTML(date) : ''}</section>`;
}

function dayJournalHTML(date) {
  const list = D.shown(D.entriesDoc.entries.filter((e) => e.date === date))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const dayPhotos = D.shown(D.PHOTOS.filter((x) => x.date === date));
  const inEntries = new Set(list.flatMap((e) => e.photoIds || []));
  /* Photos uploaded on their own belong to the whole balcony, which is a subject
     at the same level as a plant, not an orphan bucket. */
  const loose = dayPhotos.filter((x) => !inEntries.has(x.id) && !x.plant);
  const rows = list.map((e) => {
    const who = (e.assigned || []).map((a) => D.plantById(a.plantId)).filter(Boolean);
    const shots = (e.photoIds || []).map((id) => D.PHOTOS.find((x) => x.id === id)).filter(Boolean);
    if (editing && editing.kind === 'entry' && editing.id === e.id)
      return `<div class="jent"><div class="jbody"><div class="jname"><span class="pending">editing — saving will re-sort this</span></div>
        ${editBoxHTML('entry', e.id, '', e.text)}</div></div>`;
    return `<div class="jent"><div class="jbody">
      <div class="jname">${who.length
        ? who.map((p) => `<button class="jwho" data-act="plant" data-val="${esc(p.id)}">${esc(p.name)}</button>`).join(' · ')
        : e.status === 'pending' ? '<span class="pending">sorting…</span>' : '<span class="pending">not sorted</span>'}
        ${e.status === 'sorted' && who.length ? '<span class="ai" title="AI&#39;s reading">✨</span>' : ''}</div>
      <div class="jtext">${esc(e.text)}</div>
      ${shotsFor(shots)}
      </div>
      <span class="jacts">
        <button class="jdel" data-act="entry-edit" data-val="${esc(e.id)}" aria-label="Edit">✎</button>
        <button class="jdel" data-act="entry-del" data-val="${esc(e.id)}" aria-label="Delete">🗑</button>
      </span></div>`;
  }).join('');
  const looseRow = loose.length ? `<div class="jent"><div class="jbody">
      <div class="jname">Whole balcony</div>${shotsFor(loose)}</div></div>` : '';
  useComposer('day:' + date, { date });
  return `<div class="tsec"><h3 class="sec-hd">What happened</h3>
      ${rows || looseRow ? rows + looseRow : '<div class="none">No entries</div>'}</div>
    <div class="tsec"><h3 class="sec-hd">Add an update for ${date === D.todayISO() ? 'today' : esc(D.shortDate(date))}</h3>
      ${composerHTML({ bare: true })}</div>`;
}

function monthGridHTML() {
  const T = D.todayISO();
  const first = new Date(view.y, view.m, 1);
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  let html = '<div class="dow"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="grid" id="grid">';
  for (let i = 0; i < lead; i++) html += '<div class="cell out" aria-hidden="true"></div>';
  for (let dd = 1; dd <= daysIn; dd++) {
    const date = D.iso(new Date(view.y, view.m, dd));
    const list = D.flatTasks(date);
    const al = D.dayOf(date).alerts;
    const wx = D.wxOf(date);
    const cls = ['cell', date === T ? 'today' : '', date < T ? 'past' : '',
      al.some((a) => a.key.startsWith('heat')) ? 'hot' : al.some((a) => a.key.startsWith('cold')) ? 'cold' : ''].join(' ');
    const seeds = list.slice(0, 6).map((t) => `<i class="seed ${t.cat === 'water' ? 'water' : t.cat === 'pollen' ? 'pollen' : 'care'}"></i>`).join('')
      + (list.length > 6 ? '<i class="seed more">+</i>' : '')
      + (D.photoDates.has(date) ? '<i class="seed photo"></i>' : '');
    html += `<button type="button" class="${cls}" tabindex="${date === cursor ? 0 : -1}" data-date="${date}"
      aria-label="${esc(`${D.VKO[new Date(date).getDay()]} ${D.shortDate(date)}, ${list.length} tasks`)}">
      <span class="d">${dd}</span>
      ${wx ? `<span class="meta" aria-hidden="true"><span class="wx">${D.wxIcon(wx)}</span><span class="t ${wx.tmax >= 27 ? 'warm' : ''}">${Math.round(wx.tmax)}°</span></span>` : ''}
      <span class="seeds" aria-hidden="true">${seeds}</span></button>`;
  }
  const winEnd = D.addDays(T, 60), mStart = D.iso(new Date(view.y, view.m, 1)), mEnd = D.iso(new Date(view.y, view.m, daysIn));
  const note = (mEnd < T || mStart > winEnd) ? '<div class="calnote">Tasks are planned about 8 weeks ahead only.</div>' : '';
  return html + '</div><div class="legend">'
    + '<span><i class="seed water"></i> water</span><span><i class="seed pollen"></i> pollinate</span>'
    + '<span><i class="seed care"></i> care</span><span><i class="seed photo"></i> photo</span></div>' + note;
}

function wireGrid() {
  const g = $('#grid'); if (!g) return;
  g.addEventListener('click', (e) => {
    const c = e.target.closest('.cell[data-date]'); if (!c) return;
    cursor = c.dataset.date; calView = 'day'; D.store.set('calView3d', calView); render();
  });
  g.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    cursor = D.addDays(cursor, step); syncViewFromCursor(); render();
    $(`.cell[data-date="${cursor}"]`)?.focus();
  });
}

/* ---------- Photos: the image index ---------- */
function photosHTML() {
  const chips = [`<button class="chip" data-act="filter" data-val="" aria-pressed="${feedFilter === ''}">All</button>`]
    .concat(D.plants().filter((p) => D.photosFor(p.id).length).map((p) =>
      `<button class="chip" data-act="filter" data-val="${esc(p.id)}" aria-pressed="${feedFilter === p.id}">${esc(p.name)}</button>`));
  const list = (feedFilter ? D.photosFor(feedFilter) : D.shown(D.PHOTOS))
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created || 0) - (a.created || 0));
  const head = `<div class="chips">${chips.join('')}</div>`;
  if (!list.length) return head + '<div class="none">No photos yet</div>';
  const groups = [];
  list.forEach((x) => {
    const g = groups[groups.length - 1];
    if (g && g.date === x.date) g.items.push(x); else groups.push({ date: x.date, items: [x] });
  });
  return head + groups.map((g) => `<div class="fgroup">
    <div class="fhead"><span>${esc(D.VKO[new Date(g.date).getDay()])} ${esc(D.shortDate(g.date))}</span><i></i><span>${g.items.length}</span></div>
    <div class="fimgs">${g.items.map((x) => {
      const p = x.plant ? D.plantById(x.plant) : null;
      return `<button data-act="view" data-val="${esc(x.id)}" aria-label="${esc(p ? p.name : 'Whole balcony')} ${esc(D.shortDate(x.date))}">
        <img src="${D.photoURL(x.id)}" alt="" loading="lazy" decoding="async"></button>`;
    }).join('')}</div></div>`).join('');
}

/* ---------- toasts, undo ---------- */
export function toast(msg, undoLabel, onUndo) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (onUndo) {
    const b = document.createElement('button');
    b.textContent = undoLabel;
    b.onclick = () => { onUndo(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), onUndo ? 5200 : 3200);
  return el;
}
function hold(msg, commit, undo) {
  let cancelled = false;
  const el = toast(msg, 'Undo', () => { cancelled = true; undo(); });
  setTimeout(() => { if (!cancelled) { el.remove(); commit(); } }, 5000);
}

/* ---------- photo viewer ---------- */
let viewerList = [], viewerIdx = -1, viewerKey = null, viewerFocus = null;
function currentPhotoList() {
  const have = new Set(D.PHOTOS.map((p) => p.id));
  return [...document.querySelectorAll('#sheet-body [data-act="view"]')].map((i) => i.dataset.val).filter((id) => have.has(id));
}
function showViewerAt(i) {
  if (i < 0 || i >= viewerList.length) return;
  viewerIdx = i; viewerKey = viewerList[i];
  const rec = D.PHOTOS.find((p) => p.id === viewerKey);
  $('#viewer-img').src = D.photoURL(viewerKey);
  const p = rec && rec.plant ? D.plantById(rec.plant) : null;
  $('#viewer-cap').textContent = rec ? `${p ? p.name : 'Whole balcony'} · ${D.shortDate(rec.date)}` : '';
  $('#viewer-prev').disabled = i <= 0;
  $('#viewer-next').disabled = i >= viewerList.length - 1;
}
function viewPhoto(id) {
  viewerFocus = document.activeElement;
  viewerList = currentPhotoList();
  viewerIdx = viewerList.indexOf(id);
  if (viewerIdx < 0) { viewerList = [id]; viewerIdx = 0; }
  showViewerAt(viewerIdx);
  $('#viewer').classList.add('on');
  $('#ph-close').focus();
}
function closeViewer() {
  $('#viewer').classList.remove('on');
  if (viewerFocus && viewerFocus.isConnected) viewerFocus.focus();
}

/* ---------- plant picker (modal, for re-tagging a photo) ---------- */
let _pickResolve = null, _pickFocus = null;
function pickPlant(title) {
  _pickFocus = document.activeElement;
  $('#pk-title').textContent = title || 'Which plant?';
  $('#pk-grid').innerHTML = D.plants().map((p) =>
    `<button data-pick="${esc(p.id)}"><span class="av">${artFor(p)}</span>${esc(p.name)}</button>`).join('')
    + '<button class="gen" data-pick=""><span class="av">🪴</span>Whole balcony</button>';
  $('#picker').classList.add('open');
  setTimeout(() => $('#pk-grid button')?.focus(), 40);
  return new Promise((res) => { _pickResolve = res; });
}
function closePicker(v) {
  $('#picker').classList.remove('open');
  const r = _pickResolve; _pickResolve = null;
  if (_pickFocus && _pickFocus.isConnected) _pickFocus.focus();
  if (r) r(v);
}

/* ---------- unlock ---------- */
let _unlockResolve = null;
function askPass() {
  return new Promise((res) => {
    _unlockResolve = res;
    $('#unlock').classList.add('open');
    $('#unlock-input').value = '';
    setTimeout(() => $('#unlock-input').focus(), 40);
  });
}
function closeUnlock(v) {
  $('#unlock').classList.remove('open');
  const r = _unlockResolve; _unlockResolve = null;
  if (r) r(v);
}

/* ---------- actions ---------- */
const focusEdit = () => { const t = $('#etext'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };

const ACTIONS = {
  plant: (pid) => { if (pid) openPlant(pid); },
  view: (id) => viewPhoto(id),
  filter: (v) => { feedFilter = v; render(); },
  calview: (v) => { calView = v; D.store.set('calView3d', v); syncViewFromCursor(); render(); },
  step: (v) => {
    const dir = Number(v);
    if (calView === 'month') {
      view.m += dir;
      if (view.m < 0) { view.m = 11; view.y--; }
      if (view.m > 11) { view.m = 0; view.y++; }
      cursor = D.iso(new Date(view.y, view.m, 1));
    } else {
      cursor = D.addDays(cursor, dir * (calView === 'day' ? 1 : DAYS_SPAN));
      syncViewFromCursor();
    }
    renderAll();
  },
  today: () => { cursor = D.todayISO(); syncViewFromCursor(); renderAll(); },
  attach: () => { $('#ph-input').click(); },
  unstage: (i) => { URL.revokeObjectURL(comp.staged[i].url); comp.staged.splice(i, 1); render(); },
  pickplant: () => { comp.picking = !comp.picking; render(); },
  setplant: (v) => { comp.plant = v || null; comp.picking = false; render(); },
  save: (lock) => saveComposer(lock || null),
  done: (_, el) => { D.markDone(el.dataset.date, el.dataset.key); },
  'entry-del': (id) => {
    hold('Entry deleted', async () => { if (await D.deleteEntry(id)) renderAll(); },
      () => { D._hidden.delete(id); renderAll(); });
    D._hidden.add(id); renderAll();
  },
  'note-del': (pid, el) => {
    const noteId = el.dataset.note;
    hold('Entry deleted', async () => { if (await D.deleteNote(pid, noteId)) renderAll(); },
      () => { D._hidden.delete(noteId); renderAll(); });
    D._hidden.add(noteId); renderAll();
  },
  'note-edit': (id, el) => { editing = { kind: 'note', id, plantId: el.dataset.plant }; render(); focusEdit(); },
  'entry-edit': (id) => { editing = { kind: 'entry', id }; render(); focusEdit(); },
  'edit-cancel': () => { editing = null; render(); },
  'edit-save': async (id, el) => {
    const text = ($('#etext')?.value || '').trim();
    const kind = el.dataset.kind;
    if (!text) { editing = null; render(); return; }
    const ok = kind === 'note' ? await D.editNote(el.dataset.plant, id, text) : await D.editEntry(id, text);
    if (!ok) return;
    editing = null;
    renderAll();
    if (kind === 'entry') D.refreshSoon();
  },
};

/* ---------- render ---------- */
export function renderAll() {
  const T = D.todayISO();
  const horizon = D.iso(new Date(view.y, view.m + 1, 7));
  D.rebuildTasks(horizon > D.addDays(T, 60) ? D.addDays(T, 60) : horizon);
  renderTop();
  if (tab && !$('#sheet').contains(document.activeElement)) render();
  scene.sync();
}

/* ---------- mount ---------- */
export function mount(sceneApi) {
  scene = sceneApi;
  syncViewFromCursor();

  D.hooks.askPass = askPass;
  D.hooks.toast = toast;
  D.hooks.onChange = renderAll;
  D.hooks.onBusy = (label) => { busy = label; renderTop(); };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(el.dataset.val, el, e);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'ctext') {
      comp.text = e.target.value;
      const btn = $('[data-act="save"]');
      if (btn) btn.disabled = !comp.text.trim() && !comp.staged.length;
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'cdate') { comp.date = e.target.value; comp.fromPhoto = null; }
  });

  $('#sheet-close').onclick = closeSheet;
  $('#sheet-back').onclick = backToList;
  document.querySelectorAll('#tabbar button[data-tab]').forEach((b) => { b.onclick = () => openTab(b.dataset.tab); });
  $('#home-btn').onclick = () => { closeSheet(); scene.home(); };
  $('#lockbtn').onclick = () => { D.lock(); toast('Locked. You can read, but not edit.'); };

  $('#viewer-prev').onclick = () => showViewerAt(viewerIdx - 1);
  $('#viewer-next').onclick = () => showViewerAt(viewerIdx + 1);
  $('#viewer').onclick = (e) => { if (e.target.id === 'viewer') closeViewer(); };
  $('#ph-close').onclick = closeViewer;
  $('#ph-tag').onclick = async () => {
    if (!viewerKey) return;
    const id = viewerKey;
    const pid = await pickPlant('Which plant is this photo of?');
    if (pid === null) return;
    if (await D.tagPhoto(id, pid)) renderAll();
  };
  $('#ph-del').onclick = () => {
    const id = viewerKey;
    closeViewer();
    hold('Photo deleted', async () => { await D.deletePhoto(id); renderAll(); },
      () => { D._hidden.delete(id); D.applyPhotos(); });
    D._hidden.add(id); D.applyPhotos();
  };

  $('#pk-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) closePicker(b.dataset.pick);
  });
  $('#pk-cancel').onclick = () => closePicker(null);
  $('#picker').addEventListener('click', (e) => { if (e.target.id === 'picker') closePicker(null); });

  $('#unlock-go').onclick = () => closeUnlock($('#unlock-input').value.trim() || null);
  $('#unlock-cancel').onclick = () => closeUnlock(null);
  $('#unlock-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') closeUnlock($('#unlock-input').value.trim() || null); });
  $('#unlock').addEventListener('click', (e) => { if (e.target.id === 'unlock') closeUnlock(null); });

  $('#ph-input').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    for (const f of files) {
      const taken = await exifDate(f);              // read EXIF before the resize drops it
      if (taken && taken <= D.todayISO() && !comp.fromPhoto) {
        comp.date = taken;
        comp.fromPhoto = D.shortDate(taken);
      }
      const blob = await shrink(f);
      comp.staged.push({ blob, url: URL.createObjectURL(blob) });
    }
    render();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#unlock').classList.contains('open')) closeUnlock(null);
      else if ($('#picker').classList.contains('open')) closePicker(null);
      else if ($('#viewer').classList.contains('on')) closeViewer();
      else if (tab === 'plants' && plantId) backToList();
      else if (tab) closeSheet();
      return;
    }
    if ($('#viewer').classList.contains('on')) {
      if (e.key === 'ArrowLeft') showViewerAt(viewerIdx - 1);
      else if (e.key === 'ArrowRight') showViewerAt(viewerIdx + 1);
      return;
    }
    if (e.key !== 'Tab') return;
    const box = $('#unlock').classList.contains('open') ? $('#unlock')
      : $('#picker').classList.contains('open') ? $('#picker')
      : tab ? $('#sheet') : null;
    if (!box) return;
    const f = [...box.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  return { openPlant, renderAll, toast };
}

export const currentPlantId = () => plantId;
export { TONE_RING };
