// GET /api/probe?key=ADMIN_KEY  →  checks everything the launcher needs, without sending a transaction.
const { template, walletInfo, market, launch, FACTORY, RPC } = require('./_pons');
const { redis } = require('./_redis');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = (process.env.ADMIN_KEY || '').trim();
  if (!key || String(req.query.key || '').trim() !== key) return res.status(401).send('Unauthorized');
  const out = { factory: FACTORY, rpc: RPC, launchEnabled: process.env.LAUNCH_ENABLED === '1', pinataSet: !!process.env.PINATA_JWT, privateKeySet: !!process.env.LAUNCH_PRIVATE_KEY };
  try { out.wallet = await walletInfo(); } catch (e) { out.walletError = String(e.message).slice(0, 160); }
  try { out.template = await template(true); } catch (e) { out.templateError = String(e.message).slice(0, 200); }
  // A full launch up to the last step before sending: says whether a real launch would go through right now.
  try { out.dryRun = await launch({ name: 'Probe', symbol: 'PROBE', logo: 'ipfs://probe', description: '', creatorTaxBps: 100 }, true); out.dryRun.ok = true; }
  catch (e) { out.dryRun = { ok: false, code: e.code || 'ERROR', error: String(e.message).slice(0, 220) }; }
  if (process.env.PINATA_JWT) {
    try { const r = await fetch('https://api.pinata.cloud/data/testAuthentication', { headers: { Authorization: 'Bearer ' + process.env.PINATA_JWT } }); out.pinata = r.ok ? 'ok' : 'rejected (' + r.status + ')'; }
    catch (e) { out.pinata = 'unreachable'; }
  }
  // Market data: how many coins' prices could be read from the chain just now.
  try {
    const ids = await redis('ZREVRANGE', 'gf:coins:z', 0, 99);
    const raw = ids && ids.length ? await redis('HMGET', 'gf:coins', ...ids) : [];
    const report = {}; await market(raw.filter(Boolean).map(x => JSON.parse(x)), report); out.market = report;
  } catch (e) { out.marketError = String(e.message).slice(0, 200); }
  return res.status(200).json(out);
};
