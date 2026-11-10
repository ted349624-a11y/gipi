// POST /api/join  { user, wallet, ref? }  →  { ok, refs }
const { redis, validUser, validWallet, walletKey } = require('./_redis');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const user = String(body.user || '').replace(/^@/, '');
    const wallet = String(body.wallet || '').trim();
    const ref = String(body.ref || '').replace(/^@/, '');
    if (!validUser(user)) return res.status(400).json({ error: 'Invalid username' });
    if (!validWallet(wallet)) return res.status(400).json({ error: 'Invalid wallet address' });

    // At most 10 sign-ups a minute from one address.
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const hits = await redis('INCR', 'wl:rl:' + ip);
    if (hits === 1) await redis('EXPIRE', 'wl:rl:' + ip, 60);
    if (hits > 10) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });

    const id = user.toLowerCase(), wkey = walletKey(wallet);
    const existing = await redis('HGET', 'wl:users', id);
    if (existing) {
      // First sign-up wins: a username cannot be re-registered with another wallet.
      if (walletKey(JSON.parse(existing).wallet) !== wkey) return res.status(409).json({ error: 'This username is already registered.' });
    } else {
      const owner = await redis('HGET', 'wl:wallets', wkey);
      if (owner && owner !== id) return res.status(409).json({ error: 'This wallet is already registered.' });
      const refId = validUser(ref) && ref.toLowerCase() !== id ? ref.toLowerCase() : '';
      const record = JSON.stringify({ user, wallet, ref: refId, ts: Date.now() });
      const created = await redis('HSETNX', 'wl:users', id, record);
      if (created === 1) {
        await redis('HSET', 'wl:wallets', wkey, id);
        if (refId && await redis('HEXISTS', 'wl:users', refId)) await redis('HINCRBY', 'wl:refs', refId, 1);
      }
    }
    const refs = Number(await redis('HGET', 'wl:refs', id)) || 0;
    return res.status(200).json({ ok: true, refs });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.code === 'NO_DB' ? 'Database is not connected yet.' : 'Could not save. Try again.' });
  }
};
