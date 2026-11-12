const fs = require('node:fs');
const path = require('node:path');
const { createObservation } = require('../lib/stream-health.cjs');
const { publicUrl, ORIGIN } = require('../lib/schedule.cjs');
const latencyScript = fs.readFileSync(path.join(__dirname, 'media-latency.js'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, 'probe-media.js'), 'utf8').replace('__LATENCY_READER__', latencyScript);

function createStreamProfiler({ BrowserWindow, session, onResult, startupMs = 20000, observeMs = 30000, sampleMs = 1000 }) {
  const results = new Map();
  let context = [], queue = [], active, closed = false;
  const fresh = source => {
    const result = results.get(source.url);
    return result && Date.now() - Date.parse(result.checkedAt) < (result.status === 'rated' ? 600000 : 120000);
  };
  function publish(source, result) {
    results.delete(source.url); results.set(source.url, result);
    if (results.size > 200) results.delete(results.keys().next().value);
    onResult({ url: source.url, ...result });
  }
  async function run(source) {
    if (!publicUrl(source.url)) return;
    const window = new BrowserWindow({ show: false, width: 1280, height: 720, skipTaskbar: true,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', disableDialogs: true } });
    const contents = window.webContents;
    contents.setAudioMuted(true);
    const observation = createObservation();
    let failure, ended = false, sampling = false, lastKey;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    let timer;
    const hardTimeout = setTimeout(() => finish(), startupMs + observeMs + 5000);
    active = { source, window, cancel: () => finish('cancelled') };
    window.on('closed', () => finish());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    const forbid = url => source.kind !== 'page' || !publicUrl(url) || new URL(url).hostname !== new URL(source.url).hostname;
    contents.on('will-navigate', (event, url) => { if (forbid(url)) event.preventDefault(); });
    contents.on('will-redirect', (event, url, _inPlace, mainFrame) => { if (mainFrame && forbid(url)) event.preventDefault(); });
    contents.on('did-fail-load', (_event, code, _message, _url, mainFrame) => {
      if (mainFrame && code !== -3) { failure = 'Provider could not load'; finish(); }
    });
    contents.on('render-process-gone', () => { failure = 'Player process stopped'; finish(); });
    publish(source, { status: 'testing', label: 'Checking…', checkedAt: new Date().toISOString(), score: null });
    const start = Date.now();
    async function sample() {
      if (sampling || contents.isDestroyed()) return;
      sampling = true;
      try {
        const frames = contents.mainFrame.framesInSubtree.filter(frame => /^(https?:|hockey:)/.test(frame.url));
        const samples = await Promise.allSettled(frames.map(async frame => {
          const values = await frame.executeJavaScript(script);
          return (Array.isArray(values) ? values : []).map(value => ({ ...value, key: `${frame.processId}:${frame.routingId}:${value.key}` }));
        }));
        if (contents.isDestroyed()) return;
        const videos = samples.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        videos.sort((a, b) => Number(!b.paused && b.readyState >= 2) - Number(!a.paused && a.readyState >= 2) || b.width * b.height - a.width * a.height);
        const video = videos.find(v => v.key === lastKey && !v.ended && !v.error) || videos[0];
        lastKey = video?.key;
        observation.sample(video);
        if (video?.ended) { ended = true; finish(); }
        if (video?.error) { failure = 'Video playback error'; finish(); }
        if ((!observation.playing && Date.now() - start >= startupMs) || observation.observedSeconds * 1000 >= observeMs) finish();
      } catch {} finally { sampling = false; }
    }
    timer = setInterval(sample, sampleMs);
    const url = source.kind === 'hls' ? `hockey://app/video.html#${encodeURIComponent(source.url)}`
      : source.kind === 'embed' ? `hockey://app/embed.html#${encodeURIComponent(source.url)}` : source.url;
    contents.loadURL(url, { httpReferrer: ORIGIN }).catch(error => {
      if (!contents.isDestroyed() && error.code !== 'ERR_ABORTED') { failure = 'Provider could not load'; finish(); }
    });
    const status = await done;
    clearInterval(timer); clearTimeout(hardTimeout);
    await new Promise(resolve => {
      if (window.isDestroyed()) return resolve();
      window.once('closed', resolve);
      window.destroy();
    });
    active = null;
    if (status === 'cancelled') results.delete(source.url);
    else {
      const result = observation.result(failure);
      publish(source, ended ? { ...result, status: 'unknown', score: null, label: 'Ended', reason: 'Playback ended during the test' } : result);
    }
  }
  async function pump() {
    if (active || closed) return;
    const source = queue.shift();
    if (!source) return;
    try { await run(source); }
    catch { publish(source, { status: 'unknown', label: 'Unverified', score: null, checkedAt: new Date().toISOString(), reason: 'Unable to measure this player' }); }
    if (!closed) { refill(); setImmediate(pump); }
  }
  function refill() {
    queue = context.filter(source => source.url !== active?.source.url && !fresh(source));
  }
  const refreshTimer = setInterval(() => { if (!closed) { refill(); pump(); } }, 30000);
  return {
    setSources(sources) {
      context = [...new Map(sources.filter(source => publicUrl(source.url)).map(source => [source.url, source])).values()].slice(0, 24);
      // Cancel obsolete work when the user changes competition/search/game.
      if (active && !context.some(source => source.url === active.source.url)) active.cancel();
      refill(); pump();
      return Object.fromEntries(context.map(source => [source.url, results.get(source.url)]).filter(([, value]) => value));
    },
    close() { closed = true; context = []; queue = []; clearInterval(refreshTimer); active?.cancel(); },
  };
}
module.exports = { createStreamProfiler };
