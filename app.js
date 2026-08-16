const PARTICIPANTS = [['ca', 'Ca'], ['cl', 'Cl'], ['p', 'P'], ['g', 'G']];
const CHALLENGE_START = '2026-08-17';
const DAY_FIELDS = ['steps', 'water', 'protein', 'mobility', 'gym', 'run', 'recovery', 'challengeSession'];
const HABITS = [
  { key: 'steps', label: 'STEPS', joins: 1 },
  { key: 'protein', label: 'PROTEIN', joins: 3 },
  { key: 'water', label: 'WATER', joins: 4 },
  { key: 'mobility', label: 'MOBILITY', joins: 5 }
];
const $ = id => document.getElementById(id);
const localKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const todayKey = () => localKey(new Date());
const parseDate = value => new Date(`${value}T00:00:00`);
const addDays = (value, amount) => { const d = parseDate(value); d.setDate(d.getDate() + amount); return localKey(d); };
const mondayKey = value => { const d = parseDate(value); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localKey(d); };
const weekKeys = value => { const monday = mondayKey(value); return Array.from({ length: 7 }, (_, i) => addDays(monday, i)); };

const emptyPerson = name => ({
  name, startDate: CHALLENGE_START, setupComplete: false,
  challenge: { type: null, bodyweight: 0, strength: { squat: { baseline: 0, retest: 0 }, bench: { baseline: 0, retest: 0 }, deadlift: { baseline: 0, retest: 0 } }, run: { distance: 5, baselinePace: 0, retestPace: 0 }, retestDate: null },
  sessionDefinition: { mode: 'health', custom: '' }, days: {}
});

let state = { participants: {} };
let activeId = null;
let entryDate = todayKey();
let leaderboardPeriod = 'week';
let baselineMode = 'auto';
let saveTimer;

function normalizeDay(raw = {}) {
  return { steps: !!raw.steps, water: !!raw.water, protein: !!raw.protein, mobility: !!raw.mobility, gym: !!raw.gym, run: !!raw.run, recovery: !!(raw.recovery || raw.compression || raw.sauna), challengeSession: !!(raw.challengeSession || raw.seminar) };
}
function normalize(raw = {}) {
  const result = { version: 7, participants: {} };
  for (const [id, name] of PARTICIPANTS) {
    const base = emptyPerson(name), source = raw.participants?.[id] || {};
    const strength = {};
    for (const lift of ['squat', 'bench', 'deadlift']) strength[lift] = { ...base.challenge.strength[lift], ...(source.challenge?.strength?.[lift] || {}) };
    const days = {};
    for (const [date, day] of Object.entries(source.days || {})) days[date] = normalizeDay(day);
    result.participants[id] = { ...base, ...source, name, setupComplete: !!(source.setupComplete || source.challenge?.type), challenge: { ...base.challenge, ...(source.challenge || {}), strength, run: { ...base.challenge.run, ...(source.challenge?.run || {}) } }, sessionDefinition: { ...base.sessionDefinition, ...(source.sessionDefinition || {}) }, days };
  }
  return result;
}
function person() { return activeId ? state.participants[activeId] : null; }
function validId(id) { return PARTICIPANTS.some(([candidate]) => candidate === id); }

async function loadState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    state = normalize(await response.json());
  } catch { state = normalize(JSON.parse(localStorage.getItem('forge-fallback') || '{}')); }
  showLanding();
}
async function savePerson() {
  localStorage.setItem('forge-fallback', JSON.stringify(state));
  const response = await fetch('/api/participant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: activeId, participant: person() }) });
  if (!response.ok) throw new Error('Save failed');
}

function challengeWeek(participant, date = todayKey()) {
  if (!participant?.startDate) return 0;
  const elapsed = Math.floor((parseDate(date) - parseDate(participant.startDate)) / 86400000);
  return elapsed < 0 ? 0 : Math.min(8, Math.floor(elapsed / 7) + 1);
}
function habitsFor(participant, date) {
  const week = challengeWeek(participant, date), day = participant.days[date] || {};
  return HABITS.map(habit => ({ ...habit, active: week >= habit.joins, done: !!day[habit.key] }));
}
function stackComplete(participant, date) {
  const active = habitsFor(participant, date).filter(habit => habit.active);
  return challengeWeek(participant, date) > 0 && active.length > 0 && active.every(habit => habit.done);
}
function recoveryPointsForDate(participant, date) {
  const day = participant.days[date] || {};
  const earlier = weekKeys(date).filter(key => key < date).reduce((sum, key) => sum + Number(!!participant.days[key]?.recovery), 0);
  return day.recovery ? Math.min(1, Math.max(0, 2 - earlier)) : 0;
}
function challengeSessionPointForDate(participant, date) {
  return participant.days[date]?.challengeSession && !weekKeys(date).some(key => key < date && participant.days[key]?.challengeSession) ? 1 : 0;
}
function relativeStrengthChange(participant) {
  const c = participant.challenge, weight = Number(c.bodyweight) || 0;
  const baseline = ['squat', 'bench', 'deadlift'].reduce((sum, lift) => sum + (Number(c.strength[lift].baseline) || 0), 0);
  const retest = ['squat', 'bench', 'deadlift'].reduce((sum, lift) => sum + (Number(c.strength[lift].retest) || 0), 0);
  return weight > 0 && baseline > 0 && retest > 0 ? retest / weight - baseline / weight : 0;
}
function challengeBonus(participant) {
  const c = participant.challenge;
  if (c.type === 'strength') { const gain = relativeStrengthChange(participant); return gain > 0 ? 15 + Math.round(gain * 20) : 0; }
  if (c.type === 'run') { const secondsFaster = (Number(c.run.baselinePace) || 0) - (Number(c.run.retestPace) || 0); return secondsFaster > 0 ? 15 + Math.round(secondsFaster) : 0; }
  return 0;
}
function pointsFor(participant, date) {
  const day = participant.days[date] || {};
  let points = Number(!!day.gym) + Number(!!day.run) + recoveryPointsForDate(participant, date) + challengeSessionPointForDate(participant, date) + Number(stackComplete(participant, date));
  if (participant.challenge.retestDate === date) points += challengeBonus(participant);
  return points;
}
function periodPoints(participant, period, date = todayKey()) {
  if (period === 'today') return pointsFor(participant, date);
  if (period === 'week') return weekKeys(date).reduce((sum, key) => sum + pointsFor(participant, key), 0);
  const dates = new Set(Object.keys(participant.days));
  if (participant.challenge.retestDate) dates.add(participant.challenge.retestDate);
  return [...dates].reduce((sum, key) => sum + pointsFor(participant, key), 0);
}
function definitionLabel(participant) {
  const definition = participant.sessionDefinition;
  if (definition.mode === 'reading') return '60 MIN READING';
  if (definition.mode === 'mealPrep') return 'MEAL PREP';
  return definition.mode === 'custom' ? (definition.custom.trim().toUpperCase() || 'CUSTOM SESSION') : '40 MIN HEALTH CONTENT';
}
function baselineComplete(participant) {
  const c = participant.challenge;
  return c.type === 'strength' ? Number(c.bodyweight) > 0 && ['squat', 'bench', 'deadlift'].every(lift => Number(c.strength[lift].baseline) > 0) : c.type === 'run' && Number(c.run.distance) > 0 && Number(c.run.baselinePace) > 0;
}
function retestComplete(participant) {
  const c = participant.challenge;
  return c.type === 'strength' ? ['squat', 'bench', 'deadlift'].every(lift => Number(c.strength[lift].retest) > 0) : c.type === 'run' && Number(c.run.retestPace) > 0;
}

function renderDashboard() {
  const p = person(); if (!p) return;
  $('todayPoints').textContent = periodPoints(p, 'today'); $('weekPoints').textContent = periodPoints(p, 'week');
  const week = challengeWeek(p); $('weekLabel').textContent = week ? `WEEK ${week} / 8` : 'NOT STARTED';
  renderLine(p); renderLeaderboard();
  const assessment = week >= 8 ? !retestComplete(p) : week === 1 && !baselineComplete(p);
  $('baselineButton').hidden = !assessment;
  $('baselineButton').firstChild.textContent = week >= 8 ? 'ADD FINAL RE-TEST ' : 'SET YOUR BASELINE ';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'dashboard'));
}
function renderLine(participant) {
  const keys = weekKeys(todayKey()), values = keys.map(key => pointsFor(participant, key));
  const width = 700, height = 180, padding = 24, max = Math.max(4, ...values);
  const positions = values.map((value, i) => ({ x: padding + i * ((width - padding * 2) / 6), y: height - 25 - (value / max) * 115, value }));
  const grids = [40, 85, 130].map(y => `<line class="line-grid" x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"/>`).join('');
  const points = positions.map(point => `${point.x},${point.y}`).join(' ');
  const dots = positions.map((point, i) => `<circle class="line-dot ${keys[i] === todayKey() ? 'today' : ''}" cx="${point.x}" cy="${point.y}" r="6"/><text class="line-value" x="${point.x}" y="${point.y - 13}">${point.value}</text>`).join('');
  $('weeklyLine').innerHTML = `${grids}<polyline class="line-path" points="${points}"/>${dots}`;
  $('lineLabels').innerHTML = keys.map(key => `<span>${new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(parseDate(key))}</span>`).join('');
}
function renderLeaderboard() {
  const rows = PARTICIPANTS.map(([id, name]) => ({ id, name, points: periodPoints(state.participants[id], leaderboardPeriod) })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map(row => row.points));
  $('leaderWeek').classList.toggle('active', leaderboardPeriod === 'week'); $('leaderOverall').classList.toggle('active', leaderboardPeriod === 'overall');
  $('leaderboardBars').innerHTML = rows.map((row, index) => `<div class="leader-row ${row.id === activeId ? 'me' : ''}"><span class="leader-name">${index + 1}. ${row.name}</span><div class="leader-track"><div class="leader-fill" style="width:${row.points / max * 100}%"></div></div><span class="leader-points">${row.points}</span></div>`).join('');
}

function setView(id, scroll = true) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
  const chooser = id === 'landing' || id === 'setup' || id === 'rules';
  document.querySelector('.bottom-nav').hidden = chooser;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  if (id === 'update') loadEntry(); if (id === 'baseline') loadBaseline();
  if (scroll) scrollTo({ top: 0, behavior: 'smooth' });
}
function showLanding() { activeId = null; setView('landing', false); }
function selectPlayer(id) {
  activeId = id;
  if (person().setupComplete) { renderDashboard(); setView('dashboard'); }
  else showSetup();
}
function showSetup() {
  const p = person(), c = p.challenge;
  $('setupName').textContent = p.name.toUpperCase();
  if (c.type) document.querySelector(`[name="challengeType"][value="${c.type}"]`).checked = true;
  $('setupRunDistanceInput').value = c.run.distance || 5;
  const d = p.sessionDefinition || { mode: 'health', custom: '' };
  document.querySelector(`[name="sessionDefinition"][value="${d.mode}"]`).checked = true;
  $('customSessionInput').value = d.custom || '';
  toggleSetupRun(); toggleCustomSession(); setView('setup', false);
}
function toggleSetupRun() { $('setupDistanceWrap').hidden = document.querySelector('[name="challengeType"]:checked')?.value !== 'run'; }
function toggleCustomSession() { $('customSessionWrap').hidden = document.querySelector('[name="sessionDefinition"]:checked')?.value !== 'custom'; }

function updateEntryHabitState(participant) {
  const week = challengeWeek(participant, entryDate), active = habitsFor(participant, entryDate).filter(habit => habit.active).map(habit => habit.label);
  for (const habit of HABITS) { const label = $(`${habit.key}Input`).closest('label'), enabled = week >= habit.joins; label.classList.toggle('active-in-stack', enabled); label.classList.toggle('out-of-stack', !enabled); label.dataset.stackNote = enabled ? '' : `JOINS W${habit.joins}`; }
  $('habitStackNote').textContent = week ? `WEEK ${week}: ${active.join(' + ')} ALL NEED TO BE MET FOR THE DAILY HABIT POINT. YOU CAN LOG THE REST EARLY.` : 'LOG ANY HABIT NOW. DAILY HABIT POINTS BEGIN ON YOUR CHALLENGE START DATE.';
}
function loadEntry() {
  const p = person(), day = p.days[entryDate] || {};
  $('entryPerson').textContent = p.name.toUpperCase(); $('entryDate').value = entryDate;
  DAY_FIELDS.forEach(key => { $(`${key}Input`).checked = !!day[key]; });
  $('challengeSessionEntryLabel').textContent = `DONE · ${definitionLabel(p)} · MAX 1/WK`;
  updateEntryHabitState(p);
}
function parsePace(value) { const match = String(value || '').trim().match(/^(\d{1,2}):([0-5]\d)$/); return match ? Number(match[1]) * 60 + Number(match[2]) : 0; }
function formatPace(value) { const seconds = Number(value) || 0; return seconds ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : ''; }
function loadBaseline() {
  const p = person(), c = p.challenge, retest = baselineMode !== 'edit' && challengeWeek(p) >= 8;
  $('baselinePerson').textContent = p.name.toUpperCase(); $('baselineStrength').hidden = retest || c.type !== 'strength'; $('baselineRun').hidden = retest || c.type !== 'run'; $('retestStrength').hidden = !retest || c.type !== 'strength'; $('retestRun').hidden = !retest || c.type !== 'run';
  $('bodyweightInput').value = c.bodyweight || ''; ['squat', 'bench', 'deadlift'].forEach(lift => { $(`${lift}BaselineInput`).value = c.strength[lift].baseline || ''; $(`${lift}RetestInput`).value = c.strength[lift].retest || ''; });
  $('runDistanceInput').value = c.run.distance || 5; $('runBaselineInput').value = formatPace(c.run.baselinePace); $('runRetestInput').value = formatPace(c.run.retestPace);
  $('baselineStatus').textContent = retest ? 'ANY IMPROVEMENT EARNS 15 POINTS, PLUS THE CALCULATED IMPROVEMENT BONUS. NO CAP.' : baselineMode === 'edit' ? 'CORRECT YOUR WEEK 1 BASELINE IF NEEDED.' : 'YOUR BASELINE CAN BE ENTERED ANY TIME DURING WEEK ONE.';
  document.querySelector('.baseline-form .primary-button').firstChild.textContent = retest ? 'SAVE FINAL RE-TEST ' : 'SAVE BASELINE ';
}

async function submitSetup(event) {
  event.preventDefault();
  const type = document.querySelector('[name="challengeType"]:checked')?.value;
  if (!type) return toast('CHOOSE A CHALLENGE TYPE');
  const selected = person();
  selected.startDate = CHALLENGE_START; selected.setupComplete = true; selected.challenge.type = type;
  if (type === 'run') selected.challenge.run.distance = Number($('setupRunDistanceInput').value) || 5;
  const mode = document.querySelector('[name="sessionDefinition"]:checked')?.value || 'health';
  selected.sessionDefinition = { mode, custom: $('customSessionInput').value.trim() };
  try { await savePerson(); toast('CHALLENGE SET'); renderDashboard(); setView('dashboard'); } catch { toast('SAVE FAILED — TRY AGAIN'); }
}
async function submitEntry(event) {
  event.preventDefault(); const p = person(); p.days[entryDate] = Object.fromEntries(DAY_FIELDS.map(key => [key, $(`${key}Input`).checked]));
  try { await savePerson(); toast(`${entryDate} SAVED`); renderDashboard(); loadEntry(); } catch { toast('SAVE FAILED — TRY AGAIN'); }
}
async function submitBaseline(event) {
  event.preventDefault(); const p = person(), c = p.challenge, week = challengeWeek(p), retest = baselineMode !== 'edit' && week >= 8;
  if (!retest && baselineMode !== 'edit' && week !== 1) return toast('BASELINE IS AVAILABLE IN WEEK ONE');
  if (retest) {
    if (c.type === 'strength') ['squat', 'bench', 'deadlift'].forEach(lift => { c.strength[lift].retest = Number($(`${lift}RetestInput`).value) || 0; });
    else c.run.retestPace = parsePace($('runRetestInput').value);
    if (!retestComplete(p)) return toast('COMPLETE THE FINAL RE-TEST');
    c.retestDate = todayKey();
  } else if (c.type === 'strength') {
    c.bodyweight = Number($('bodyweightInput').value) || 0; ['squat', 'bench', 'deadlift'].forEach(lift => { c.strength[lift].baseline = Number($(`${lift}BaselineInput`).value) || 0; });
    if (!baselineComplete(p)) return toast('COMPLETE YOUR BASELINE');
  } else { c.run.distance = Number($('runDistanceInput').value) || 0; c.run.baselinePace = parsePace($('runBaselineInput').value); if (!baselineComplete(p)) return toast('ADD DISTANCE AND PACE'); }
  try { await savePerson(); toast(retest ? 'FINAL RE-TEST SAVED' : baselineMode === 'edit' ? 'BASELINE UPDATED' : 'BASELINE SAVED'); baselineMode = 'auto'; renderDashboard(); setView('dashboard'); } catch { toast('SAVE FAILED — TRY AGAIN'); }
}
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(saveTimer); saveTimer = setTimeout(() => $('toast').classList.remove('show'), 1800); }

document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => { const view = button.dataset.view; if (view === 'landing') return showLanding(); if (view === 'rules') return setView('rules'); if (!person()) return showLanding(); if (!person().setupComplete) return showSetup(); setView(view); }; });
document.querySelectorAll('[data-person]').forEach(button => { button.onclick = () => selectPlayer(button.dataset.person); });
$('leaderWeek').onclick = () => { leaderboardPeriod = 'week'; renderLeaderboard(); }; $('leaderOverall').onclick = () => { leaderboardPeriod = 'overall'; renderLeaderboard(); };
$('switchPlayer').onclick = showLanding; $('baselineButton').onclick = () => { baselineMode = 'auto'; setView('baseline'); }; $('editBaseline').onclick = () => { baselineMode = 'edit'; setView('baseline'); };
$('datePrev').onclick = () => { entryDate = addDays(entryDate, -1); loadEntry(); }; $('dateNext').onclick = () => { entryDate = addDays(entryDate, 1); loadEntry(); }; $('dateToday').onclick = () => { entryDate = todayKey(); loadEntry(); }; $('entryDate').onchange = event => { entryDate = event.target.value; loadEntry(); };
$('setupForm').onsubmit = submitSetup; $('entryForm').onsubmit = submitEntry; $('baselineForm').onsubmit = submitBaseline;
document.querySelectorAll('[name="challengeType"]').forEach(input => { input.onchange = toggleSetupRun; }); document.querySelectorAll('[name="sessionDefinition"]').forEach(input => { input.onchange = toggleCustomSession; });
loadState();
