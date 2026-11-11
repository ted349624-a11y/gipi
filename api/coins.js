// GET /api/coins  →  { coins: [...] }  newest first. Payout addresses are not exposed.
const { redis } = require('./_redis');

module.exports = async (req, res) => {
  try {
    const ids = await redis('ZREVRANGE', 'gf:coins:z', 0, 199);
    const raw = ids && ids.length ? await redis('HMGET', 'gf:coins', ...ids) : [];
    const coins = raw.filter(Boolean).map(s => { const c = JSON.parse(s); return { token: c.token, name: c.name, symbol: c.symbol, description: c.description, cid: c.cid, feeBps: c.feeBps, ts: c.ts }; });
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
    return res.status(200).json({ coins, open: process.env.LAUNCH_ENABLED === '1' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unavailable', coins: [] });
  }
};
