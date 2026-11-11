// POST /api/gate { code }  →  sets the access cookie when the code is right.
const { redis } = require('./_redis');
const { codeOk, token, active } = require('./_gate');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!active()) return res.status(200).json({ ok: true });
  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const n = await redis('INCR', 'gf:gate:' + ip);
    if (n === 1) await redis('EXPIRE', 'gf:gate:' + ip, 300);
    if (n > 8) return res.status(429).json({ error: 'Too many tries. Wait five minutes.' });
  } catch {}
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!codeOk(b.code)) return res.status(401).json({ error: 'Wrong code.' });
  res.setHeader('Set-Cookie', `gf_gate=${token()}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
  return res.status(200).json({ ok: true });
};
