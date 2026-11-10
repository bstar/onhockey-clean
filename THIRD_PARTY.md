# Third-party components

The application code is MIT licensed. Dependencies retain their respective licenses, included in the packaged application's node_modules and Electron distribution.

## Bundled ad and tracking filter lists

- `assets/easylist.txt`: [EasyList](https://easylist.to/), from https://easylist.to/easylist/easylist.txt
- `assets/easyprivacy.txt`: [EasyPrivacy](https://easylist.to/), from https://easylist.to/easylist/easyprivacy.txt

The full upstream headers, version identifiers, and attribution are preserved in both files. Their licensing terms are published at https://easylist.to/pages/licence.html. They are independent works and are not covered by this project's MIT license.

Blocking and cosmetic filtering are implemented using [Ghostery's adblocker](https://github.com/ghostery/adblocker) (MPL-2.0). Direct HLS playback uses [hls.js](https://github.com/video-dev/hls.js/) (Apache-2.0). Schedule parsing uses [Cheerio](https://github.com/cheeriojs/cheerio) (MIT). The desktop runtime is [Electron](https://www.electronjs.org/) (MIT and bundled third-party licenses).

The optional desktop integration test uses https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8, a public Big Buck Bunny HLS test stream. No test media is bundled with this app.
