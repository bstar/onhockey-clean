const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createObservation } = require('../lib/stream-health.cjs');
function sample(time, extras = {}) { return { key: 'video', time, width: 1280, height: 720, paused: false, readyState: 4, frames: time * 30, dropped: 0, ...extras }; }
test('reliability requires advancing media, not a loaded page or metadata', () => {
  const observation = createObservation(0);
  for (let i = 0; i < 20; i++) observation.sample(sample(0, { paused: true }), i * 1000);
  const result = observation.result(undefined, 20000);
  assert.equal(result.label, 'Needs interaction'); assert.equal(result.score, null);
  const empty = createObservation(0).result(undefined, 20000);
  assert.equal(empty.label, 'Unverified');
});
test('stable playback records quality and rates independently of resolution', () => {
  const observation = createObservation(0);
  for (let i = 0; i <= 30; i++) observation.sample(sample(i), i * 1000);
  const result = observation.result(undefined, 30000);
  assert.equal(result.label, 'Stable'); assert.equal(result.width, 1280); assert.equal(result.height, 720);
  assert.equal(result.fps, 30); assert.equal(result.stalls, 0); assert.equal(result.provisional, true);
});
test('freezing after startup reduces reliability and counts stall episodes', () => {
  const observation = createObservation(0);
  for (let i = 0; i <= 30; i++) observation.sample(sample(i <= 5 ? i : 5), i * 1000);
  const result = observation.result(undefined, 30000);
  assert.equal(result.label, 'Unreliable'); assert.equal(result.stalls, 1);
  assert.equal(result.stalledSeconds, 25);
});
test('errors stay unavailable, short playback stays unverified, missing frames count as stalls', () => {
  const observation = createObservation(0);
  observation.sample(sample(0), 0); observation.sample(sample(1), 1000);
  assert.equal(observation.result(undefined, 1000).score, null);
  observation.sample(undefined, 2000);
  assert.equal(observation.result('Provider could not load', 2000).label, 'Unavailable');
  assert.equal(observation.result(undefined, 2000).stalledSeconds, 1);
});
