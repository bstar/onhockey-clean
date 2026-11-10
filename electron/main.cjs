const { app, BrowserWindow, WebContentsView, session, ipcMain, protocol, net, powerSaveBlocker, Menu } = require('electron');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');
const { parseSchedule, publicUrl, ORIGIN } = require('../lib/schedule.cjs');

if (process.env.ONHOCKEY_PROFILE) app.setPath('userData', path.resolve(process.env.ONHOCKEY_PROFILE));
if (process.argv.includes('--version')) { console.log(`OnHockey Clean ${app.getVersion()}`); app.exit(0); }
protocol.registerSchemesAsPrivileged([{ scheme: 'hockey', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, player, playerSession, blocker, schedule, inFlight, activeSource, activeGame, mediaTimer, refreshInFlight;
const mediaFitScript = fs.readFileSync(path.join(__dirname, 'media-fit.js'), 'utf8');
let blocked = 0, keepAwake, currentBounds, modal = false, generation = 0, htmlFullscreen = false;
let filterStatus = 'Bundled EasyList + EasyPrivacy + site filters';
const root = path.join(__dirname, '..');
const uiOrigin = 'hockey://app/';
const send = data => { if (win && !win.isDestroyed()) win.webContents.send('player-state', data); };
function trusted(event) {
  if (event.sender !== win?.webContents || event.senderFrame?.url !== `${uiOrigin}index.html`) throw new Error('Untrusted caller');
}
function handle(channel, callback) { ipcMain.handle(channel, (event, ...args) => { trusted(event); return callback(...args); }); }
function cachePath() { return path.join(app.getPath('userData'), 'schedule.json'); }
async function fetchSchedule(force = false) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch(`${ORIGIN}schedule_table.php`, {
        headers: { Referer: ORIGIN, 'User-Agent': 'OnHockeyClean/0.1 (desktop schedule reader)', ...(force ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } : {}) },
        cache: force ? 'no-store' : 'default',
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`The schedule server returned HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 5_000_000) throw new Error('The schedule response is unexpectedly large.');
      const games = parseSchedule(new TextDecoder('windows-1251').decode(bytes));
      schedule = { games, fetchedAt: new Date().toISOString(), stale: false };
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeFile(cachePath(), JSON.stringify(schedule)).catch(() => {});
      return schedule;
    } catch (error) {
      if (!schedule) {
        try { const cached = JSON.parse(await readFile(cachePath(), 'utf8')); if (Array.isArray(cached.games) && cached.fetchedAt) schedule = cached; } catch {}
      }
      if (schedule) return { ...schedule, stale: true, error: error.message };
      throw new Error(`Could not fetch onhockey.tv listings. ${error.message}`);
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}
function registerFiles(ses) {
  ses.protocol.handle('hockey', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const pathname = decodeURIComponent(url.pathname);
    const allowed = new Map([
      ['/index.html', 'ui/index.html'], ['/style.css', 'ui/style.css'], ['/app.js', 'ui/app.js'],
      ['/embed.html', 'ui/embed.html'], ['/embed.js', 'ui/embed.js'], ['/embed.css', 'ui/embed.css'],
      ['/video.html', 'ui/video.html'], ['/video.js', 'ui/video.js'], ['/video.css', 'ui/video.css'],
      ['/hls.js', 'node_modules/hls.js/dist/hls.min.js'],
    ]);
    if (!allowed.has(pathname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(root, allowed.get(pathname))).href);
  });
}
function positionPlayer() {
  if (!player || !currentBounds || !win) return;
  const [width, height] = win.getContentSize();
  const b = htmlFullscreen ? { x: 0, y: 0, width, height } : currentBounds;
  // Clip to the window and hide the native child view underneath modal dialogs.
  const x = Math.max(0, Math.min(width, b.x));
  const y = Math.max(0, Math.min(height, b.y));
  const w = Math.max(0, Math.min(b.width, width - x));
  const h = Math.max(0, Math.min(b.y + b.height, height) - y);
  player.setVisible(!modal && w > 0 && h > 0);
  player.setBounds({ x, y, width: w, height: h });
}
function stopPlayer() {
  generation++;
  activeSource = null; activeGame = null;
  clearInterval(mediaTimer); mediaTimer = undefined;
  htmlFullscreen = false;
  if (player) {
    win?.contentView.removeChildView(player);
    player.webContents.close(); player = null;
  }
  if (keepAwake !== undefined) { powerSaveBlocker.stop(keepAwake); keepAwake = undefined; }
}
async function play(gameId, index) {
  const listed = schedule?.games.find(g => g.id === gameId);
  const game = listed?.sources.length ? listed : activeGame?.id === gameId ? activeGame : listed;
  if (!game || !Number.isInteger(index) || !game.sources[index]) throw new Error('This feed is no longer listed. Refresh the schedule and select the game again.');
  return openSource(game.sources[index], game);
}
function openSource(source, game) {
  if (!publicUrl(source.url)) throw new Error('Unsupported stream address.');
  stopPlayer();
  const token = generation;
  activeSource = source; activeGame = game;
  player = new WebContentsView({ webPreferences: {
    session: playerSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, autoplayPolicy: 'no-user-gesture-required', disableDialogs: true,
  } });
  const view = player;
  win.contentView.addChildView(view);
  positionPlayer();
  keepAwake = powerSaveBlocker.start('prevent-display-sleep');
  const contents = view.webContents;
  let measuring = false, lastVideoSize = '';
  async function fitMedia() {
    if (measuring || token !== generation || contents.isDestroyed()) return;
    measuring = true;
    try {
      const frames = contents.mainFrame.framesInSubtree.filter(frame => /^(https?:|hockey:)/.test(frame.url));
      const results = await Promise.allSettled(frames.map(frame => frame.executeJavaScript(mediaFitScript)));
      if (token !== generation || contents.isDestroyed()) return;
      const size = results.find(result => result.status === 'fulfilled' && result.value?.width && result.value?.height)?.value;
      if (!size || `${size.width}x${size.height}` === lastVideoSize) return;
      lastVideoSize = `${size.width}x${size.height}`;
      await contents.executeJavaScript(`document.documentElement.style.setProperty('--video-aspect', '${size.width / size.height}')`);
      send({ type: 'dimensions', ...size });
    } catch {} finally { measuring = false; }
  }
  contents.on('did-frame-finish-load', fitMedia);
  mediaTimer = setInterval(fitMedia, 1000);
  contents.setWindowOpenHandler(() => { blocked++; return { action: 'deny' }; });
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    // A selected provider can navigate within its host; ad landing pages cannot replace it.
    if (source.kind === 'embed' || !publicUrl(url) || new URL(url).hostname !== new URL(source.url).hostname) { blocked++; event.preventDefault(); }
  });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && (source.kind === 'embed' || !publicUrl(url) || new URL(url).hostname !== new URL(source.url).hostname)) { blocked++; event.preventDefault(); }
  });
  contents.on('did-finish-load', () => { if (token === generation) send({ status: 'ready' }); });
  contents.on('did-fail-load', (_event, code, message, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && token === generation) send({ status: 'error', message: `This provider could not load (${message}). Choose another source.` });
  });
  contents.on('render-process-gone', () => { if (token === generation) send({ status: 'error', message: 'The player stopped unexpectedly. Select this source again or try another.' }); });
  contents.on('enter-html-full-screen', () => { htmlFullscreen = true; win.setFullScreen(true); positionPlayer(); });
  contents.on('leave-html-full-screen', () => { htmlFullscreen = false; win.setFullScreen(false); positionPlayer(); });
  contents.on('before-input-event', (event, input) => {
    refreshShortcut(event, input);
    if (input.key === 'Escape') win.setFullScreen(false);
  });
  const url = source.kind === 'hls' ? `${uiOrigin}video.html#${encodeURIComponent(source.url)}`
    : source.kind === 'embed' ? `${uiOrigin}embed.html#${encodeURIComponent(source.url)}` : source.url;
  send({ status: 'loading', message: 'Loading the player… If a feed is unavailable, choose another source.' });
  contents.loadURL(url, { httpReferrer: ORIGIN }).catch(error => {
    if (token === generation && error.code !== 'ERR_ABORTED') send({ status: 'error', message: 'This source could not load. Try another feed.' });
  });
  return { loading: true };
}
function installFilters(lists, label) {
  const next = ElectronBlocker.parse(lists, { enableCompression: true, loadCosmeticFilters: true, enableMutationObserver: true });
  if (blocker) blocker.disableBlockingInSession(playerSession);
  blocker = next;
  filterStatus = label;
  blocker.enableBlockingInSession(playerSession);
  // Preserve Ghostery's cosmetic filtering and CSP hooks, with one combined network pipeline.
  playerSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const url = new URL(details.url);
    if (url.protocol === 'hockey:') return callback({});
    if (!['http:', 'https:', 'ws:', 'wss:', 'blob:', 'data:'].includes(url.protocol)) { blocked++; return callback({ cancel: true }); }
    if (['http:', 'https:'].includes(url.protocol) && !publicUrl(details.url)) { blocked++; return callback({ cancel: true }); }
    const { match, redirect } = blocker.match(fromElectronDetails(details));
    if (match || redirect) { blocked++; return callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true }); }
    callback({});
  });
}
async function loadFilters() {
  const supplemental = fs.readFileSync(path.join(root, 'assets/custom-filters.txt'), 'utf8');
  try {
    const cached = JSON.parse(await readFile(path.join(app.getPath('userData'), 'filters.json'), 'utf8'));
    if (cached.easylist && cached.easyprivacy && cached.updatedAt) {
      installFilters(`${cached.easylist}\n${cached.easyprivacy}\n${supplemental}`, `EasyList + EasyPrivacy · updated ${new Date(cached.updatedAt).toLocaleDateString()}`);
      return;
    }
  } catch {}
  const lists = ['easylist.txt', 'easyprivacy.txt'].map(name => fs.readFileSync(path.join(root, 'assets', name), 'utf8')).join('\n');
  installFilters(`${lists}\n${supplemental}`, 'EasyList + EasyPrivacy + site filters (bundled)');
}
async function updateFilters(force = false) {
  const target = path.join(app.getPath('userData'), 'filters.json');
  try {
    const cached = JSON.parse(await readFile(target, 'utf8'));
    if (!force && Date.now() - new Date(cached.updatedAt).getTime() < 4 * 86400000) return;
  } catch {}
  const lists = await Promise.all(['easylist', 'easyprivacy'].map(async name => {
    const response = await fetch(`https://easylist.to/easylist/${name}.txt`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Filter update HTTP ${response.status}`);
    const text = await response.text();
    if (!text.startsWith('[Adblock Plus') || text.length < 100000 || text.length > 10000000) throw new Error('Invalid filter list');
    return text;
  }));
  const cached = { easylist: lists[0], easyprivacy: lists[1], updatedAt: new Date().toISOString() };
  await mkdir(app.getPath('userData'), { recursive: true });
  const supplemental = fs.readFileSync(path.join(root, 'assets/custom-filters.txt'), 'utf8');
  installFilters(`${lists.join('\n')}\n${supplemental}`, `EasyList + EasyPrivacy · updated ${new Date().toLocaleDateString()}`);
  await writeFile(target, JSON.stringify(cached));
}
function refreshShortcut(event, input) {
  if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) {
    event.preventDefault();
    send({ type: 'refresh-all' });
  }
}
async function refreshEverything(gameId, sourceUrl) {
  if (refreshInFlight) return refreshInFlight;
  const listed = schedule?.games.find(game => game.id === gameId);
  const previousGame = listed?.sources.length ? listed : activeGame?.id === gameId ? activeGame : listed;
  const previousSource = previousGame?.sources.find(source => source.url === sourceUrl);
  const token = generation;
  refreshInFlight = (async () => {
    const results = await Promise.allSettled([
      (async () => { if (inFlight) await inFlight.catch(() => {}); return fetchSchedule(true); })(),
      updateFilters(true), playerSession.clearCache(), session.defaultSession.clearCache(),
    ]);
    if (results[0].status === 'rejected') throw results[0].reason;
    const result = { ...results[0].value, player: null, warnings: [] };
    if (results[1].status === 'rejected') result.warnings.push('Filter updates are unavailable; existing ad/tracker protection remains active.');
    if (results.slice(2).some(entry => entry.status === 'rejected')) result.warnings.push('Some cached content could not be cleared.');
    // A stop or source change during the fetch must not be undone by its completion.
    if (previousSource && player && generation === token && activeSource?.url === previousSource.url) {
      let game = result.games.find(game => game.id === gameId);
      let index;
      if (game?.sources.length) {
        index = game.sources.findIndex(source => source.url === previousSource.url);
        if (index < 0) index = game.sources.findIndex(source => source.label === previousSource.label && source.detail === previousSource.detail);
        if (index < 0) { index = 0; result.warnings.push('The previous source is no longer listed; opened the first available feed for this game.'); }
      } else {
        game = { ...previousGame, sources: [previousSource] };
        index = 0;
        result.warnings.push('No fresh links are listed for this game; reloaded the last selected feed.');
      }
      openSource(game.sources[index], game);
      result.player = { game, index };
    }
    return result;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
async function createWindow() {
  win = new BrowserWindow({ width: 1380, height: 990, minWidth: 900, minHeight: 650, backgroundColor: '#101215', title: 'OnHockey Clean', icon: path.join(root, 'assets/icon.png'), autoHideMenuBar: true, webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('before-input-event', refreshShortcut);
  win.on('resize', positionPlayer);
  win.on('leave-full-screen', () => { htmlFullscreen = false; send({ theater: false }); positionPlayer(); });
  win.on('close', stopPlayer);
  win.on('closed', () => { win = null; });
  await win.loadURL(`${uiOrigin}index.html`);
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerFiles(session.defaultSession);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  playerSession = session.fromPartition('hockey-player', { cache: false });
  registerFiles(playerSession);
  playerSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  playerSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  playerSession.on('will-download', event => { blocked++; event.preventDefault(); });
  await loadFilters();
  handle('schedule', fetchSchedule);
  handle('refresh-all', refreshEverything);
  handle('play', play);
  handle('stop', () => { stopPlayer(); win.setFullScreen(false); });
  handle('fullscreen', () => { win.setFullScreen(!win.isFullScreen()); });
  handle('privacy', () => ({ blocked, filters: filterStatus, ephemeral: true }));
  ipcMain.on('player-bounds', (event, bounds) => {
    trusted(event);
    if (typeof bounds?.hidden === 'boolean') modal = bounds.hidden;
    if (['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds?.[key]))) currentBounds = bounds;
    positionPlayer();
  });
  await createWindow();
  updateFilters().catch(error => console.warn(`Using existing filter lists: ${error.message}`));
  app.on('activate', () => { if (!win) createWindow(); });
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
