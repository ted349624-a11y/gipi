// GET /api/coins  →  { coins, open, ethUsd }  newest first, with live market numbers. Payout addresses are not exposed.
const { redis, pipeline } = require('./_redis');
const { market } = require('./_pons');
const { allowed, active } = require('./_gate');

const DAY = 86400000, SNAP_EVERY = 600000;

async function ethUsd() {
  const c = await redis('GET', 'gf:ethusd'); if (c) return Number(c);
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot'); const j = await r.json();
    const p = Number(j.data.amount);
    if (p > 0) { await redis('SET', 'gf:ethusd', String(p), 'EX', 120); return p; }
  } catch {}
  return 0;
}

module.exports = async (req, res) => {
  if (!allowed(req)) { res.setHeader('Cache-Control', 'no-store'); return res.status(401).json({ error: 'Tasks required', gate: true }); }
  try {
    res.setHeader('Cache-Control', active() ? 'private, no-store' : 's-maxage=10, stale-while-revalidate=30');
    const cached = await redis('GET', 'gf:coins:cache');
    if (cached) { res.setHeader('Content-Type', 'application/json'); return res.status(200).send(cached); }

    const ids = await redis('ZREVRANGE', 'gf:coins:z', 0, 99);
    const raw = ids && ids.length ? await redis('HMGET', 'gf:coins', ...ids) : [];
    const all = raw.filter(Boolean).map(s => JSON.parse(s));
    const [m, usd] = await Promise.all([market(all).catch(() => ({})), ethUsd()]);

    // Price history: one snapshot per coin every 10 minutes, kept for a day, to show the change.
    const now = Date.now(), live = all.filter(c => m[c.token.toLowerCase()]);
    const hist = await pipeline(live.flatMap(c => { const k = 'gf:px:' + c.token.toLowerCase(); return [['ZRANGEBYSCORE', k, now - DAY, '+inf', 'LIMIT', 0, 1], ['ZREVRANGE', k, 0, 0]]; }));
    const writes = [];
    live.forEach((c, i) => {
      const id = c.token.toLowerCase(), x = m[id], oldest = (hist[i * 2] || [])[0], newest = (hist[i * 2 + 1] || [])[0];
      const base = oldest ? Number(oldest.split(':')[1]) : 0;
      x.chg = base > 0 ? (x.priceEth / base - 1) * 100 : 0;
      if (!newest || now - Number(newest.split(':')[0]) > SNAP_EVERY) writes.push(['ZADD', 'gf:px:' + id, now, now + ':' + x.priceEth], ['ZREMRANGEBYSCORE', 'gf:px:' + id, 0, now - DAY - 3600000]);
    });
    if (writes.length) await pipeline(writes);

    const coins = all.map(c => {
      const x = m[c.token.toLowerCase()] || {};
      return { token: c.token, name: c.name, symbol: c.symbol, description: c.description, cid: c.cid, feeBps: c.feeBps, ts: c.ts,
        priceEth: x.priceEth ?? null, mcapEth: x.mcapEth ?? null, mcapUsd: x.mcapEth != null && usd ? x.mcapEth * usd : null, chg: x.chg ?? null, prog: x.prog ?? null, grad: !!x.grad };
    });
    const body = JSON.stringify({ coins, open: process.env.LAUNCH_ENABLED === '1', ethUsd: usd });
    await redis('SET', 'gf:coins:cache', body, 'EX', 20);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(body);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unavailable', coins: [] });
  }
};
