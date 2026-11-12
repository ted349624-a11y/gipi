// GET /api/probe?key=ADMIN_KEY  →  checks everything the launcher needs, without sending a transaction.
const { template, walletInfo, market, FACTORY, RPC } = require('./_pons');
const { redis } = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = (process.env.ADMIN_KEY || '').trim();
  if (!key || String(req.query.key || '').trim() !== key) return res.status(401).send('Unauthorized');
  const out = { factory: FACTORY, rpc: RPC, launchEnabled: process.env.LAUNCH_ENABLED === '1', pinataSet: !!process.env.PINATA_JWT, privateKeySet: !!process.env.LAUNCH_PRIVATE_KEY };
  try { out.wallet = await walletInfo(); } catch (e) { out.walletError = String(e.message).slice(0, 160); }
  try { out.template = await template(true); } catch (e) { out.templateError = String(e.message).slice(0, 200); }
  // Market data: how many coins' prices could be read from the chain just now.
  try {
    const ids = await redis('ZREVRANGE', 'gf:coins:z', 0, 99);
    const raw = ids && ids.length ? await redis('HMGET', 'gf:coins', ...ids) : [];
    const report = {}; await market(raw.filter(Boolean).map(x => JSON.parse(x)), report); out.market = report;
  } catch (e) { out.marketError = String(e.message).slice(0, 200); }
  return res.status(200).json(out);
};
