const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onhockey-refresh-'));
  const app = await electron.launch({ executablePath: process.env.ONHOCKEY_EXECUTABLE, args: process.env.ONHOCKEY_EXECUTABLE ? [] : [path.join(__dirname, '..')], env: { ...process.env, ONHOCKEY_PROFILE: profile } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.getElementById('updated').textContent.includes('Updated'), undefined, { timeout: 30000 });
    const html = await fs.readFile(path.join(__dirname, 'fixtures/schedule.html'), 'utf8');
    const lists = await Promise.all(['easylist', 'easyprivacy'].map(name => fs.readFile(path.join(__dirname, '..', 'assets', `${name}.txt`), 'utf8')));
    await app.evaluate(({ session }, { html, lists }) => {
      globalThis.refreshTest = { html, listings: 0, filters: 0, requests: [], fail: false, pause: false };
      const original = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        const test = globalThis.refreshTest;
        if (String(url).includes('schedule_table.php')) {
          test.listings++; test.cache = options.cache;
          if (test.pause) await new Promise(resolve => { test.resume = resolve; });
          if (test.fail) throw new Error('Simulated offline');
          return new Response(test.html);
        }
        if (String(url).startsWith('https://easylist.to/easylist/')) { test.filters++; return new Response(lists[String(url).includes('easyprivacy') ? 1 : 0]); }
        return original(url, options);
      };
      session.fromPartition('hockey-player').protocol.handle('https', request => {
        globalThis.refreshTest.requests.push(request.url);
        return new Response('<!doctype html><html><body>Refresh test provider</body></html>', { headers: { 'content-type': 'text/html' } });
      });
    }, { html, lists });
    async function refreshing(action) {
      const started = page.waitForFunction(() => document.getElementById('refresh').textContent.includes('Refreshing'), undefined, { timeout: 10000 });
      await action(); await started; await idle();
    }
    async function idle() { await page.waitForFunction(() => !document.getElementById('refresh').disabled, undefined, { timeout: 30000 }); }
    await refreshing(() => page.locator('#refresh').click());
    assert.equal(await page.locator('.game').count(), 2);
    await page.locator('#search').fill('Columbus');
    await page.locator('.watch:not(:disabled)').click();
    await idle();
    const playerId = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'hockey://app/index.html'); return win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents)?.webContents.id; });
    const before = await playerId();
    assert.ok(before);
    await app.evaluate(async ({ session }) => { await session.fromPartition('hockey-player').cookies.set({ url: 'https://embedsports.me', name: 'session-test', value: 'kept' }); });
    const reordered = html.replace('<a href="np_stream400.php?channel=//embedsports.me/nhl/test">duplicate</a>', '').replace(/<a href="np_stream400.php\?channel=\/\/embedsports.me\/nhl\/test" title="Home">plytvme<\/a>/, '<a href="np_stream400.php?channel=//embedsports.me/nhl/backup">backup</a><a href="np_stream400.php?channel=//embedsports.me/nhl/refreshed" title="Home">plytvme</a>');
    await app.evaluate((_, html) => { globalThis.refreshTest.html = html; }, reordered);
    await refreshing(() => page.keyboard.press('Control+r')); 
    assert.notEqual(await playerId(), before, 'refresh recreates the complete player');
    assert.equal(await page.locator('#search').inputValue(), 'Columbus');
    assert.equal(await page.locator('#playing-title').textContent(), 'Columbus - Minnesota Wild');
    assert.match(await page.locator('.source.selected').textContent(), /2\. plytvme/);
    const info = await app.evaluate(async ({ BrowserWindow, session }) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'hockey://app/index.html');
      const view = win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents);
      const deadline = Date.now() + 10000;
      while (!view.webContents.getURL() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      return { url: view.webContents.getURL(), cache: globalThis.refreshTest.cache, filters: globalThis.refreshTest.filters, cookies: await session.fromPartition('hockey-player').cookies.get({ name: 'session-test' }) };
    });
    assert.match(decodeURIComponent(info.url), /\/nhl\/refreshed$/);
    assert.equal(info.cache, 'no-store'); assert.ok(info.filters >= 4); assert.equal(info.cookies[0].value, 'kept');
    await page.locator('#fullscreen').click();
    const theaterPlayer = await playerId();
    await refreshing(() => page.locator('#refresh-player').click());
    assert.notEqual(await playerId(), theaterPlayer);
    assert.ok(await page.locator('body').evaluate(el => el.classList.contains('theater')));
    await page.locator('#fullscreen').click();
    await app.evaluate(() => { globalThis.refreshTest.html = '<table id="gametable"></table>'; });
    await refreshing(() => page.keyboard.press('F5')); 
    assert.ok(await playerId());
    await page.getByText(/No fresh links are listed/).waitFor();
    const missingPlayer = await playerId();
    await refreshing(() => page.keyboard.press('Control+r')); 
    assert.notEqual(await playerId(), missingPlayer, 'a removed game can still refresh its active feed');
    await app.evaluate(() => { globalThis.refreshTest.pause = true; });
    await page.keyboard.press('F5');
    await page.waitForFunction(() => document.getElementById('refresh').textContent.includes('Refreshing'));
    await page.locator('#stop').click();
    await app.evaluate(async () => { while (!globalThis.refreshTest.resume) await new Promise(resolve => setTimeout(resolve, 10)); globalThis.refreshTest.resume(); });
    await idle();
    assert.equal(await playerId(), undefined, 'stop during refresh does not restart video');
    await page.locator('#player-empty').waitFor({ state: 'visible' });
    await app.evaluate(() => { globalThis.refreshTest.pause = false; globalThis.refreshTest.fail = true; });
    await refreshing(() => page.keyboard.press('Control+r')); 
    await page.getByText(/Showing cached listings/).waitFor();
    console.log('Refresh checks passed: cache bypass, filter updates, source matching after URL/order changes, preserved cookies/search/game, Ctrl+R, F5, theater, removed listings, stop during refresh, and offline recovery.');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
