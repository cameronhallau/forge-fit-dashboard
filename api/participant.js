const { PARTICIPANTS, CHALLENGE_START, readState, writeState, send } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  try {
    const { id, participant } = req.body || {};
    if (!PARTICIPANTS[id] || !participant || typeof participant !== 'object') return send(res, 400, { error: 'invalid request' });
    const { state, exists } = await readState();
    participant.name = PARTICIPANTS[id];
    participant.startDate = CHALLENGE_START;
    state.participants[id] = participant;
    await writeState(state, exists);
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 500, { error: 'save unavailable' });
  }
};
