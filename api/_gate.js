// Access code for /launch. Set LAUNCH_CODE in Vercel to change the code; set LAUNCH_GATE=off to open the page to everyone.
// People apply for a code by doing the X tasks (apply.js); codes are handed out by hand.
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const DEFAULT_HASH = '1c97fc26317583ad7671a7e4d141c312e690ae2ddfda21cd1a4ba11db9fba066';   // hash of the current code, so the code itself is not in the repo

const expected = () => (process.env.LAUNCH_CODE ? sha(process.env.LAUNCH_CODE.trim()) : DEFAULT_HASH);
const active = () => process.env.LAUNCH_GATE !== 'off';
const token = () => sha('gf-gate:' + expected());
const codeOk = code => { const a = Buffer.from(sha(String(code || '').trim())), b = Buffer.from(expected()); return crypto.timingSafeEqual(a, b); };
function allowed(req) {
  if (!active()) return true;
  const m = /(?:^|;\s*)gf_gate=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return !!m && m[1] === token();
}
module.exports = { active, allowed, codeOk, token };
