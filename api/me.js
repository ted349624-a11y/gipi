// GET /api/me?user=name[&list=wait]  →  { joined, refs }
const { redis, validUser } = require('./_redis');

module.exports = async (req, res) => {
  try {
    const user = String(req.query.user || '').replace(/^@/, '');
    if (!validUser(user)) return res.status(400).json({ error: 'Invalid username' });
    const id = user.toLowerCase(), P = req.query.list === 'wait' ? 'wait:' : 'wl:';
    const [joined, refs] = await Promise.all([redis('HEXISTS', P + 'users', id), redis('HGET', P + 'refs', id)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ joined: joined === 1, refs: Number(refs) || 0 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unavailable' });
  }
};
