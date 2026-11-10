const $ = id => document.getElementById(id);
const api = window.hockey;
const state = { games: [], tab: 'nhl', league: '', selected: null, source: 0, pending: false, fetching: false, refreshing: false, updatedAt: null };
const labels = { nhl: 'NHL', international: 'International', other: 'Other leagues' };
const descriptions = {
  nhl: ['Your seat at the rink.', 'NHL up front. Pick a game, choose a feed, settle in.'],
  international: ['The world takes the ice.', 'Olympics, IIHF tournaments, and international hockey — when listed.'],
  other: ['There’s more ice out there.', 'Club hockey, junior leagues, and everything beyond the NHL.'],
};
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
  $('breadcrumb').textContent = labels[tab];
  $('page-title').textContent = descriptions[tab][0];
  $('page-description').textContent = descriptions[tab][1];
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
  $('game-count').textContent = games.length;
  $('games').replaceChildren();
  if (!games.length) {
    const empty = el('div', 'empty-state');
    const filtered = query || state.league || $('available').checked;
    empty.append(el('h3', '', filtered ? 'No games match these filters.' : `No ${labels[state.tab]} games listed right now.`));
    empty.append(el('p', '', filtered ? 'Try a different team, league, or turn off “With feeds”.' : 'The schedule refreshes every five minutes. Feeds usually appear closer to puck drop.'));
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
    match.append(badge, text);
    const time = el('time', '', localTime(game.utcTime)); time.title = `${game.utcTime} UTC · listed start time`;
    const button = el('button', 'watch', game.sources.length ? 'Watch  ▷' : 'Awaiting feeds');
    button.disabled = !game.sources.length || state.refreshing; button.setAttribute('aria-label', `Watch ${game.title}`);
    button.addEventListener('click', () => play(game, 0));
    row.append(match, time, button); $('games').append(row);
  }
}
function refreshControls() {
  const busy = state.fetching || state.refreshing || state.pending;
  $('refresh').disabled = busy;
  $('refresh-player').disabled = busy;
  $('refresh').setAttribute('aria-busy', String(state.refreshing));
  $('refresh-player').setAttribute('aria-busy', String(state.refreshing));
  $('refresh').textContent = state.refreshing ? '↻ Refreshing…' : '↻ Refresh everything';
  $('refresh-player').textContent = state.refreshing ? '↻ Refreshing…' : '↻ Refresh all';
}
function applySchedule(result) {
  state.games = result.games; state.updatedAt = result.fetchedAt;
  if (state.league && !state.games.some(game => game.category === state.tab && game.league === state.league)) state.league = '';
  $('updated').textContent = `Updated ${new Date(result.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Auto-refresh every 5 min · Feeds ≠ live status`;
  const messages = result.stale ? [`Showing cached listings from ${new Date(result.fetchedAt).toLocaleString()}. ${result.error}`] : [];
  messages.push(...(result.warnings || []));
  notice(messages.join(' '));
  renderGames();
}
function refreshError(error) {
  notice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
  if (!state.games.length) {
    $('games').replaceChildren();
    const empty = el('div', 'empty-state'); empty.append(el('h3', '', 'Couldn’t load the schedule.'), el('p', '', 'Check your connection, then use Refresh everything to try again.')); $('games').append(empty);
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
  const selected = state.selected;
  const source = selected?.sources[state.source];
  state.refreshing = true; refreshControls(); renderSources(); renderGames();
  try {
    const result = await api.refreshAll(selected?.id, source?.url);
    if (result.player && state.selected === selected) {
      state.selected = result.player.game; state.source = result.player.index;
      $('playing-title').textContent = state.selected.title;
      const current = state.selected.sources[state.source];
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
    button.setAttribute('aria-pressed', String(index === state.source));
    button.disabled = state.pending || state.refreshing;
    button.addEventListener('click', () => play(state.selected, index));
    $('sources').append(button);
  });
  $('next-source').disabled = state.pending || state.refreshing || state.selected.sources.length < 2;
}
async function play(game, index) {
  if (state.pending || state.refreshing) return;
  state.pending = true; state.selected = game; state.source = index;
  refreshControls();
  document.documentElement.style.setProperty('--video-aspect', '1.777777778');
  $('player-message').hidden = false;
  $('player-message').textContent = 'Loading the player… If a feed is unavailable, choose another source.';
  $('playing-title').textContent = game.title;
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
  $('watch-label').textContent = 'READY WHEN YOU ARE';
  $('playing-title').textContent = 'Nothing between you and the game.';
  $('playing-detail').textContent = 'Stream links appear as providers make them available.';
  for (const id of ['stop', 'fullscreen', 'next-source']) $(id).disabled = true;
  renderSources(); renderGames();
}
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); tabChanged('nhl'); });
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
  $('player-message').textContent = data.message || 'Press play in the feed if needed. Black screen or buffering? Try Next source. Player loaded does not guarantee the stream is online.';
});
new ResizeObserver(updateBounds).observe($('player-slot'));
window.addEventListener('resize', updateBounds);
window.addEventListener('scroll', updateBounds, { passive: true });
$('timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
function clock() { $('clock').textContent = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); }
clock(); setInterval(clock, 60000);
refresh(); setInterval(refresh, 300000);
