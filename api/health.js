// GET /api/health  →  whether the database variables exist and Redis answers. Shows no secrets.
const { redis, configured } = require('./_redis');

module.exports = async (req, res) => {
  const c = configured();
  let ping = false, error = '';
  if (c.url && c.token) { try { ping = (await redis('PING')) === 'PONG'; } catch (e) { error = String(e.message).slice(0, 120); } }
  const names = Object.keys(process.env).filter(n => /REDIS|KV_|UPSTASH/.test(n)).sort();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ urlFound: c.url, tokenFound: c.token, redisAnswers: ping, error, variableNames: names, adminKeySet: !!process.env.ADMIN_KEY });
};
