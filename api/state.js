const { readState, send } = require('./_store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  try {
    const { state } = await readState();
    return send(res, 200, state);
  } catch (error) {
    return send(res, 500, { error: 'state unavailable' });
  }
};
