# OnHockey Clean

A desktop app for Linux, macOS, and Windows for watching the streams listed on **onhockey.tv**, with NHL as the default view and separate International and Other Leagues sections. No account, app analytics, chat panels, or advertising placements.

## Run

Download the latest build from [GitHub Releases](https://github.com/bstar/onhockey-clean/releases/latest).

| System | Download |
| --- | --- |
| Linux on Intel/AMD | `linux-x86_64.AppImage` |
| Linux on ARM64 | `linux-arm64.AppImage` |
| macOS on Apple Silicon | `mac-arm64.dmg` or `.zip` |
| macOS on Intel | `mac-x64.dmg` or `.zip` |
| Windows on Intel/AMD | `win-x64.exe` installer or `.zip` portable build |

On Linux, make the AppImage executable and launch it; add `--appimage-extract-and-run` if FUSE is unavailable. On macOS, drag the app from the disk image into Applications. On Windows, run the installer or extract the portable ZIP. Checksums are included as `SHA256SUMS`.

The macOS packages are ad-hoc signed but not notarized; Windows packages are unsigned. Your system may require approval to open them. Publisher signing certificates are not configured.

For this machine's existing installation, launch **OnHockey Clean** from the application menu or run `onhockey-clean`.

For development, use Node.js 22 or newer:

```sh
git clone https://github.com/bstar/onhockey-clean.git
cd onhockey-clean
npm ci
npm start
```

To build on the target platform, run `npm run release:build -- --linux AppImage`, `npm run release:build -- --mac dmg zip`, or `npm run release:build -- --win nsis zip`. Add `--x64` or `--arm64` for the intended architecture. The release workflow builds native packages, runs unit tests and packaged launch checks on each platform, and publishes downloads only after every build passes. Push a version tag matching `package.json` (for example `v0.2.0`) to release.

## Watching

The interface has competition tabs above the player and a right-hand NHL scores panel. Scores come from the NHL score feed and refresh every 10 seconds independently of stream listings. The Live view follows the NHL’s current game day, including games continuing past midnight, and puts games in progress first. Browse dates with the arrows or date picker; times use your system timezone. Cards include scores, period/clock, shots, venue, and broadcasts when supplied. Missing scores show a dash. Failed updates retain same-date data with a cached or update-failed label; scores from another date are cleared. Team names include current season W–L–OT records from NHL standings (cached for five minutes). The scores panel stays visible beside the player at desktop sizes and is hidden in theater mode.

- Start in NHL, or switch to International (including Olympic games when listed) or Other Leagues.
- Search by team or league. “With feeds” hides games that don't have stream links yet.
- Click Watch to load the first listed source. Choose another source or Next source if a provider is offline, buffering, or broken.
- Theater expands the viewing area. Players can also offer their own fullscreen control. Escape exits fullscreen.
- The viewing area follows the video’s actual aspect ratio (including 4:3). Both embedded players and direct video fit inside the available space without cropping or player scrollbars; theater keeps source controls outside the picture.
- Close stops the player and releases the display sleep inhibitor.
- Listings refresh every five minutes without interrupting the selected stream. **Refresh** in the header or player toolbar, **Ctrl+R**, and **F5** fetch fresh listings, clear cached content, update ad/tracker filters, and recreate the current player. Your game, source, search, theater mode, and session cookies are preserved where available. A changed source URL is matched by provider; if that provider disappears, the first available feed opens with a notice. Close still cancels playback during a refresh.

Times are converted from the site's UTC clock to your system timezone. The source does not consistently supply calendar dates or authoritative live/end status, so the app shows the listed start time and feed availability rather than guessing whether a game is live. A link's presence does not guarantee playback. During a network error, the last successful schedule stays available with a visible cached-data notice and its original fetch time.

## Feed ratings

Feeds are checked automatically in a hidden, muted, sandboxed player with no windows, audio, or prompts shown. The scanner checks one feed at a time, prioritizing the selected game and then up to three games in the current filtered schedule (24 queued feeds maximum). Changing the selection cancels obsolete work. Each check allows 20 seconds to start and observes up to 30 seconds of playback. It uses a separate memory-only session with the same network ad/tracker filters and denies permissions, popups, downloads, and external navigation.

Source buttons show measured dimensions and a provisional reliability rating. Hover for startup time, observation duration, stalls, and dropped frames. Scores reflect this machine and connection during a short test; they do not verify the broadcast content or guarantee continued availability. Players requiring a manual click remain “Needs interaction” or “Unverified.” Results remain in memory; successful checks expire after ten minutes, inconclusive/failed checks after two minutes. Background testing consumes bandwidth and decoding resources for one additional feed. It stops when the app closes.

Where available, the current player and source ratings also show timestamp lag (age of the encoder’s program timestamp) or distance behind the feed’s live edge. The latter excludes upstream broadcast delay; encoder timestamp age also depends on clock accuracy and may exclude delays before encoding. Uninstrumented embedded players and on-demand video show “Delay unknown.” The app does not infer actual game delay from score changes.

## Privacy and stream handling

The app fetches and parses the schedule as data. It never runs the schedule's scripts. Verified wrappers for embedded players, YouTube, VK, Webcaster, and direct HLS streams are unwrapped to avoid loading the source site's advertising layout. Unrecognized providers retain their original page in the protected player.

Embedded providers load in real child iframes, matching their published embed requirements; full provider pages retain top-level navigation. Each stream runs in a sandboxed Electron WebContentsView with Node integration disabled, context isolation and web security enabled, and no application bridge. EasyList, EasyPrivacy, and supplemental site filters block network requests and hide matching ad elements. Filter lists ship with the app and update automatically from easylist.to when the cached lists are older than four days. A failed update keeps the existing protection active. Protection details shows the list status and blocked request count.

Popups, downloads, external app launches, and permissions other than fullscreen are blocked. Top-level navigation stays on the chosen provider's hostname; legitimate cross-host redirects may require a different feed. Player cookies and storage use an in-memory partition and disappear when you quit. The app stores only the last schedule and filter lists on disk; it does not store viewing history.

Stream providers still receive your IP address and playback requests. Ads embedded into the video itself, anti-blocker checks, DRM, login requirements, region restrictions, expired links, and provider outages are not removed or bypassed. Some pages may retain unmatched overlays. The app cannot guarantee that every third-party source works, and it does not host or redistribute streams. This is an independent client, unaffiliated with OnHockey or the NHL.

## Verification and builds

```sh
npm test                # Parsing, categories, wrappers, unsafe URL rejection
npm run test:desktop   # Real Electron + upstream listings + public HLS test feed
npm run test:layout    # Actual 16:9 / 4:3 media metadata, resizing, theater, no player scrollbars
npm run test:profiler  # Real hidden playback, ratings, isolation, cache and cleanup
npm run test:scores    # Score panel, dates, offline states, window widths (system Chromium)
npm run test:refresh   # Full refresh, changed links, shortcuts, theater, cancellation, offline recovery
npm run build          # Unpacked Linux app
npm run appimage       # Portable Linux AppImage
npm audit --omit=dev   # Runtime dependency audit
```

Desktop verification needs a graphical session and internet access. It checks NHL as the default, search and league navigation, source selection, iframe hosting for embed-only providers, player isolation, actual blocked ad/tracker requests, HLS playback, cached listings when offline, and player cleanup. The HLS playback check uses Mux's public Big Buck Bunny test stream; it does not claim to verify all live hockey feeds.

See [THIRD_PARTY.md](THIRD_PARTY.md) for filter-list attribution.
