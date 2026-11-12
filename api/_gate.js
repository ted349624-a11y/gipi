// /launch is open to everyone, so this gate is off unless LAUNCH_GATE=on is set in Vercel.
// The page no longer has a code screen: turning the gate back on also needs that screen restored (see git history).
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const DEFAULT_HASH = '1c97fc26317583ad7671a7e4d141c312e690ae2ddfda21cd1a4ba11db9fba066';   // hash of the current code, so the code itself is not in the repo

const expected = () => (process.env.LAUNCH_CODE ? sha(process.env.LAUNCH_CODE.trim()) : DEFAULT_HASH);
const active = () => process.env.LAUNCH_GATE === 'on';
const token = () => sha('gf-gate:' + expected());
const codeOk = code => { const a = Buffer.from(sha(String(code || '').trim())), b = Buffer.from(expected()); return crypto.timingSafeEqual(a, b); };
function allowed(req) {
  if (!active()) return true;
  const m = /(?:^|;\s*)gf_gate=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return !!m && m[1] === token();
}
module.exports = { active, allowed, codeOk, token };
