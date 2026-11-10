const video = document.querySelector('video');
const status = document.getElementById('status');
const source = decodeURIComponent(location.hash.slice(1));
function failed() { status.textContent = 'This feed is unavailable or blocked by its provider. Try another source.'; }
if (Hls.isSupported()) {
  const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
  hls.loadSource(source); hls.attachMedia(video);
  hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { failed(); hls.destroy(); } });
  window.addEventListener('beforeunload', () => hls.destroy());
} else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = source;
else failed();
video.addEventListener('playing', () => { status.textContent = ''; });
video.addEventListener('error', failed);
