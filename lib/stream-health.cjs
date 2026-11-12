// A short playback observation, not a promise of future provider availability.
function createObservation(startedAt = Date.now()) {
  let previous, firstPlayingAt, observedSeconds = 0, stalledSeconds = 0, stalls = 0, wasStalled = false;
  let delay = null;
  let width = 0, height = 0, frames = 0, dropped = 0, sawVideo = false, needsInteraction = false, mediaError = false;
  return {
    sample(sample, now = Date.now()) {
      if (sample) {
        sawVideo = true; needsInteraction ||= sample.paused && sample.readyState >= 2;
        mediaError ||= Boolean(sample.error);
      }
      const same = sample && previous?.sample && sample.key === previous.sample.key;
      const advancing = same && !sample.paused && (sample.time > previous.sample.time + 0.03 || sample.loop && sample.time < previous.sample.time);
      if (advancing && firstPlayingAt === undefined) firstPlayingAt = now;
      if (firstPlayingAt !== undefined && previous) {
        const seconds = Math.max(0, Math.min(3, (now - previous.at) / 1000));
        const stalled = !advancing && !sample?.ended;
        observedSeconds += seconds;
        if (stalled) { stalledSeconds += seconds; if (!wasStalled) stalls++; }
        wasStalled = stalled;
        if (same) {
          frames += Math.max(0, (sample.frames || 0) - (previous.sample.frames || 0));
          dropped += Math.max(0, (sample.dropped || 0) - (previous.sample.dropped || 0));
        }
      }
      if (advancing) { delay = sample.delay || null; width = sample.width; height = sample.height; }
      previous = { sample, at: now };
    },
    get playing() { return firstPlayingAt !== undefined; },
    get observedSeconds() { return observedSeconds; },
    result(reason, now = Date.now()) {
      const base = { delay, checkedAt: new Date(now).toISOString(), width, height, observedSeconds: Math.round(observedSeconds), stalledSeconds: Math.round(stalledSeconds), stalls, startupSeconds: firstPlayingAt === undefined ? null : +((firstPlayingAt - startedAt) / 1000).toFixed(1), fps: frames && observedSeconds > stalledSeconds ? Math.round(frames / (observedSeconds - stalledSeconds)) : null, droppedFrames: dropped, totalFrames: frames, provisional: true };
      if (reason || mediaError) return { ...base, status: 'unavailable', label: 'Unavailable', reason: reason || 'Video playback error', score: null };
      if (firstPlayingAt === undefined) return { ...base, status: 'unknown', label: needsInteraction ? 'Needs interaction' : 'Unverified', reason: sawVideo ? 'Playback did not start during the test' : 'No measurable video found', score: null };
      if (observedSeconds < 10) return { ...base, status: 'unknown', label: 'Brief playback', reason: 'Too little playback to rate reliability', score: null };
      const ratio = stalledSeconds / observedSeconds;
      const score = Math.max(0, Math.round(100 - ratio * 180 - Math.min(20, base.startupSeconds) - (frames ? dropped / frames * 50 : 0)));
      return { ...base, status: 'rated', score, label: score >= 80 ? 'Stable' : score >= 55 ? 'Some stalls' : 'Unreliable' };
    },
  };
}
module.exports = { createObservation };
