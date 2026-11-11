// POST /api/apply { user, tasks: [...] }  →  records an X username as an applicant for a /launch access code.
// X gives no way to check a follow or a like from here; the list is for picking winners by hand. See /api/export?list=launch.
const { redis, validUser } = require('./_redis');
const TASKS = ['follow', 'bell', 'like', 'rt', 'reply'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch {}
  const user = String(b.user || '').trim().replace(/^@/, '');
  if (!validUser(user)) return res.status(400).json({ error: 'Check your X username.' });
  const done = Array.isArray(b.tasks) ? b.tasks : [];
  if (!TASKS.every(t => done.includes(t))) return res.status(400).json({ error: 'Finish the tasks first.' });
  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const n = await redis('INCR', 'gf:apply:rl:' + ip);
    if (n === 1) await redis('EXPIRE', 'gf:apply:rl:' + ip, 60);
    if (n > 10) return res.status(429).json({ error: 'Too many tries. Wait a minute.' });
    await redis('HSETNX', 'gf:apply', user.toLowerCase(), JSON.stringify({ user, ts: Date.now() }));
    return res.status(200).json({ ok: true });
  } catch (e) {
    if (e.code === 'NO_DB') return res.status(503).json({ error: 'Database is not connected yet.' });
    console.error(e);
    return res.status(500).json({ error: 'Could not save. Try again.' });
  }
};
