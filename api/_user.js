// Launchpad usernames. A name is claimed once, is unique (case-insensitive), and stays with the browser through a random
// session cookie: the cookie holds only a token, the name is looked up on the server, so a name cannot be faked.
const { redis } = require('./_redis');
const validName = n => /^[A-Za-z0-9_]{3,15}$/.test(n);
const sessionOf = req => (/(?:^|;\s*)gf_user=([a-f0-9]{48})/.exec(req.headers.cookie || '') || [])[1] || '';
async function userOf(req) {
  const t = sessionOf(req);
  return t ? (await redis('HGET', 'gf:sessions', t)) || '' : '';
}
module.exports = { validName, userOf };
