// POST /api/gate { tasks: [...] }  →  sets the access cookie once every X task is marked done.
// X gives no way to check a follow or a like from here, so this trusts the visitor, like the whitelist does.
const { redis } = require('./_redis');
const { token, active } = require('./_gate');
const TASKS = ['follow', 'bell', 'like', 'rt', 'reply'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!active()) return res.status(200).json({ ok: true });
  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const n = await redis('INCR', 'gf:gate:' + ip);
    if (n === 1) await redis('EXPIRE', 'gf:gate:' + ip, 300);
    if (n > 20) return res.status(429).json({ error: 'Too many tries. Wait five minutes.' });
  } catch {}
  let b = {};
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch {}
  const done = Array.isArray(b.tasks) ? b.tasks : [];
  if (!TASKS.every(t => done.includes(t))) return res.status(401).json({ error: 'Finish the tasks first.' });
  res.setHeader('Set-Cookie', `gf_gate=${token()}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
  return res.status(200).json({ ok: true });
};
