# OnHockey Clean

A Linux desktop app for watching the streams listed on **onhockey.tv**, with NHL as the default view and separate International and Other Leagues sections. No account, app analytics, chat panels, or advertising placements.

## Run

Launch **OnHockey Clean** from your application menu, or run:

```sh
onhockey-clean
```

The portable build is `dist/OnHockey-Clean-0.1.0.AppImage`. If your system cannot mount AppImages, use `dist/linux-unpacked/onhockey-clean` or run the AppImage with `--appimage-extract-and-run`.

For development, use Node.js 22 or newer:

```sh
git clone https://github.com/bstar/onhockey-clean.git
cd onhockey-clean
npm ci
npm start
```

To create the portable Linux build, run `npm run appimage`.

## Watching

- Start in NHL, or switch to International (including Olympic games when listed) or Other Leagues.
- Search by team or league. “With feeds” hides games that don't have stream links yet.
- Click Watch to load the first listed source. Choose another source or Next source if a provider is offline, buffering, or broken.
- Theater expands the viewing area. Players can also offer their own fullscreen control. Escape exits fullscreen.
- The viewing area follows the video’s actual aspect ratio (including 4:3). Both embedded players and direct video fit inside the available space without cropping or player scrollbars; theater keeps source controls outside the picture.
- Close stops the player and releases the display sleep inhibitor.
- Listings refresh every five minutes without interrupting the selected stream. **Refresh everything**, **Refresh all** in the player toolbar, **Ctrl+R**, and **F5** fetch fresh listings, clear cached content, update ad/tracker filters, and recreate the current player. Your game, source, search, theater mode, and session cookies are preserved where available. A changed source URL is matched by provider; if that provider disappears, the first available feed opens with a notice. Close still cancels playback during a refresh.

Times are converted from the site's UTC clock to your system timezone. The source does not consistently supply calendar dates or authoritative live/end status, so the app shows the listed start time and feed availability rather than guessing whether a game is live. A link's presence does not guarantee playback. During a network error, the last successful schedule stays available with a visible cached-data notice and its original fetch time.

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
npm run test:refresh   # Full refresh, changed links, shortcuts, theater, cancellation, offline recovery
npm run build          # Unpacked Linux app
npm run appimage       # Portable Linux AppImage
npm audit --omit=dev   # Runtime dependency audit
```

Desktop verification needs a graphical session and internet access. It checks NHL as the default, search and league navigation, source selection, iframe hosting for embed-only providers, player isolation, actual blocked ad/tracker requests, HLS playback, cached listings when offline, and player cleanup. The HLS playback check uses Mux's public Big Buck Bunny test stream; it does not claim to verify all live hockey feeds.

See [THIRD_PARTY.md](THIRD_PARTY.md) for filter-list attribution.
