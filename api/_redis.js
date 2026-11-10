// Minimal Upstash Redis REST client. The Vercel ↔ Upstash integration sets these variables.
// The variable names can carry a custom prefix (e.g. STORAGE_KV_REST_API_URL), so match by ending.
const pick = (...ends) => {
  for (const end of ends) {
    const k = Object.keys(process.env).find(n => n.endsWith(end) && !n.includes('READ_ONLY') && process.env[n]);
    if (k) return process.env[k];
  }
};
const URL_ = pick('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'REDIS_REST_URL', 'REST_API_URL');
const TOKEN = pick('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'REDIS_REST_TOKEN', 'REST_API_TOKEN');
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

const validUser = u => typeof u === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(u);
const validWallet = a => typeof a === 'string' && (/^0x[a-fA-F0-9]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
// EVM addresses are case-insensitive; Solana ones are not.
const walletKey = a => (a.startsWith('0x') ? a.toLowerCase() : a);

module.exports = { redis, configured, validUser, validWallet, walletKey };
