const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'onhockey-layout-'));
  const wide = (await fs.readFile(path.join(__dirname, 'fixtures/video-16-9.mp4'))).toString('base64');
  const standard = (await fs.readFile(path.join(__dirname, 'fixtures/video-4-3.mp4'))).toString('base64');
  const app = await electron.launch({ executablePath: process.env.ONHOCKEY_EXECUTABLE, args: process.env.ONHOCKEY_EXECUTABLE ? [] : [path.join(__dirname, '..')], env: { ...process.env, ONHOCKEY_PROFILE: profile } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.getElementById('updated').textContent.includes('Updated'), undefined, { timeout: 30000 });
    const { games } = await page.evaluate(() => window.hockey.schedule());
    const game = games.find(g => g.sources.some(source => source.kind === 'embed'));
    const index = game.sources.findIndex(source => source.kind === 'embed');
    const source = game.sources[index].url;
    await app.evaluate(({ session, net }, { source, wide }) => {
      session.fromPartition('hockey-player').protocol.handle('https', request => {
        if (request.url !== source) return net.fetch(request, { bypassCustomProtocolHandlers: true });
        // Reproduce a provider's fixed-size player and fill/crop default, using real media metadata.
        return new Response(`<html><head><style>html,body{margin:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center}.jwplayer{width:960px;height:540px;flex:none}video{width:100%;height:100%;object-fit:cover}</style></head><body><div class="jwplayer"><video autoplay muted loop controls src="data:video/mp4;base64,${wide}"></video></div></body></html>`, { headers: { 'content-type': 'text/html' } });
      });
    }, { source, wide });
    await page.locator(`[data-tab="${game.category}"]`).click();
    await page.locator('#search').fill(game.title);
    await page.locator('.watch').first().click();
    if (index !== 0) await page.locator('.source').nth(index).click();
    async function check(label) {
      await page.waitForTimeout(250);
      const frames = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const view = win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents);
        const frames = [];
        for (const frame of view.webContents.mainFrame.framesInSubtree) {
          if (!/^(https?:|hockey:)/.test(frame.url)) continue;
          frames.push(await frame.executeJavaScript(`({viewport:[innerWidth,innerHeight],scrollbar:[innerWidth-document.documentElement.clientWidth,innerHeight-document.documentElement.clientHeight],boxes:[...document.querySelectorAll('iframe,video')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,rect:[r.x,r.y,r.right,r.bottom],fit:getComputedStyle(el).objectFit,size:el.videoWidth?[el.videoWidth,el.videoHeight]:null}})})`));
        }
        return frames;
      });
      let videos = 0;
      for (const frame of frames) {
        assert.deepEqual(frame.scrollbar, [0, 0], `${label}: player scrollbars`);
        for (const box of frame.boxes) {
          const [left, top, right, bottom] = box.rect;
          assert.ok(left >= -1 && top >= -1 && right <= frame.viewport[0] + 1 && bottom <= frame.viewport[1] + 1, `${label}: ${box.tag} clipped: ${JSON.stringify(box)} viewport ${frame.viewport}`);
          if (box.tag === 'VIDEO') { videos++; assert.equal(box.fit, 'contain'); assert.ok(box.size); }
        }
      }
      assert.ok(videos > 0, `${label}: no loaded test video`);
    }
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--video-aspect') === String(320 / 180));
    for (const viewport of [{ width: 900, height: 650 }, { width: 1380, height: 990 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.locator('.watch-section').evaluate(el => el.scrollIntoView({ block: 'start' }));
      await check(`16:9 ${viewport.width}x${viewport.height}`);
    }
    await app.evaluate(async ({ BrowserWindow }, standard) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win.contentView.children.find(v => v.webContents && v.webContents !== win.webContents);
      for (const frame of view.webContents.mainFrame.framesInSubtree) {
        if (!/^https:/.test(frame.url)) continue;
        await frame.executeJavaScript(`document.querySelector('video').src = 'data:video/mp4;base64,${standard}'`);
      }
    }, standard);
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--video-aspect') === String(320 / 240));
    await check('4:3 metadata change');
    await page.locator('#fullscreen').click();
    await check('4:3 theater');
    await page.setViewportSize({ width: 900, height: 650 });
    await check('4:3 small theater');
    await page.locator('#fullscreen').click();
    await check('4:3 leave theater');
    await page.locator('#stop').click();
    console.log('Layout checks passed: actual 16:9 and 4:3 metadata, three window sizes, theater, resize, and exit; all video and iframe edges visible; no player scrollbars.');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
