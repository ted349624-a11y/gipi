// Launchpad usernames. A name is claimed once, is unique (case-insensitive), and stays with the browser through a random
// session token: the token carries no name, the name is looked up on the server, so a name cannot be faked.
// The token travels in a cookie and, because browsers drop cookies for reasons of their own, also in a header the
// page keeps in local storage. Either one identifies the same session.
const { redis } = require('./_redis');
const validName = n => /^[A-Za-z0-9_]{3,15}$/.test(n);
const TOKEN = /^[a-f0-9]{48}$/;
const sessionOf = req => {
  const h = String(req.headers['x-gf-session'] || '').trim();
  if (TOKEN.test(h)) return h;
  return (/(?:^|;\s*)gf_user=([a-f0-9]{48})/.exec(req.headers.cookie || '') || [])[1] || '';
};
async function userOf(req) {
  const t = sessionOf(req);
  return t ? (await redis('HGET', 'gf:sessions', t)) || '' : '';
}
module.exports = { validName, userOf };
