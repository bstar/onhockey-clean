const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 1380, height: 990 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.addInitScript(() => {
      window.scoreTest = { fail: false, stale: false, goals: 0, requests: [] };
      const game = { id: 'game', title: 'Boston Bruins - Montreal Canadiens', league: 'NHL', category: 'nhl', utcTime: '23:00', sources: [{ label: 'Feed', url: 'https://example.com/' }] };
      const schedule = () => ({ games: [game], fetchedAt: new Date().toISOString() });
      window.hockey = {
        schedule: async () => schedule(), refreshAll: async () => schedule(), bounds: () => {},
        play: async () => {}, stop: async () => {}, fullscreen: async () => {}, onPlayer: callback => { window.playerTestEvent = callback; },
        privacy: async () => ({ filters: 'Enabled', blocked: 0 }),
        scores: async date => {
          window.scoreTest.requests.push(date);
          if (window.scoreTest.fail) throw new Error('Offline');
          return { date: date === 'now' ? '2026-11-11' : date, fetchedAt: new Date().toISOString(), stale: window.scoreTest.stale, games: [{ id: 1, start: `${date === 'now' ? '2026-11-11' : date}T23:00:00Z`, state: 'LIVE', scheduleState: 'OK', period: 2, periodType: 'REG', clock: '08:12', away: { name: 'Bruins', abbreviation: 'BOS', record: { wins: 10, losses: 3, otLosses: 0, date: '2026-11-11' }, score: window.scoreTest.goals, shots: 0 }, home: { name: 'Canadiens', abbreviation: 'MTL', score: 2, shots: 12 }, venue: 'Bell Centre', broadcasts: ['NESN'] }] };
        },
      };
    });
    await page.goto(pathToFileURL(path.join(__dirname, '../ui/index.html')).href);
    await page.locator('.score-card').waitFor();
    assert.match(await page.locator('#scores').innerText(), /P2 · 08:12/);
    assert.match(await page.locator('#scores').innerText(), /Shots: BOS 0 · MTL 12/);
    assert.deepEqual(await page.locator('.score-team strong').allTextContents(), ['0', '2']);
    assert.equal((await page.locator('.team-record').innerText()).trim(), '(10–3–0)');
    assert.equal(await page.locator('.brand').count(), 0);
    assert.equal(await page.locator('#scores-date').inputValue(), '2026-11-11', 'Live follows NHL game day after midnight');
    assert.equal(await page.evaluate(() => window.scoreTest.requests[0]), 'now');
    await page.evaluate(() => { window.scoreTest.goals = 1; });
    await page.clock.fastForward(10000);
    await page.waitForFunction(() => document.querySelector('.score-team strong').textContent === '1');
    assert.equal(await page.evaluate(() => window.scoreTest.requests.at(-1)), 'now', 'automatic poll stays in Live mode');
    for (const width of [900, 1380, 1920]) {
      await page.setViewportSize({ width, height: 990 });
      const player = await page.locator('.watch-section').boundingBox();
      const scores = await page.locator('.scores-panel').boundingBox();
      assert.ok(scores.x >= player.x + player.width, `right panel at ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1380, height: 990 });
    await page.screenshot({ path: '/tmp/onhockey-layout.png', fullPage: true });
    const initial = await page.locator('#scores-date').inputValue();
    await page.locator('#scores-next').click();
    assert.notEqual(await page.locator('#scores-date').inputValue(), initial);
    await page.locator('#scores-prev').click();
    assert.equal(await page.locator('#scores-date').inputValue(), initial);
    await page.locator('#scores-today').click();
    assert.equal(await page.evaluate(() => window.scoreTest.requests.at(-1)), 'now');
    await page.evaluate(() => { window.scoreTest.stale = true; });
    await page.locator('#scores-refresh').click();
    await page.waitForFunction(() => document.getElementById('scores-updated').textContent.includes('Cached'));
    await page.evaluate(() => { window.scoreTest.fail = true; });
    await page.locator('#scores-next').click();
    await page.waitForFunction(() => document.getElementById('scores-updated').textContent.includes('unavailable'));
    assert.equal(await page.locator('.score-card').count(), 0, 'no previous-day scores under new date');
    await page.locator('.watch').click();
    await page.evaluate(() => {
      window.playerTestEvent({ type: 'profile', result: { url: 'https://example.com/', status: 'rated', label: 'Stable', score: 95, width: 1280, height: 720, checkedAt: new Date().toISOString(), observedSeconds: 30, stalls: 0, stalledSeconds: 0, startupSeconds: 3, droppedFrames: 0, fps: 30, delay: { kind: 'timestamp', seconds: 45 } } });
      window.playerTestEvent({ type: 'latency', delay: { kind: 'edge', seconds: 8 } });
    });
    assert.match(await page.locator('.feed-health').innerText(), /1280×720 · Stable 95\/100 · Timestamp lag ~45s/);
    assert.equal(await page.locator('#stream-latency').innerText(), 'Behind live edge ~8s');
    await page.locator('#fullscreen').click();
    assert.equal(await page.locator('.scores-panel').isVisible(), false);
    await page.locator('#stop').click();
    assert.equal(await page.locator('.scores-panel').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Score UI passed: data, right panel at 900/1380/1920px, dates, stale/error states, theater, and no page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
