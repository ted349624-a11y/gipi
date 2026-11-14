// Minimal Upstash Redis REST client. The Vercel ↔ Upstash integration sets these variables.
// The variable names can carry a custom prefix (e.g. STORAGE_KV_REST_API_URL), so match by ending.
// URL and token are taken from the same prefix, so two connected databases can never be mixed into one broken pair.
// With more than one connected, the first found is used: disconnect the old one in Vercel when switching.
const PAIRS = [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
               ['REDIS_REST_URL', 'REDIS_REST_TOKEN'], ['REST_API_URL', 'REST_API_TOKEN']];
let URL_, TOKEN;
for (const [u, t] of PAIRS) {
  const k = Object.keys(process.env).find(n => n.endsWith(u) && !n.includes('READ_ONLY') && process.env[n]);
  if (!k) continue;
  const tk = k.slice(0, k.length - u.length) + t;
  if (process.env[tk]) { URL_ = process.env[k]; TOKEN = process.env[tk]; break; }
}
const configured = () => ({ url: !!URL_, token: !!TOKEN });

async function redis(...cmd) {
  if (!URL_ || !TOKEN) { const e = new Error('Database is not connected'); e.code = 'NO_DB'; throw e; }
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'Redis error ' + r.status);
  return j.result;
}

// Several commands in one round trip. Returns the results in order.
async function pipeline(cmds) {
  if (!cmds.length) return [];
  if (!URL_ || !TOKEN) { const e = new Error('Database is not connected'); e.code = 'NO_DB'; throw e; }
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds)
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j)) throw new Error('Redis pipeline error ' + r.status);
  return j.map(x => x.result);
}

const validUser = u => typeof u === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(u);
const validWallet = a => typeof a === 'string' && (/^0x[a-fA-F0-9]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
// EVM addresses are case-insensitive; Solana ones are not.
const walletKey = a => (a.startsWith('0x') ? a.toLowerCase() : a);

module.exports = { redis, pipeline, configured, validUser, validWallet, walletKey };
