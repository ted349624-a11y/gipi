// GET /api/coins  →  { coins, open, ethUsd }  newest first, with live market numbers and the founder's username. Payout addresses and fees are not exposed.
//
// Kept cheap on the database (the free Upstash plan is 500K commands a month, and the old version used it up in a day):
// - the CDN answers most requests, so the function rarely runs;
// - a 60 s response cache answers most of the rest with one command;
// - a full refresh costs about eight commands however many coins there are: the price history is one hash
//   (one JSON array per coin, one sample an hour) and the last good numbers are another, each read and written whole.
const { redis, pipeline } = require('./_redis');
const { market } = require('./_pons');
const { allowed, active } = require('./_gate');

const HOUR = 3600000, DAY = 24 * HOUR, TTL = 60;
const toMap = a => { const m = {}; for (let i = 0; i < (a || []).length; i += 2) m[a[i]] = a[i + 1]; return m; };

async function fetchUsd() {
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot'); const j = await r.json();
    const p = Number(j.data.amount); return p > 0 ? p : 0;
  } catch { return 0; }
}

// One time: carry the 24 h history over from the old per-coin keys (gf:px:<token>), so the change column stays right.
async function migrate(ids, now) {
  const old = await pipeline(ids.map(id => ['ZRANGEBYSCORE', 'gf:px:' + id, now - DAY - HOUR, '+inf'])).catch(() => []);
  const out = {};
  ids.forEach((id, i) => {
    const h = [];
    for (const s of old[i] || []) {
      const [t, p] = String(s).split(':').map(Number);
      if (t && p > 0 && (!h.length || t - h[h.length - 1][0] >= HOUR)) h.push([t, p]);
    }
    if (h.length) out[id] = JSON.stringify(h);
  });
  return out;
}

module.exports = async (req, res) => {
  if (!allowed(req)) { res.setHeader('Cache-Control', 'no-store'); return res.status(401).json({ error: 'Code required', gate: true }); }
  const send = body => { res.setHeader('Content-Type', 'application/json'); return res.status(200).send(body); };
  try {
    res.setHeader('Cache-Control', active() ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=120');
    const cached = await redis('GET', 'gf:coins:cache');
    if (cached) return send(cached);

    const now = Date.now();
    const [ids = [], usdCached, histRaw] = await pipeline([['ZREVRANGE', 'gf:coins:z', 0, 99], ['GET', 'gf:ethusd'], ['HGETALL', 'gf:hist']]);
    const raw = ids.length ? await redis('HMGET', 'gf:coins', ...ids) : [];
    const all = raw.filter(Boolean).map(s => JSON.parse(s));
    let usd = Number(usdCached) || 0;
    const [m, freshUsd] = await Promise.all([market(all).catch(() => ({})), usd ? 0 : fetchUsd()]);
    if (freshUsd) usd = freshUsd;

    // Coins whose read failed show their last good numbers instead of a dash (one command, only when needed).
    const missing = all.map(c => c.token.toLowerCase()).filter(id => !m[id]);
    if (missing.length) {
      const old = await redis('HMGET', 'gf:mk', ...missing).catch(() => []);
      missing.forEach((id, i) => { if (old && old[i]) m[id] = { ...JSON.parse(old[i]), stale: true }; });
    }

    // 24 h change from an hourly sample per coin.
    let hist = toMap(histRaw);
    const liveIds = all.map(c => c.token.toLowerCase()).filter(id => m[id] && !m[id].stale);
    if (!Object.keys(hist).length && liveIds.length) hist = await migrate(liveIds, now);
    const histWrites = [];
    for (const id of liveIds) {
      const x = m[id];
      let h = []; try { h = JSON.parse(hist[id] || '[]'); } catch {}
      h = h.filter(([t]) => now - t <= DAY + HOUR);
      const base = h.find(([t]) => now - t <= DAY);
      x.chg = base && base[1] > 0 ? (x.priceEth / base[1] - 1) * 100 : 0;
      if (!h.length || now - h[h.length - 1][0] >= HOUR) { h.push([now, x.priceEth]); histWrites.push(id, JSON.stringify(h)); }
    }

    // The one official coin: the first $GIPHY launched by the GIPHY username (usernames are unique, so nobody else can match).
    // OFFICIAL_TOKENS (comma-separated contract addresses) overrides this.
    const env = (process.env.OFFICIAL_TOKENS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const first = all.filter(c => String(c.founder || '').toLowerCase() === 'giphy' && c.symbol === 'GIPHY').sort((a, b) => a.ts - b.ts)[0];
    const official = new Set(env.length ? env : first ? [first.token.toLowerCase()] : []);

    const coins = all.map(c => {
      const x = m[c.token.toLowerCase()] || {};
      return { token: c.token, name: c.name, symbol: c.symbol, description: c.description, cid: c.cid, founder: c.founder || '', official: official.has(c.token.toLowerCase()), ts: c.ts,
        priceEth: x.priceEth ?? null, mcapEth: x.mcapEth ?? null, mcapUsd: x.mcapEth != null && usd ? x.mcapEth * usd : null, chg: x.chg ?? null, prog: x.prog ?? null, grad: !!x.grad };
    });
    const body = JSON.stringify({ coins, open: process.env.LAUNCH_ENABLED === '1', ethUsd: usd });

    // Every write in one round trip.
    const writes = [['SET', 'gf:coins:cache', body, 'EX', TTL]];
    if (liveIds.length) writes.push(['HSET', 'gf:mk', ...liveIds.flatMap(id => { const x = m[id]; return [id, JSON.stringify({ priceEth: x.priceEth, mcapEth: x.mcapEth, prog: x.prog, grad: x.grad, chg: x.chg })]; })]);
    if (histWrites.length) writes.push(['HSET', 'gf:hist', ...histWrites]);
    if (freshUsd) writes.push(['SET', 'gf:ethusd', String(freshUsd), 'EX', 300]);
    await pipeline(writes).catch(e => console.error(e));
    return send(body);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unavailable', coins: [] });
  }
};
