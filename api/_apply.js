// Applications for a /launch access code.
// ROUND is bumped when everyone should apply again (a new X account, a new post): the earlier
// lists stay in the database under their own key, and the new round starts empty.
const ROUND = 3;
module.exports = { ROUND, KEY: 'gf:apply:' + ROUND };
