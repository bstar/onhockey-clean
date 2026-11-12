function normalizeScores(data) {
  if (!Array.isArray(data.games)) throw new Error('Invalid score response');
  const team = value => ({ name: value?.name?.default || value?.abbrev || 'TBD', abbreviation: value?.abbrev || '', score: Number.isInteger(value?.score) ? value.score : null, shots: Number.isInteger(value?.sog) ? value.sog : null });
  return data.games.map(game => ({
    id: game.id, date: game.gameDate, start: game.startTimeUTC,
    state: game.gameState, scheduleState: game.gameScheduleState,
    away: team(game.awayTeam), home: team(game.homeTeam),
    period: game.periodDescriptor?.number, periodType: game.periodDescriptor?.periodType,
    clock: game.clock?.timeRemaining, intermission: Boolean(game.clock?.inIntermission),
    venue: game.venue?.default || '',
    broadcasts: [...new Set((game.tvBroadcasts || []).map(b => b.network).filter(Boolean))],
  }));
}
function createScoreFetcher(fetcher = fetch) {
  const cache = new Map();
  let records = new Map(), recordsAttempt = 0, recordsInFlight;
  async function teamRecords() {
    if (recordsInFlight) return recordsInFlight;
    if (Date.now() - recordsAttempt < 300000) return records;
    recordsAttempt = Date.now();
    recordsInFlight = (async () => {
      try {
        const response = await fetcher('https://api-web.nhle.com/v1/standings/now', { signal: AbortSignal.timeout(4000), cache: 'no-store' });
        if (!response.ok) return records;
        const data = await response.json();
        if (!Array.isArray(data.standings)) return records;
        records = new Map(data.standings.filter(team => [team.wins, team.losses, team.otLosses].every(value => Number.isInteger(value) && value >= 0)).map(team => [team.teamAbbrev?.default, { wins: team.wins, losses: team.losses, otLosses: team.otLosses, date: team.date }]));
      } catch {}
      return records;
    })().finally(() => { recordsInFlight = null; });
    return recordsInFlight;
  }
  return async date => {
    if (date !== 'now' && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Invalid score date');
    try {
      const response = await fetcher(`https://api-web.nhle.com/v1/score/${date}`, { signal: AbortSignal.timeout(12000), cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error(`Score server returned HTTP ${response.status}`);
      const data = await response.json();
      const standings = await teamRecords();
      const games = normalizeScores(data);
      for (const game of games) for (const team of [game.away, game.home]) team.record = standings.get(team.abbreviation) || null;
      const result = { date: data.currentDate, games, fetchedAt: new Date().toISOString(), stale: false };
      cache.delete(date); cache.set(date, result);
      if (cache.size > 14) cache.delete(cache.keys().next().value);
      return result;
    } catch (error) {
      if (cache.has(date)) return { ...cache.get(date), stale: true };
      throw new Error(`Scores unavailable. ${error.message}`);
    }
  };
}
module.exports = { normalizeScores, createScoreFetcher };
