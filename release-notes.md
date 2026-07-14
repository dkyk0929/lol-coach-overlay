## LoL Coach Overlay v1.9.4 - Stricter Freshness Filter for Coaching Tips

### Bug Fixes
- Tightened the relevance filter that catches stale AI coaching tips (the delay between sending game state and getting a response could make a tip outdated by the time it's spoken):
  - Any "in Xs" claim of 5 seconds or less is now rejected outright — even a fast response plus render/TTS time makes that window meaningless by the time you hear it.
  - The "already happened" check now applies to any absolute-time mention, not just Dragon/Baron.
  - Void Grubs and Rift Herald mentions are now rejected once their one-time window has permanently closed.
  - New: any named champion's life/death status is cross-checked against live game data — if the AI says someone's dead/respawning but they're actually alive now (or vice versa), or quotes a respawn timer that doesn't match reality, the tip is dropped instead of spoken.

## LoL Coach Overlay v1.9.3 - Matchup Research Indicator in Battle Log

### New Features
- The battle log now shows a small teal ✦ next to the champion name on any game where the web-search-grounded matchup brief successfully loaded, so you can tell at a glance whether that game's coaching was grounded in live research or general knowledge. Hover it for details. Games recorded before this update won't show the icon since the data wasn't tracked yet.

## LoL Coach Overlay v1.9.2 - ARAM Detection Fix & Info Window Crop Fix

### Bug Fixes
- Fixed ARAM games sometimes being tracked as Summoner's Rift for the whole match. ARAM detection only ever checked `gameMode` once, on the very first data tick after connecting — if that first payload (most likely right when connecting mid-game, e.g. after an app restart) had `gameMode` not yet populated, the app permanently misdetected the game as SR with no retry. Now checks every tick and self-heals as soon as `gameMode` comes back as `ARAM`.
- Fixed the Info & Links window being cropped — its fixed height was never increased when the Hotkeys section was added, so content was hard-clipped at the window edge with no way to scroll. Window resized and a scroll fallback added so this can't silently clip again.

## LoL Coach Overlay v1.9.1 - Matchup Research Status Indicator

### Bug Fixes
- The web-search-grounded matchup brief (added in 1.9.0) gave no indication of whether it succeeded or failed — main.js swallowed every failure internally and returned null either way, so the player had no way to know if coaching was actually grounded in live search or fell back to general knowledge. Now shows a quiet status line ("Matchup research loaded" or "unavailable — using general knowledge") in the focus text and recent alerts log once it resolves.

## LoL Coach Overlay v1.9.0 - Web-Search-Grounded Matchup Brief & Verified Item Recipes

### Bug Fixes
- Fixed the AI recommending a nonexistent item build path ("Lost Chapter into Rod of Ages") by adding an explicit guardrail instruction telling the AI never to state a specific recipe unless certain.

### New Features
- **Automated, always-current item recipes**: the AI now pulls real build paths for 170+ items directly from Riot's official Data Dragon feed instead of guessing or relying on a hand-typed list. Cached locally, auto-refreshes whenever the patch changes — replaces the old manually-curated (and partly wrong) recipe list entirely.
- **Web-search-grounded matchup brief**: once per game, right after you lock in, the app now asks the AI to research your specific matchup (champion vs champion, role) and itemization using live web search, then caches that grounded answer and feeds it into every fast in-game coaching tip for the rest of the match. Works for both Anthropic and Gemini providers.

## LoL Coach Overlay v1.8.4 - Fixed Stale Objective Countdown Alerts

### Bug Fixes
- Fixed "spawns in 15s"-style warnings (Scuttler, Dragon, Void Grubs, Rift Herald, Baron) firing with a stale hardcoded countdown after the objective had already spawned — this happened when a poll tick landed late (game hiccup, background throttling, etc.) and jumped past the real spawn moment while still under the "too stale to show" cutoff. Each pre-spawn warning now checks the actual spawn time and skips itself if the objective is already up, letting the "UP" alert take over instead.

## LoL Coach Overlay v1.8.3 - Update Checker

### New Features
- **Update checker**: on launch, the app now checks GitHub for the latest release and shows a popup ("A new version is available: vX.X.X — you have vX.X.X") with "Download Update" / "Later" buttons if you're behind. Fails silently if offline so it never blocks startup.

## LoL Coach Overlay v1.8.2 - Timer Fixes & Smarter Jungler/Recall Tracking

### Bug Fixes
- Fixed duplicate Dragon/Baron "spawns in Xs" alerts firing twice for the first spawn of each (checkRespawnAlerts vs. TIMELINE_ALERTS overlap).
- Fixed missing-laner detection being silently disabled — the added enemy-visibility tracker relied on CS/level/HP/items, which the Live Client API reports regardless of true fog-of-war visibility, so it never actually detected "missing." Removed it and restored working timeout thresholds.
- Fixed Rift Herald despawn time listed as 19:30 in AI game-rules context; correct value is 19:45.
- Fixed Elder Dragon respawn timer running 60s fast — it now correctly adds 6 minutes (not 5) after Dragon Soul is claimed.
- Fixed the all-in situational badge for Jungle role — it was comparing the enemy jungler against themselves (since "my position" resolves to JUNGLE, matching the same player used for the jungler-safety check), making the badge meaningless. Now hidden for Jungle since there's no lane-opponent concept to base it on.

### New Features
- **Enemy recall detection**: a new item appearing on any enemy (only possible at base) now triggers an immediate alert — sharper jungler "recalled, ward before they return" warnings and proactive "recalled — push the wave" alerts for other lanes, instead of waiting on a blind timeout.
- **Objective-proximity jungler heads-up**: when the enemy jungler hasn't been confirmed in 25+ seconds and Dragon/Baron/Void Grubs/Rift Herald is about to spawn, the app now warns that they're likely heading there.
- **Manual lane pings (F5/F6/F7/F8)**: press to confirm you've personally spotted the enemy Top/Mid/Bot/Support on your own screen, resetting their missing-laner timer — same idea as the existing F9 jungler ping, since the API has no real vision data to draw from.
- AI coaching prompt now includes a "recently recalled" status line so the AI can factor tempo/recall windows into its advice.
- Added a Hotkeys reference section to the Info panel.

## LoL Coach Overlay v1.7.14 - Patch 26.13 Correction & Synchronization

Synchronized objective timers, champion data, and items with League of Legends **Patch 26.13 (released June 24, 2026)**.

### Core Changes

- **Objective System Update (Season 2026)**:
  - Removed Atakhan timer references and rules (the objective is removed in the 2026 season).
  - Synchronized Dragon timers (first spawn 5:00, respawn every 5:00) and Baron Nashor (spawns at 20:00, respawns 6 minutes after being killed).
  - Verified Void Grubs (spawn at 8:00) and Rift Herald (spawn at 15:00) rules remain active.
  - River Scuttle Crab spawn confirmed at 2:55.
- **Champion Synchronization**:
  - Added full support and ability timing details for the new champion **Locke, the Ashen Exorcist** (released June 24, 2026).
  - Updated recent champion releases: Mel, Yunara, Zaahen, and the Shyvana VGU.
- **Items & Balance**:
  - Documented Imperial Mandate's Patch 26.13 rework and Doran's Helm adjustments.
- **UI & Hygiene**:
  - Updated hardcoded version indicators in Info Overlay to `v1.7.13`.
