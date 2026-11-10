// Minimal Upstash Redis REST client. The Vercel ↔ Upstash integration sets these variables.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...cmd) {
  if (!URL_ || !TOKEN) throw new Error('Upstash is not configured');
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

module.exports = { redis, validUser, validWallet, walletKey };
