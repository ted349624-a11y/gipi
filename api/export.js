// GET /api/export?key=ADMIN_KEY  →  CSV of every sign-up. Set ADMIN_KEY in the Vercel project settings.
const { redis } = require('./_redis');

module.exports = async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(401).send('Unauthorized');
  try {
    const [users, refs] = await Promise.all([redis('HGETALL', 'wl:users'), redis('HGETALL', 'wl:refs')]);
    const toMap = a => { const m = {}; for (let i = 0; i < (a || []).length; i += 2) m[a[i]] = a[i + 1]; return m; };
    const u = toMap(users), r = toMap(refs);
    const rows = Object.keys(u).map(id => ({ ...JSON.parse(u[id]), refs: Number(r[id]) || 0 })).sort((a, b) => a.ts - b.ts);
    const csv = ['username,wallet,referred_by,referrals,joined_at']
      .concat(rows.map(x => [x.user, x.wallet, x.ref || '', x.refs, new Date(x.ts).toISOString()].join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(csv + '\n');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Unavailable');
  }
};
