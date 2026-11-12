(video => {
  if (!video || !video.videoWidth || video.readyState < 2) return null;
  const hls = window.__hockeyHls;
  if (hls?.media === video && hls.latestLevelDetails?.live) {
    const playingDate = hls.playingDate;
    const timestampAge = playingDate instanceof Date ? (Date.now() - playingDate.getTime()) / 1000 : NaN;
    if (Number.isFinite(timestampAge) && timestampAge >= 0 && timestampAge < 86400) {
      return { kind: 'timestamp', seconds: Math.round(timestampAge) };
    }
    if (Number.isFinite(hls.latency) && hls.latency >= 0) return { kind: 'edge', seconds: Math.round(hls.latency) };
  }
  if (video.duration === Infinity && video.seekable.length) {
    const seconds = video.seekable.end(video.seekable.length - 1) - video.currentTime;
    if (Number.isFinite(seconds) && seconds >= 0) return { kind: 'edge', seconds: Math.round(seconds) };
  }
  return null;
})
