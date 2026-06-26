## LoL Coach Overlay v1.7.13 - Patch 26.13 Synchronization

Synchronized objective timers, champion data, and items with League of Legends **Patch 26.13 (released June 24, 2026)**.

### Core Changes

- **Objective System Update (Season 2026)**:
  - Removed all Void Grubs, Rift Herald, and Atakhan timer alerts and event handling (these objectives are removed in the 2026 season).
  - Synchronized Dragon timers (first spawn 5:00, respawn every 5:00) and Baron Nashor (spawns at 20:00, respawns 6 minutes after being killed).
  - River Scuttle Crab spawn confirmed at 2:55.
- **Champion Synchronization**:
  - Added full support and ability timing details for the new champion **Locke, the Ashen Exorcist** (released June 24, 2026).
  - Updated recent champion releases: Mel, Yunara, Zaahen, and the Shyvana VGU.
- **Items & Balance**:
  - Documented Imperial Mandate's Patch 26.13 rework and Doran's Helm adjustments.
- **UI & Hygiene**:
  - Cleaned up dead `RiftHeraldKill` event handlers and references.
  - Bumped internal versions displayed in Info Overlay to `v1.7.13`.
