const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp('/tmp/hockey-probe-test-');
  const video = (await fs.readFile(path.join(__dirname, 'fixtures/video-16-9.mp4'))).toString('base64');
  const app = await electron.launch({ executablePath: process.env.ONHOCKEY_EXECUTABLE, args: process.env.ONHOCKEY_EXECUTABLE ? [] : [path.join(__dirname, '..')], env: { ...process.env, ONHOCKEY_PROFILE: profile } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.getElementById('updated').textContent.includes('Updated'), undefined, { timeout: 30000 });
    await page.locator('#search').fill('profiler-test-no-games');
    await page.evaluate(() => window.hockey.profile([]));
    await page.waitForTimeout(300);
    await app.evaluate(({ app, BrowserWindow, session }, video) => {
      const { createStreamProfiler } = process.mainModule.require(app.getAppPath() + '/electron/stream-profiler.cjs');
      const ses = session.fromPartition('hockey-profiler');
      ses.protocol.handle('https', request => {
        const name = new URL(request.url).pathname;
        if (name === '/failed') return Response.error();
        const blocked = name === '/interaction' ? `<script>HTMLMediaElement.prototype.play = () => Promise.reject(new Error('Needs play click'))</script>` : '';
        const freeze = name === '/freeze' ? `<script>setTimeout(()=>document.querySelector('video').pause(),2000)</script>` : '';
        return new Response(`<!doctype html><html><body>${blocked}<video ${name === '/interaction' ? '' : 'autoplay'} muted loop preload="auto" src="data:video/mp4;base64,${video}"></video>${freeze}</body></html>`, { headers: { 'content-type': 'text/html' } });
      });
      globalThis.probeTest = { results: [], checks: [], maxHidden: 0 };
      const test = globalThis.probeTest;
      test.profiler = createStreamProfiler({ BrowserWindow, session: ses, startupMs: 3000, observeMs: 12000, sampleMs: 250, onResult: result => {
        test.results.push(result);
        const hidden = BrowserWindow.getAllWindows().filter(window => window.webContents.getURL() !== 'hockey://app/index.html');
        test.maxHidden = Math.max(test.maxHidden, hidden.length);
        for (const window of hidden) {
          const preferences = window.webContents.getLastWebPreferences();
          test.checks.push({ id: window.id, url: window.webContents.getURL(), visible: window.isVisible(), muted: window.webContents.isAudioMuted(), sandbox: preferences.sandbox, node: preferences.nodeIntegration, bridge: Boolean(preferences.preload) });
        }
      } });
      test.sources = ['stable', 'freeze', 'interaction', 'failed'].map(name => ({ kind: name === 'interaction' ? 'embed' : 'page', url: `https://probe.example.org/${name}` }));
      test.profiler.setSources(test.sources);
    }, video);
    async function result(name) {
      const until = Date.now() + 45000;
      while (Date.now() < until) {
        const value = await app.evaluate((_, name) => globalThis.probeTest.results.find(result => result.url.endsWith('/' + name) && result.status !== 'testing'), name);
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error(`No result for ${name}`);
    }
    const stable = await result('stable');
    assert.equal(stable.status, 'rated'); assert.equal(stable.label, 'Stable');
    assert.equal(stable.width, 320); assert.equal(stable.height, 180); assert.ok(stable.observedSeconds >= 10);
    assert.equal(stable.delay, null, 'VOD cannot claim a live delay');
    const freeze = await result('freeze');
    assert.equal(freeze.label, 'Unreliable'); assert.ok(freeze.stalledSeconds > 5);
    const interaction = await result('interaction');
    assert.equal(interaction.label, 'Needs interaction'); assert.equal(interaction.score, null);
    const failed = await result('failed');
    assert.equal(failed.label, 'Unavailable');
    const safety = await app.evaluate(() => ({ checks: globalThis.probeTest.checks, maxHidden: globalThis.probeTest.maxHidden }));
    if (safety.maxHidden !== 1) console.log(JSON.stringify(safety));
    assert.equal(safety.maxHidden, 1, 'only one hidden probe at a time');
    assert.ok(safety.checks.length);
    assert.ok(safety.checks.every(check => !check.visible && check.muted && check.sandbox && !check.node && !check.bridge));
    const cached = await app.evaluate(() => {
      const test = globalThis.probeTest;
      const before = test.results.length;
      const snapshot = test.profiler.setSources(test.sources);
      return { before, after: test.results.length, snapshot };
    });
    assert.equal(cached.before, cached.after, 'recent results are reused');
    assert.equal(Object.keys(cached.snapshot).length, 4);
    await app.evaluate(() => {
      const test = globalThis.probeTest;
      test.profiler.setSources([{ kind: 'page', url: 'https://probe.example.org/cancel' }]);
      test.profiler.close();
    });
    await page.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => !window.isVisible()).length), 0, 'closing profiler destroys hidden window');
    assert.equal(await page.title(), 'Hockey');
    console.log('Profiler passed: real hidden muted playback, isolation, stable/frozen/interaction/error ratings, serial queue, cache, unknown VOD delay, cancellation and cleanup.');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
