const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onhockey-test-'));
  const app = await electron.launch({ executablePath: process.env.ONHOCKEY_EXECUTABLE, args: [...(process.env.ONHOCKEY_EXECUTABLE ? [] : [path.join(__dirname, '..')]), `--user-data-dir=${profile}`], env: { ...process.env, ONHOCKEY_PROFILE: profile } });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.getElementById('updated').textContent.includes('Updated'), undefined, { timeout: 30000 });
    const result = await page.evaluate(() => window.hockey.schedule());
    assert.ok(result.games.length > 0, 'real schedule loaded');
    assert.ok(result.games.every(g => g.id && g.league && g.title));
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => typeof process), 'undefined');
    assert.ok(await page.locator('.nav[data-tab="nhl"]').evaluate(el => el.classList.contains('active')));
    await page.locator('[data-tab="other"]').click();
    assert.ok(await page.locator('.game').count() > 0);
    await page.locator('#search').fill('no-such-team-123');
    await page.getByText('No games match these filters.').waitFor();
    await page.locator('#search').fill('');
    await page.locator('#available').check();
    const first = page.locator('.watch:not(:disabled)').first();
    await first.click();
    await page.waitForFunction(() => document.querySelectorAll('.source').length > 0);
    // Embedded providers must be child frames: several reject top-level documents.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'hockey://app/index.html');
      const view = win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents);
      const wc = view.webContents;
      const deadline = Date.now() + 15000;
      while (!wc.getURL() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (wc.getURL().startsWith('hockey://app/embed.html#')) {
        const source = decodeURIComponent(wc.getURL().split('#')[1]);
        const structure = await wc.executeJavaScript(`({src: document.querySelector('iframe')?.src, sandbox: document.querySelector('iframe')?.hasAttribute('sandbox'), bridge: typeof window.hockey})`);
        if (structure.src !== source || structure.sandbox || structure.bridge !== 'undefined') throw new Error('Incorrect iframe host configuration');
        while (!wc.mainFrame.frames.some(frame => frame.url === source) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        const frame = wc.mainFrame.frames.find(frame => frame.url === source);
        if (!frame) throw new Error('Provider did not load as a child frame');
        const result = await frame.executeJavaScript(`({topLevel: window.top === window.self, node: typeof require, bridge: typeof window.hockey, text: document.body.innerText})`);
        if (result.topLevel || result.node !== 'undefined' || result.bridge !== 'undefined' || result.text.includes('Direct access blocked')) throw new Error('Embed rejected or has privileged access');
      }
    });
    if (await page.locator('.source').count() > 1) {
      await page.locator('#next-source').click();
      await page.waitForFunction(() => document.querySelectorAll('.source')[1]?.classList.contains('selected'));
    }
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'hockey://app/index.html');
      const player = window.contentView.children.find(view => view.webContents && view.webContents !== window.webContents);
      if (!player) throw new Error('No native isolated player');
      const preferences = player.webContents.getLastWebPreferences();
      if (preferences.nodeIntegration || !preferences.sandbox || !preferences.contextIsolation || !preferences.webSecurity) throw new Error('Unsafe player preferences');
    });
    await app.evaluate(async ({ session }) => {
      const ses = session.fromPartition('hockey-player');
      for (const url of ['https://google-analytics.com/analytics.js', 'https://debitm.org/14/test.js']) {
        let rejected = false;
        try { await ses.fetch(url); } catch { rejected = true; }
        if (!rejected) throw new Error(`Ad request was not blocked: ${url}`);
      }
    });
    await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'hockey://app/index.html');
      const player = window.contentView.children.find(view => view.webContents && view.webContents !== window.webContents);
      if (player.webContents.isLoading()) {
        const stopped = new Promise(resolve => player.webContents.once('did-stop-loading', resolve));
        player.webContents.stop(); await stopped;
      }
      await player.webContents.loadURL('hockey://app/video.html#' + encodeURIComponent('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'));
      const playback = await player.webContents.executeJavaScript(`new Promise(resolve => {
        const video = document.querySelector('video');
        if (video.readyState >= 3 && !video.paused) return resolve(true);
        video.addEventListener('playing', () => resolve(true), { once: true });
        setTimeout(() => resolve({ readyState: video.readyState, error: video.error?.message, status: document.getElementById('status').textContent }), 25000);
      })`);
      if (playback !== true) throw new Error('HLS video playback failed: ' + JSON.stringify(playback));
    });
    await page.locator('#privacy-button').click();
    await page.locator('#privacy-dialog').waitFor({ state: 'visible' });
    const privacy = await page.evaluate(() => window.hockey.privacy());
    assert.ok(privacy.blocked >= 2);
    await page.locator('#close-privacy').click();
    await page.locator('#stop').click();
    await page.locator('#player-empty').waitFor({ state: 'visible' });
    await page.locator('[data-tab="nhl"]').click();
    await page.locator('#available').uncheck();
    await app.evaluate(() => { globalThis.originalHockeyFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Simulated offline'); }; });
    await page.locator('#refresh').click();
    await page.getByText(/Showing cached listings/).waitFor();
    await app.evaluate(() => { globalThis.fetch = globalThis.originalHockeyFetch; delete globalThis.originalHockeyFetch; });
    await page.locator('#refresh').click();
    await page.locator('#notice').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(__dirname, '..', 'assets', 'screenshot.png') });
    assert.deepEqual(errors, []);
    console.log(`Desktop checks passed: ${result.games.length} real games; isolated iframe player; NHL default; filters; source selection; ad requests blocked; HLS video played; offline cached schedule; protection dialog; stop cleanup.`);
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
