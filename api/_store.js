const PARTICIPANTS = { ca: 'Ca', cl: 'Cl', p: 'P', g: 'G' };
const CHALLENGE_START = '2026-08-17';
const ROW_ID = 'challenge';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured');
  return { url: url.replace(/\/$/, ''), key };
}
function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function defaultState() {
  return { version: 7, participants: {} };
}
function hydrate(state) {
  const next = state && typeof state === 'object' ? state : defaultState();
  next.version = 7;
  next.participants = next.participants && typeof next.participants === 'object' ? next.participants : {};
  for (const [id, name] of Object.entries(PARTICIPANTS)) {
    const participant = next.participants[id] && typeof next.participants[id] === 'object' ? next.participants[id] : {};
    participant.name = name;
    participant.startDate = CHALLENGE_START;
    next.participants[id] = participant;
  }
  return next;
}

async function readState() {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/app_state?id=eq.${ROW_ID}&select=state`, { headers: headers(key) });
  if (!response.ok) throw new Error('Could not read challenge state');
  const rows = await response.json();
  return { exists: rows.length > 0, state: hydrate(rows[0]?.state) };
}

async function writeState(state, exists) {
  const { url, key } = config();
  // Keep the table deliberately tiny: its schema is just id + jsonb state.
  const body = JSON.stringify({ id: ROW_ID, state: hydrate(state) });
  const endpoint = exists ? `${url}/rest/v1/app_state?id=eq.${ROW_ID}` : `${url}/rest/v1/app_state`;
  const response = await fetch(endpoint, { method: exists ? 'PATCH' : 'POST', headers: { ...headers(key), Prefer: 'return=minimal' }, body });
  if (!response.ok) throw new Error('Could not save challenge state');
}

function send(res, status, payload) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

module.exports = { PARTICIPANTS, CHALLENGE_START, readState, writeState, send };
