// GET  /api/name            →  { name }   the username this browser holds, or "".
// POST /api/name { name }   →  { name }   claims a username. Names are unique and cannot be changed afterwards.
const crypto = require('crypto');
const { redis } = require('./_redis');
const { allowed } = require('./_gate');
const { validName, userOf } = require('./_user');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!allowed(req)) return res.status(401).json({ error: 'Enter the access code first.', gate: true });
  try {
    const have = await userOf(req);
    if (req.method === 'GET') return res.status(200).json({ name: have });
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (have) return res.status(200).json({ name: have });
    let b = {};
    try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch {}
    const name = String(b.name || '').trim().replace(/^@/, '');
    if (!validName(name)) return res.status(400).json({ error: 'Use 3–15 letters, numbers or _' });
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const n = await redis('INCR', 'gf:name:rl:' + ip);
    if (n === 1) await redis('EXPIRE', 'gf:name:rl:' + ip, 300);
    if (n > 15) return res.status(429).json({ error: 'Too many tries. Wait five minutes.' });
    const token = crypto.randomBytes(24).toString('hex');
    // HSETNX is the uniqueness check: only the first claim of a name succeeds.
    if ((await redis('HSETNX', 'gf:names', name.toLowerCase(), JSON.stringify({ name, ts: Date.now() }))) !== 1) return res.status(409).json({ error: 'That username is taken.' });
    await redis('HSET', 'gf:sessions', token, name);
    res.setHeader('Set-Cookie', `gf_user=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
    return res.status(200).json({ name });
  } catch (e) {
    console.error(e);
    return res.status(e.code === 'NO_DB' ? 503 : 500).json({ error: e.code === 'NO_DB' ? 'Database is not connected yet.' : 'Could not save. Try again.' });
  }
};
