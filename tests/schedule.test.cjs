const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseSchedule, resolveSource, publicUrl } = require('../lib/schedule.cjs');
const html = fs.readFileSync(`${__dirname}/fixtures/schedule.html`, 'utf8');
test('parses leagues, times, characters, and separates NHL from international and other games', () => {
  const games = parseSchedule(html);
  assert.equal(games.length, 4);
  assert.deepEqual(games.map(g => g.category), ['nhl', 'nhl', 'international', 'other']);
  assert.equal(games[0].title, 'Columbus - Minnesota Wild');
  assert.equal(games[0].utcTime, '22:00');
  assert.equal(games[1].sources.length, 0);
  assert.equal(games[3].title, 'Krefeld - Eisbären Berlin');
  assert.equal(games[0].sources.length, 1);
  assert.equal(games[0].sources[0].detail, 'Home');
  assert.equal(games[0].sources[0].url, 'https://embedsports.me/nhl/test');
  assert.equal(games[0].id, parseSchedule(html)[0].id);
});
test('only unwraps known players and preserves unknown provider wrappers', () => {
  const games = parseSchedule(html);
  assert.equal(games[2].sources[0].url, 'https://www.youtube-nocookie.com/embed/Q-aKPyloHRc?autoplay=1');
  assert.equal(games[3].sources[0].kind, 'hls');
  assert.equal(games[3].sources[1].url, 'https://vkvideo.ru/video_ext.php?oid=-229103798&id=456241736&autoplay=1');
  assert.equal(resolveSource('np_webcaster.php?channel=free_test/123/456').url, 'https://webcaster.pro/iframe/feed/start/free_test/123/456?lang=en&autostart=1');
  assert.equal(resolveSource('np_unknown.php?channel=example').url, 'https://onhockey.tv/np_unknown.php?channel=example');
  assert.equal(resolveSource('https://provider.example/live').kind, 'page');
});
test('rejects dangerous schemes, credentials, and local network addresses', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://localhost/x', 'http://127.0.0.1', 'http://2130706433/', 'http://10.1.2.3', 'http://192.168.1.1', 'http://172.16.0.1', 'http://[::1]', 'https://a:b@example.com']) assert.equal(publicUrl(url), null, url);
});
test('fails clearly on upstream error pages rather than returning an empty schedule', () => {
  assert.throws(() => parseSchedule('You are not allowed to access this page directly.'), /unavailable/);
  assert.deepEqual(parseSchedule('<table id="gametable"></table>'), []);
});
