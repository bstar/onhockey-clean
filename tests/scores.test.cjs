const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScores, createScoreFetcher } = require('../lib/scores.cjs');
const fixture = { games: [{ id: 1, gameState: 'LIVE', gameScheduleState: 'OK', awayTeam: { name: { default: 'Bruins' }, abbrev: 'BOS', score: 0, sog: 0 }, homeTeam: { name: { default: 'Canadiens' }, abbrev: 'MTL', score: 2, sog: 12 }, periodDescriptor: { number: 2, periodType: 'REG' }, clock: { timeRemaining: '08:12', inIntermission: false }, tvBroadcasts: [{ network: 'NESN' }, { network: 'NESN' }] }] };
test('score data preserves zero goals and shots, clock and deduplicated broadcasts', () => {
  const [game] = normalizeScores(fixture);
  assert.equal(game.away.score, 0); assert.equal(game.away.shots, 0);
  assert.equal(game.home.score, 2); assert.equal(game.clock, '08:12');
  assert.deepEqual(game.broadcasts, ['NESN']);
  const [future] = normalizeScores({ games: [{ awayTeam: {}, homeTeam: {} }] });
  assert.equal(future.away.score, null); assert.equal(future.home.shots, null);
  assert.throws(() => normalizeScores({}), /Invalid score/);
});
test('score fetch validates dates and retains only same-date data on failure', async () => {
  let fail = false; let requested;
  const scores = createScoreFetcher(async url => { if (!url.includes('/standings/')) requested = url; if (fail) throw new Error('offline'); return { ok: true, json: async () => fixture }; });
  for (const date of ['../../other', '2026-02-30', '2026-13-01', undefined]) await assert.rejects(() => scores(date), /Invalid score date/);
  const result = await scores('2026-11-12');
  assert.equal(requested, 'https://api-web.nhle.com/v1/score/2026-11-12');
  assert.equal(result.stale, false); fail = true;
  const cached = await scores('2026-11-12');
  assert.equal(cached.stale, true); assert.equal(cached.fetchedAt, result.fetchedAt);
  await assert.rejects(() => scores('2026-11-13'), /Scores unavailable/);
});

test('Live mode requests the NHL current game day without cached HTTP responses', async () => {
  let requested, options;
  const scores = createScoreFetcher(async (url, init) => {
    if (!url.includes('/standings/')) { requested = url; options = init; }
    return { ok: true, json: async () => ({ ...fixture, currentDate: '2026-11-11' }) };
  });
  const result = await scores('now');
  assert.equal(requested, 'https://api-web.nhle.com/v1/score/now');
  assert.equal(result.date, '2026-11-11');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['Cache-Control'], 'no-cache');
});

test('team records preserve zero overtime losses, cache standings, and do not break scores on standings errors', async () => {
  let standingRequests = 0;
  const scores = createScoreFetcher(async url => {
    if (url.includes('/standings/')) {
      standingRequests++;
      return { ok: true, json: async () => ({ standings: [{ teamAbbrev: { default: 'BOS' }, wins: 10, losses: 3, otLosses: 0, date: '2026-11-11' }] }) };
    }
    return { ok: true, json: async () => fixture };
  });
  const first = await scores('now');
  assert.deepEqual(first.games[0].away.record, { wins: 10, losses: 3, otLosses: 0, date: '2026-11-11' });
  assert.equal(first.games[0].home.record, null);
  await scores('now'); assert.equal(standingRequests, 1);
  const offlineStandings = createScoreFetcher(async url => {
    if (url.includes('/standings/')) throw new Error('Standings offline');
    return { ok: true, json: async () => fixture };
  });
  assert.equal((await offlineStandings('now')).games[0].away.score, 0);
});
