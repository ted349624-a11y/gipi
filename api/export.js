// GET /api/export?key=ADMIN_KEY            →  table of every sign-up, readable in the browser
// GET /api/export?key=ADMIN_KEY&format=csv  →  the same as a CSV download
// Add &list=wait for the waitlist (/apply) or &list=launch for launch-code applicants.
// Set ADMIN_KEY in the Vercel project settings, then redeploy.
const { redis } = require('./_redis');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = (process.env.ADMIN_KEY || '').trim();
  const given = String(req.query.key || '').trim();
  if (!key) return res.status(401).send('ADMIN_KEY is not set on the server. Add it in Vercel (Settings > Environment Variables, Production) and redeploy.');
  if (!given) return res.status(401).send('Add your key to the address: /api/export?key=YOUR_KEY');
  if (given !== key) return res.status(401).send('Wrong key. It must match the ADMIN_KEY value in Vercel exactly.');
  if (req.query.list === 'launch') {
    try {
      const raw = await redis('HGETALL', 'gf:apply');
      const rows = []; for (let i = 0; i < (raw || []).length; i += 2) rows.push(JSON.parse(raw[i + 1]));
      rows.sort((x, y) => x.ts - y.ts);
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="giphyfun-launch-applicants.csv"');
        return res.status(200).send(['username,applied_at'].concat(rows.map(x => [x.user, new Date(x.ts).toISOString()].join(','))).join('\n') + '\n');
      }
      const k = encodeURIComponent(given);
      const body = rows.map((x, i) => `<tr><td>${i + 1}</td><td><a href="https://x.com/${esc(x.user)}" target="_blank" rel="noopener">@${esc(x.user)}</a></td><td>${new Date(x.ts).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>`).join('');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>GiphyFun launch applicants</title>
<style>body{margin:0;padding:16px;background:#050507;color:#f5f4ff;font:14px system-ui,sans-serif}h1{font-size:20px;margin:0 0 4px}p{color:#a2a3bd;margin:0 0 14px}a{color:#2bd4ff}
.s{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #26263a;white-space:nowrap}th{color:#a2a3bd;font-weight:600}</style></head>
<body><h1>Launch code applicants</h1><p>${rows.length} total (UTC times) · <a href="?key=${k}&list=launch&format=csv">Download CSV</a> · <a href="?key=${k}">Whitelist sign-ups</a></p>
<div class="s"><table><thead><tr><th>#</th><th>Username</th><th>Applied</th></tr></thead><tbody>${body || '<tr><td colspan="3">No applicants yet.</td></tr>'}</tbody></table></div></body></html>`);
    } catch (e) {
      console.error(e);
      return res.status(500).send('Database error: ' + String(e.message).slice(0, 120));
    }
  }
  try {
    const wait = req.query.list === 'wait', P = wait ? 'wait:' : 'wl:', L = wait ? '&list=wait' : '';
    const [users, refs] = await Promise.all([redis('HGETALL', P + 'users'), redis('HGETALL', P + 'refs')]);
    const toMap = a => { const m = {}; for (let i = 0; i < (a || []).length; i += 2) m[a[i]] = a[i + 1]; return m; };
    const u = toMap(users), r = toMap(refs);
    const rows = Object.keys(u).map(id => ({ ...JSON.parse(u[id]), refs: Number(r[id]) || 0 })).sort((a, b) => a.ts - b.ts);
    if (req.query.format === 'csv') {
      const csv = ['username,wallet,referred_by,referrals,joined_at']
        .concat(rows.map(x => [x.user, x.wallet, x.ref || '', x.refs, new Date(x.ts).toISOString()].join(','))).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="giphyfun-${wait ? 'waitlist' : 'whitelist'}.csv"`);
      return res.status(200).send(csv + '\n');
    }
    const body = rows.map((x, i) => `<tr><td>${i + 1}</td><td>@${esc(x.user)}</td><td class="w">${esc(x.wallet)}</td><td>${x.ref ? '@' + esc(x.ref) : ''}</td><td>${x.refs}</td><td>${new Date(x.ts).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>`).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>GiphyFun sign-ups</title>
<style>body{margin:0;padding:16px;background:#050507;color:#f5f4ff;font:14px system-ui,sans-serif}h1{font-size:20px;margin:0 0 4px}p{color:#a2a3bd;margin:0 0 14px}a{color:#2bd4ff}
.s{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #26263a;white-space:nowrap}th{color:#a2a3bd;font-weight:600}.w{font-family:ui-monospace,Menlo,monospace;font-size:12px}</style></head>
<body><h1>GiphyFun ${wait ? 'waitlist' : 'whitelist'} sign-ups</h1><p>${rows.length} total (UTC times) · <a href="?key=${encodeURIComponent(given)}${L}&format=csv">Download CSV</a> · <a href="?key=${encodeURIComponent(given)}${wait ? '' : '&list=wait'}">${wait ? 'Whitelist' : 'Waitlist'} sign-ups</a> · <a href="?key=${encodeURIComponent(given)}&list=launch">Launch code applicants</a></p>
<div class="s"><table><thead><tr><th>#</th><th>Username</th><th>Wallet</th><th>Referred by</th><th>Referrals</th><th>Joined</th></tr></thead><tbody>${body || '<tr><td colspan="6">No sign-ups yet.</td></tr>'}</tbody></table></div></body></html>`);
  } catch (e) {
    console.error(e);
    return res.status(500).send('Database error: ' + String(e.message).slice(0, 120));
  }
};
