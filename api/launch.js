// POST /api/launch  { name, symbol, description, feePct, payout, gif (base64) }  →  { ok, token, tx, url }
// The launch is made under the caller's username (see name.js), which is stored on the coin as its founder. One launch per username per hour.
// Pins the GIF to IPFS, then launches the coin on Pons from the site wallet with no opening buy.
const { redis } = require('./_redis');
const { launch } = require('./_pons');
const { allowed } = require('./_gate');
const { userOf } = require('./_user');

const MAX_GIF = 3 * 1024 * 1024;
const day = () => new Date().toISOString().slice(0, 10);
const bad = (res, code, error) => res.status(code).json({ error });

async function pin(buf, name) {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) { const e = new Error('GIF storage is not configured'); e.code = 'NO_PIN'; throw e; }
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/gif' }), name + '.gif');
  const r = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.IpfsHash) throw new Error('Could not store the GIF');
  return j.IpfsHash;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 405, 'POST only');
  if (!allowed(req)) return bad(res, 401, 'Enter the access code first.');
  if (process.env.LAUNCH_ENABLED !== '1') return bad(res, 503, 'Launching is not open yet.');
  let locked = false;
  try {
    const founder = await userOf(req);
    if (!founder) return bad(res, 401, 'Pick a username first.');
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const symbol = String(b.symbol || '').trim().toUpperCase();
    const description = String(b.description || '').trim().slice(0, 280);
    const feePct = Number(b.feePct);
    const payout = String(b.payout || '').trim();
    if (name.length < 2 || name.length > 32) return bad(res, 400, 'Name must be 2 to 32 characters.');
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) return bad(res, 400, 'Ticker must be 2 to 10 letters or numbers.');
    if (!(feePct >= 0 && feePct <= 9)) return bad(res, 400, 'Creator fee must be between 0 and 9%.');
    if (!/^0x[a-fA-F0-9]{40}$/.test(payout)) return bad(res, 400, 'Enter a valid Robinhood wallet address (0x…).');
    const buf = Buffer.from(String(b.gif || '').replace(/^data:image\/gif;base64,/, ''), 'base64');
    const magic = buf.subarray(0, 6).toString('latin1');
    if (magic !== 'GIF89a' && magic !== 'GIF87a') return bad(res, 400, 'Only GIF files are accepted.');
    if (buf.length > MAX_GIF) return bad(res, 400, 'The GIF must be 3 MB or smaller.');

    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const cap = Number(process.env.LAUNCH_DAILY_CAP || 50);
    const kUser = 'gf:launch:u:' + founder.toLowerCase(), kIp = 'gf:launch:iph:' + ip, kDay = 'gf:launch:day:' + day();
    const [tUser, tIp, nDay] = await Promise.all([redis('TTL', kUser), redis('TTL', kIp), redis('GET', kDay)]);
    const wait = Math.max(Number(tUser) || 0, Number(tIp) || 0);
    if (wait > 0) return bad(res, 429, 'You can launch one coin per hour. Try again in ' + Math.ceil(wait / 60) + ' min.');
    if (Number(nDay) >= cap) return bad(res, 429, 'Today’s launch limit is reached. Try again tomorrow.');

    // One launch at a time, so two requests never share a wallet nonce.
    locked = (await redis('SET', 'gf:launch:lock', '1', 'NX', 'EX', 90)) === 'OK';
    if (!locked) return bad(res, 409, 'Another launch is in progress. Try again in a minute.');

    const cid = await pin(buf, symbol);
    const out = await launch({ name, symbol, logo: 'ipfs://' + cid, description, creatorTaxBps: Math.round(feePct * 100) });

    const coin = { token: out.token, curve: out.curve, tx: out.hash, confirmed: out.confirmed, name, symbol, description, cid, feeBps: Math.round(feePct * 100), payout, founder, ts: Date.now() };
    const id = out.token.toLowerCase();
    await redis('HSET', 'gf:coins', id, JSON.stringify(coin));
    await redis('ZADD', 'gf:coins:z', coin.ts, id);
    await redis('DEL', 'gf:coins:cache');
    await redis('SET', kUser, '1', 'EX', 3600); await redis('SET', kIp, '1', 'EX', 3600);
    await redis('INCR', kDay); await redis('EXPIRE', kDay, 90000);
    return res.status(200).json({ ok: true, token: out.token, tx: out.hash, confirmed: out.confirmed, url: 'https://ponsfamily.com/launchpad/' + out.token });
  } catch (e) {
    console.error(e);
    const known = { NO_KEY: 'Launching is not set up yet.', NO_PIN: 'Launching is not set up yet.', NO_DB: 'Launching is not set up yet.' }[e.code];
    return bad(res, e.code === 'SIM' ? 422 : 500, known || (e.code === 'SIM' || e.code === 'TX' ? e.message : 'Could not launch. Nothing was created. Try again.'));
  } finally {
    if (locked) await redis('DEL', 'gf:launch:lock').catch(() => {});
  }
};
