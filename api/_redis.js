// Database client. Two kinds of connection, same commands and same results:
// - a plain Redis connection string (redis:// or rediss://), as Redis Cloud and other Marketplace Redis providers set
//   it (REDIS_URL, possibly with a prefix). Used first when present.
// - the Upstash REST API (URL + token), as the Vercel <-> Upstash integration sets it.
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
// A Redis connection string, found by the end of the variable name so a custom prefix still works.
const TCP_URL = (() => {
  const k = Object.keys(process.env).find(n => /REDIS_URL$/.test(n) && /^rediss?:\/\//.test(process.env[n] || ''));
  return k ? process.env[k] : '';
})();
const MODE = TCP_URL ? 'redis' : URL_ && TOKEN ? 'upstash-rest' : 'none';
const configured = () => ({ url: MODE !== 'none', token: MODE !== 'none', mode: MODE });

// One connection per warm function instance, opened on first use and reused after.
let client = null, connecting = null;
async function tcp() {
  if (client && client.isReady) return client;
  if (connecting) return connecting;
  const { createClient } = require('redis');
  const c = createClient({ url: TCP_URL, socket: { connectTimeout: 5000, reconnectStrategy: n => (n > 2 ? false : 200) } });
  c.on('error', e => console.error('redis:', e.message));
  connecting = c.connect().then(() => { client = c; connecting = null; return c; }, e => { connecting = null; throw e; });
  return connecting;
}
const noDb = () => { const e = new Error('Database is not connected'); e.code = 'NO_DB'; return e; };
// Redis wants every argument as a string.
const args = cmd => cmd.map(x => (typeof x === 'string' ? x : String(x)));

async function redis(...cmd) {
  if (MODE === 'redis') return (await tcp()).sendCommand(args(cmd));
  if (MODE === 'none') throw noDb();
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
  if (MODE === 'redis') {
    // Sent together, so they travel as one batch; a failed command gives undefined in its place, like the REST pipeline.
    const c = await tcp();
    return (await Promise.allSettled(cmds.map(x => c.sendCommand(args(x))))).map(r => (r.status === 'fulfilled' ? r.value : undefined));
  }
  if (MODE === 'none') throw noDb();
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
