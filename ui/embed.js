// The provider is a real child frame, as its published embed code requires.
// The entire WebContentsView is sandboxed and has no application preload/bridge.
const source = new URL(decodeURIComponent(location.hash.slice(1)));
if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Unsupported embed URL');
document.getElementById('feed').src = source.href;
