(() => {
  const videos = [...document.querySelectorAll('video')]
    .filter(video => video.videoWidth > 0 && video.videoHeight > 0)
    .sort((a, b) => Number(b.paused === false) - Number(a.paused === false) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = videos[0];
  if (!video) return null;
  const width = video.videoWidth, height = video.videoHeight, ratio = width / height;
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) return null;
  const root = video.closest('.jwplayer, .video-js, .plyr') || video;
  // Fit the actual player (including its controls), rather than clipping a fixed-size embed.
  const styles = {
    position: 'fixed', inset: 'auto', left: '50%', top: '50%',
    width: `min(100vw, calc(100vh * ${ratio}))`,
    height: `min(100vh, calc(100vw / ${ratio}))`,
    'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
    transform: 'translate(-50%, -50%)', margin: '0', 'aspect-ratio': String(ratio),
  };
  if (document.fullscreenElement === root) Object.assign(styles, { inset: '0', left: '0', top: '0', width: '100vw', height: '100vh', transform: 'none' });
  for (const [name, value] of Object.entries(styles)) {
    if (root.style.getPropertyValue(name) !== value || root.style.getPropertyPriority(name) !== 'important') root.style.setProperty(name, value, 'important');
  }
  root.setAttribute('data-hockey-player', '');
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  document.body.style.setProperty('overflow', 'hidden', 'important');
  video.style.setProperty('object-fit', 'contain', 'important');
  video.style.setProperty('object-position', 'center', 'important');
  return { width, height };
})()
