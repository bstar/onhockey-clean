A simpler player with live NHL scores and automatic feed ratings.

- Unbranded interface with competition tabs and a right-hand scoreboard.
- Scores, period, clock, shots, start times, venues, broadcasts, and team W–L–OT records. Scores refresh every 10 seconds and follow the current NHL game day across midnight.
- Hidden, muted background checks measure feed resolution, startup, stalls, and dropped frames. Provisional ratings appear beside sources; checks run one at a time.
- Timestamp lag or distance behind the feed's live edge where measurable. Embedded players without reliable timing information show “Delay unknown.” These estimates may exclude upstream broadcast delay.
- Playback layout, full refresh, source switching, ad/tracker blocking, and offline listings are preserved.

### Downloads

- **Linux:** choose the `linux-x86_64.AppImage` for Intel/AMD PCs, or `linux-arm64.AppImage` for ARM64. Make it executable and launch it. If FUSE is unavailable, run it with `--appimage-extract-and-run`.
- **macOS:** choose `mac-arm64.dmg` for Apple Silicon, or `mac-x64.dmg` for Intel. Open the disk image and drag the app into Applications. ZIP downloads are also provided.
- **Windows:** use the `win-x64.exe` installer. A `win-x64.zip` portable build is also provided.

macOS builds are ad-hoc signed, not Apple-notarized. Windows builds are unsigned. macOS Gatekeeper or Windows SmartScreen may require explicit approval before the app will open. No publisher signing certificates are included in this release.

`SHA256SUMS` contains checksums for every download. Feed availability depends on third-party providers; short ratings are observations on the testing machine, not availability guarantees. Background checks use bandwidth for one additional feed.
