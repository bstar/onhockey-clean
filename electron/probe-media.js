(readLatency => {
  // Runs only in the isolated, muted profiling window. Never clicks provider controls.
  const state = window.__hockeyProbeMedia ||= { videos: new WeakMap(), next: 0 };
  return [...document.querySelectorAll('video')].map(video => {
    let record = state.videos.get(video);
    if (!record) {
      record = { key: `${++state.next}` };
      state.videos.set(video, record);
      video.muted = true;
      video.play().catch(() => {});
    }
    const quality = video.getVideoPlaybackQuality?.();
    return { key: record.key, time: video.currentTime, width: video.videoWidth, height: video.videoHeight,
      paused: video.paused, loop: video.loop, ended: video.ended, readyState: video.readyState,
      error: video.error?.code || 0, frames: quality?.totalVideoFrames || 0, dropped: quality?.droppedVideoFrames || 0, delay: readLatency(video) };
  });
})(__LATENCY_READER__)
