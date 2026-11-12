const $ = id => document.getElementById(id);
const api = window.hockey;
const state = { games: [], tab: 'nhl', league: '', selected: null, source: 0, pending: false, fetching: false, refreshing: false, updatedAt: null };
const profiles = new Map();
let profileContext = '';
const labels = { nhl: 'NHL', international: 'International', other: 'Other leagues' };
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(message) { $('notice').hidden = !message; $('notice').textContent = message || ''; }
function localTime(utc) {
  if (!/^\d{1,2}:\d{2}$/.test(utc)) return 'TBD';
  const [hour, minute] = utc.split(':').map(Number);
  const date = new Date();
  date.setUTCHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}
function tabChanged(tab) {
  state.tab = tab; state.league = '';
  document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $('schedule-title').firstChild.textContent = `${labels[tab]} schedule `;
  $('search').value = '';
  renderGames();
}
function renderGames() {
  for (const category of Object.keys(labels)) $(category + '-count').textContent = state.games.filter(g => g.category === category).length;
  const categoryGames = state.games.filter(game => game.category === state.tab);
  const leagues = [...new Set(categoryGames.map(g => g.league))].sort();
  $('league-filters').replaceChildren();
  $('league-filters').hidden = state.tab === 'nhl' || !leagues.length;
  for (const name of ['', ...leagues]) {
    const button = el('button', name === state.league ? 'active' : '', name || 'All leagues');
    button.addEventListener('click', () => { state.league = name; renderGames(); });
    $('league-filters').append(button);
  }
  const query = $('search').value.trim().toLowerCase();
  const games = categoryGames.filter(g => (!state.league || g.league === state.league) && (!query || `${g.title} ${g.league}`.toLowerCase().includes(query)) && (!$('available').checked || g.sources.length));
  const profileGames = [...new Map([...(state.selected ? [state.selected] : []), ...games.filter(game => game.sources.length)].map(game => [game.id, game])).values()].slice(0, 3);
  const context = profileGames.map(game => game.id + ':' + game.sources.map(source => source.url).join(',')).join('|');
  if (context !== profileContext && api.profile) {
    profileContext = context;
    api.profile(profileGames.map(game => game.id)).then(result => {
      for (const [url, value] of Object.entries(result)) profiles.set(url, value);
      renderHealth();
    }).catch(() => {});
  }
  $('game-count').textContent = games.length;
  $('games').replaceChildren();
  if (!games.length) {
    const empty = el('div', 'empty-state');
    const filtered = query || state.league || $('available').checked;
    empty.append(el('h3', '', filtered ? 'No games match these filters.' : `No ${labels[state.tab]} games listed right now.`));

    if (state.tab === 'nhl' && !filtered) {
      const button = el('button', 'button', 'Explore other leagues →');
      button.addEventListener('click', () => tabChanged('other')); empty.append(button);
    }
    $('games').append(empty);
  }
  for (const game of games) {
    const row = el('article', `game${state.selected?.id === game.id ? ' selected' : ''}`);
    const match = el('div', 'match');
    const initials = game.title.split(' - ')[0].split(' ').map(t => t[0]).join('').slice(0, 3).toUpperCase();
    const badge = el('span', 'team-badge', initials); badge.setAttribute('aria-hidden', 'true');
    const text = el('div'); text.append(el('h3', '', game.title), el('small', '', game.league));
    if (game.sources.length) {
      const health = el('small', 'game-health'); health.dataset.game = game.id; text.append(health);
    }
    match.append(badge, text);
    const time = el('time', '', localTime(game.utcTime)); time.title = `${game.utcTime} UTC · listed start time`;
    const button = el('button', 'watch', game.sources.length ? 'Watch  ▷' : 'Awaiting feeds');
    button.disabled = !game.sources.length || state.refreshing; button.setAttribute('aria-label', `Watch ${game.title}`);
    button.addEventListener('click', () => play(game, 0));
    row.append(match, time, button); $('games').append(row);
  }
  renderHealth();
}
function refreshControls() {
  const busy = state.fetching || state.refreshing || state.pending;
  $('refresh').disabled = busy;
  $('refresh-player').disabled = busy;
  $('refresh').setAttribute('aria-busy', String(state.refreshing));
  $('refresh-player').setAttribute('aria-busy', String(state.refreshing));
  $('refresh').textContent = state.refreshing ? '↻ Refreshing…' : '↻ Refresh';
  $('refresh-player').textContent = state.refreshing ? '↻ Refreshing…' : '↻ Refresh';
}
function applySchedule(result) {
  state.games = result.games; state.updatedAt = result.fetchedAt;
  if (state.league && !state.games.some(game => game.category === state.tab && game.league === state.league)) state.league = '';
  $('updated').textContent = `Updated ${new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const messages = result.stale ? [`Showing cached listings from ${new Date(result.fetchedAt).toLocaleString()}. ${result.error}`] : [];
  messages.push(...(result.warnings || []));
  notice(messages.join(' '));
  renderGames();
}
function refreshError(error) {
  notice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
  if (!state.games.length) {
    $('games').replaceChildren();
    const empty = el('div', 'empty-state'); empty.append(el('h3', '', 'Couldn’t load the schedule.'), el('p', '', 'Check your connection, then use Refresh to try again.')); $('games').append(empty);
    $('updated').textContent = 'Schedule unavailable';
  }
}
async function refresh() {
  if (state.fetching || state.refreshing) return;
  state.fetching = true; refreshControls();
  try { applySchedule(await api.schedule()); }
  catch (error) { refreshError(error); }
  finally { state.fetching = false; refreshControls(); }
}
async function refreshEverything() {
  if (state.refreshing || state.pending) return;
  refreshScores();
  const selected = state.selected;
  const source = selected?.sources[state.source];
  state.refreshing = true; refreshControls(); renderSources(); renderGames();
  try {
    const result = await api.refreshAll(selected?.id, source?.url);
    if (result.player && state.selected === selected) {
      state.selected = result.player.game; state.source = result.player.index;
      $('playing-title').textContent = state.selected.title;
      const current = state.selected.sources[state.source];
      $('playing-detail').hidden = false;
      $('playing-detail').textContent = `${state.selected.league} · ${current.label}${current.detail ? ` · ${current.detail}` : ''}`;
      document.documentElement.style.setProperty('--video-aspect', '1.777777778');
    }
    applySchedule(result);
  } catch (error) { refreshError(error); }
  finally {
    state.refreshing = false; refreshControls(); renderSources(); renderGames(); updateBounds();
  }
}
function updateBounds() {
  const r = $('player-slot').getBoundingClientRect();
  api.bounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
}
function renderSources() {
  $('sources').replaceChildren(); $('sources').hidden = !state.selected;
  if (!state.selected) return;
  state.selected.sources.forEach((source, index) => {
    const button = el('button', `source${index === state.source ? ' selected' : ''}`, `${index + 1}. ${source.label}${source.detail ? ` · ${source.detail}` : ''}`);
    const health = el('span', 'feed-health'); health.dataset.source = source.url; button.append(health);
    button.setAttribute('aria-pressed', String(index === state.source));
    button.disabled = state.pending || state.refreshing;
    button.addEventListener('click', () => play(state.selected, index));
    $('sources').append(button);
  });
  renderHealth();
  $('next-source').disabled = state.pending || state.refreshing || state.selected.sources.length < 2;
}
async function play(game, index) {
  if (state.pending || state.refreshing) return;
  state.pending = true; state.selected = game; state.source = index;
  refreshControls();
  document.documentElement.style.setProperty('--video-aspect', '1.777777778');
  $('player-message').hidden = false;
  $('player-message').textContent = 'Loading…';
  $('stream-latency').hidden = false;
  $('stream-latency').textContent = 'Delay unknown';
  $('playing-title').textContent = game.title;
  $('playing-detail').hidden = false;
  $('playing-detail').textContent = `${game.league} · ${game.sources[index].label}${game.sources[index].detail ? ` · ${game.sources[index].detail}` : ''}`;
  $('watch-label').textContent = 'CONNECTING';
  $('player-empty').hidden = true;
  $('player-empty').style.display = 'none';
  $('stop').disabled = false; $('fullscreen').disabled = false;
  renderSources(); renderGames();
  document.querySelector('.watch-section').scrollIntoView({ block: 'start', behavior: 'instant' });
  updateBounds();
  try { await api.play(game.id, index); }
  catch (error) { $('player-message').textContent = error.message; $('watch-label').textContent = 'SOURCE UNAVAILABLE'; }
  finally { state.pending = false; refreshControls(); renderSources(); updateBounds(); }
}
async function stop() {
  await api.stop(); state.selected = null;
  document.body.classList.remove('theater');
  $('player-empty').hidden = false; $('player-empty').style.display = '';
  $('player-message').hidden = true;
  $('watch-label').textContent = 'PLAYER';
  $('playing-title').textContent = 'No game selected';
  $('stream-latency').hidden = true;
  $('playing-detail').hidden = true;
  $('playing-detail').textContent = '';
  for (const id of ['stop', 'fullscreen', 'next-source']) $(id).disabled = true;
  renderSources(); renderGames();
}
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => tabChanged(button.dataset.tab)));
$('refresh').addEventListener('click', refreshEverything);
$('refresh-player').addEventListener('click', refreshEverything);
$('search').addEventListener('input', renderGames);
$('available').addEventListener('change', renderGames);
$('stop').addEventListener('click', stop);
$('next-source').addEventListener('click', () => state.selected && play(state.selected, (state.source + 1) % state.selected.sources.length));
$('fullscreen').addEventListener('click', async () => { document.body.classList.toggle('theater'); await api.fullscreen(); updateBounds(); });
document.addEventListener('keydown', event => {
  if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) {
    event.preventDefault(); refreshEverything();
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.body.classList.remove('theater'); updateBounds(); } });
$('privacy-button').addEventListener('click', async () => {
  const info = await api.privacy();
  $('filter-status').textContent = info.filters;
  $('blocked-count').textContent = info.blocked.toLocaleString();
  $('privacy-dialog').showModal();
});
$('close-privacy').addEventListener('click', () => $('privacy-dialog').close());
$('privacy-dialog').addEventListener('click', event => { if (event.target === $('privacy-dialog')) $('privacy-dialog').close(); });
$('privacy-dialog').addEventListener('close', updateBounds);
new MutationObserver(() => api.bounds({ hidden: $('privacy-dialog').open })).observe($('privacy-dialog'), { attributes: true, attributeFilter: ['open'] });
api.onPlayer(data => {
  if (data.type === 'latency') { if (state.selected) { $('stream-latency').hidden = false; $('stream-latency').textContent = delayText(data.delay); $('stream-latency').title = delayTitle(data.delay); } return; }
  if (data.type === 'profile') { profiles.set(data.result.url, data.result); renderHealth(); return; }
  if (data.type === 'refresh-all') { refreshEverything(); return; }
  if (data.type === 'dimensions') {
    document.documentElement.style.setProperty('--video-aspect', String(data.width / data.height));
    updateBounds();
    return;
  }
  if (data.theater === false) { document.body.classList.remove('theater'); updateBounds(); return; }
  if (!state.selected) return;
  $('watch-label').textContent = data.status === 'ready' ? 'PLAYER OPEN' : data.status === 'error' ? 'SOURCE UNAVAILABLE' : 'CONNECTING';
  $('player-message').hidden = false;
  $('player-message').textContent = data.message || '';
  $('player-message').hidden = !data.message;
});
new ResizeObserver(updateBounds).observe($('player-slot'));
window.addEventListener('resize', updateBounds);
window.addEventListener('scroll', updateBounds, { passive: true });
$('timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
function clock() { $('clock').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
clock(); setInterval(clock, 60000);
refresh(); setInterval(refresh, 300000);

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
let liveScores = true;
let scoreRequest = 0;
let scoreDate = '';
function scoreStatus(game) {
  if (game.scheduleState === 'PPD') return 'Postponed';
  if (game.scheduleState === 'CNCL') return 'Cancelled';
  if (['OFF', 'FINAL'].includes(game.state)) return `Final${game.periodType === 'OT' ? ' / OT' : game.periodType === 'SO' ? ' / SO' : ''}`;
  if (['LIVE', 'CRIT'].includes(game.state)) {
    const period = game.periodType === 'SO' ? 'SO' : game.periodType === 'OT' ? 'OT' : `P${game.period || 1}`;
    return `${period} · ${game.intermission ? 'Intermission' : game.clock || 'Live'}`;
  }
  return game.state === 'FUT' || game.state === 'PRE' ? 'Scheduled' : 'Status unavailable';
}
async function refreshScores() {
  const date = liveScores ? 'now' : $('scores-date').value;
  if (!date) return;
  const request = ++scoreRequest;
  $('scores-refresh').disabled = true;
  if (scoreDate !== date) {
    $('scores').replaceChildren();
    $('scores-updated').textContent = 'Loading scores…';
    scoreDate = date;
  }
  try {
    const result = await api.scores(date);
    if (request !== scoreRequest) return;
    if (liveScores && result.date) $('scores-date').value = result.date;
    $('scores-today').setAttribute('aria-pressed', String(liveScores));
    $('scores-updated').textContent = `${result.stale ? 'Cached · ' : ''}Updated ${new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}${result.stale ? ' · Update failed' : ''}`;
    $('scores').replaceChildren();
    if (!result.games.length) $('scores').append(el('p', 'score-empty', 'No NHL games scheduled.'));
    const live = game => ['LIVE', 'CRIT'].includes(game.state);
    const games = [...result.games].sort((a, b) => Number(live(b)) - Number(live(a)));
    for (const game of games) {
      const card = el('article', 'score-card');
      const top = el('div', 'score-card-top');
      const live = ['LIVE', 'CRIT'].includes(game.state) && !['PPD', 'CNCL'].includes(game.scheduleState);
      top.append(el('span', live ? 'score-status live' : 'score-status', `${live ? 'Live · ' : ''}${scoreStatus(game)}`));
      if (game.start && Number.isFinite(Date.parse(game.start))) {
        const time = el('time', '', new Date(game.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
        time.dateTime = game.start;
        time.title = new Date(game.start).toLocaleString();
        top.append(time);
      }
      card.append(top);
      for (const [side, team] of [['Away', game.away], ['Home', game.home]]) {
        const row = el('div', 'score-team');
        const name = el('span', '', team.name);
        name.title = `${side} · ${team.abbreviation}`;
        if (team.record) {
          const record = el('small', 'team-record', ` (${team.record.wins}–${team.record.losses}–${team.record.otLosses})`);
          record.title = `Current season: ${team.record.wins} wins, ${team.record.losses} losses, ${team.record.otLosses} overtime losses${team.record.date ? ` · As of ${team.record.date}` : ''}`;
          name.append(record);
        }
        const score = el('strong', '', team.score === null ? '—' : String(team.score));
        score.setAttribute('aria-label', team.score === null ? 'Score unavailable' : `${team.score} goals`);
        row.append(name, score); card.append(row);
      }
      if (game.away.shots !== null || game.home.shots !== null) card.append(el('p', 'score-detail', `Shots: ${game.away.abbreviation} ${game.away.shots ?? '—'} · ${game.home.abbreviation} ${game.home.shots ?? '—'}`));
      if (game.venue) card.append(el('p', 'score-detail', game.venue));
      if (game.broadcasts.length) card.append(el('p', 'score-detail', game.broadcasts.join(' · ')));
      $('scores').append(card);
    }
  } catch {
    if (request !== scoreRequest) return;
    $('scores-updated').textContent = $('scores').children.length ? 'Update failed · Showing previous scores' : 'Scores unavailable · Retry ↻';
  } finally { if (request === scoreRequest) $('scores-refresh').disabled = false; }
}
function changeScoreDate(offset) {
  liveScores = false;
  const date = new Date(`${$('scores-date').value || today()}T12:00:00`);
  date.setDate(date.getDate() + offset);
  $('scores-date').value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  refreshScores();
}
$('scores-date').value = today();
$('scores-prev').addEventListener('click', () => changeScoreDate(-1));
$('scores-next').addEventListener('click', () => changeScoreDate(1));
$('scores-today').addEventListener('click', () => { liveScores = true; refreshScores(); });
$('scores-date').addEventListener('change', () => { liveScores = false; refreshScores(); });
$('scores-refresh').addEventListener('click', refreshScores);
refreshScores(); setInterval(refreshScores, 10000);

function profileText(profile) {
  if (!profile) return 'Unknown';
  if (Date.now() - Date.parse(profile.checkedAt) > 10 * 60 * 1000) return 'Needs recheck';
  const size = profile.width && profile.height ? `${profile.width}×${profile.height} · ` : '';
  return `${size}${profile.label}${profile.score !== null && profile.score !== undefined ? ` ${profile.score}/100` : ''}${profile.delay ? ` · ${delayText(profile.delay)}` : ''}`;
}
function profileTitle(profile) {
  if (!profile) return 'Not yet measured';
  const checked = new Date(profile.checkedAt).toLocaleTimeString();
  if (profile.status !== 'rated') return `${profile.reason || profile.label} · ${checked}`;
  return `Provisional · ${profile.observedSeconds}s observed · Start ${profile.startupSeconds}s · ${profile.stalls} stalls (${profile.stalledSeconds}s) · ${profile.droppedFrames} dropped frames${profile.fps ? ` · ~${profile.fps} fps` : ''} · ${delayTitle(profile.delay)} · ${checked}`;
}
function renderHealth() {
  document.querySelectorAll('.feed-health').forEach(node => {
    const result = profiles.get(node.dataset.source);
    node.textContent = profileText(result); node.title = profileTitle(result);
    node.dataset.status = result?.status || 'unknown';
  });
  document.querySelectorAll('.game-health').forEach(node => {
    const game = state.games.find(game => game.id === node.dataset.game);
    const results = (game?.sources || []).map(source => profiles.get(source.url)).filter(Boolean);
    const best = results.filter(result => result.status === 'rated').sort((a, b) => b.score - a.score)[0];
    node.textContent = best ? profileText(best) : `${game?.sources.length || 0} feeds${results.some(result => result.status === 'testing') ? ' · Checking…' : ''}`;
    node.title = best ? profileTitle(best) : 'Feed ratings appear automatically as background checks finish';
  });
}

function delayText(delay) {
  if (!delay) return 'Delay unknown';
  return delay.kind === 'timestamp' ? `Timestamp lag ~${delay.seconds}s` : `Behind live edge ~${delay.seconds}s`;
}
function delayTitle(delay) {
  if (!delay) return 'This player exposes no reliable live timestamp. Actual delay from the game is unknown.';
  return delay.kind === 'timestamp' ? 'Estimated age of the encoder timestamp at the current playback position. Depends on encoder and system clocks; may not include delay before encoding.' : 'Distance behind the latest available video in this feed. Excludes upstream broadcast delay.';
}
