const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require('node:path').join(__dirname, '../electron/media-latency.js'), 'utf8');
function read(video, hls) {
  const context = vm.createContext({ window: { __hockeyHls: hls }, video, Date, Infinity });
  return vm.runInContext(`(${script})(video)`, context);
}
const video = () => ({ videoWidth: 1280, readyState: 4, duration: 3600, currentTime: 30, seekable: { length: 1, end: () => 60 } });
test('VOD and opaque embeds never claim a known broadcast delay', () => {
  assert.equal(read(video()), null);
});
test('live encoder timestamp yields age, with live-edge fallback only for live media', () => {
  const media = video();
  const timestamp = read(media, { media, latestLevelDetails: { live: true }, playingDate: new Date(Date.now() - 45000), latency: 8 });
  assert.equal(timestamp.kind, 'timestamp'); assert.ok(timestamp.seconds >= 44 && timestamp.seconds <= 46);
  const edge = read(media, { media, latestLevelDetails: { live: true }, playingDate: null, latency: 8 });
  assert.equal(edge.kind, 'edge'); assert.equal(edge.seconds, 8);
  assert.equal(read(media, { media, latestLevelDetails: { live: false }, playingDate: new Date(), latency: 8 }), null);
});
test('native infinite live playback reports only distance from available edge', () => {
  const media = video(); media.duration = Infinity;
  const result = read(media); assert.equal(result.kind, 'edge'); assert.equal(result.seconds, 30);
});
