// Timeline alerts keyed by game time in seconds.
// Season 2026 / Patch 26.x timings.
const TIMELINE_ALERTS = [

  // ── Early game ──────────────────────────────────────────────────────────
  { time: 5,    msg: 'Focus CS — target 7+ per minute',                        cat: 'farming',   pri: 'normal'  },
  { time: 65,   msg: 'Freeze when behind — let them push into you',             cat: 'wave',      pri: 'normal'  },

  // ── Scuttlecrab (2:55) ──────────────────────────────────────────────────
  { time: 160,  spawnAt: 175,  msg: '⚠ Scuttler spawns in 15s — watch river',                cat: 'objective', pri: 'warning' },
  { time: 175,  msg: 'Scuttler up (2:55) — jungler heading to river',          cat: 'gank',      pri: 'warning' },
  { time: 190,  msg: '⚠ First gank window open — ward river bush now',        cat: 'vision',    pri: 'warning' },

  // ── Dragon (5:00) ───────────────────────────────────────────────────────
  { time: 270,  spawnAt: 300,  msg: '🐉 Dragon spawns in 30s — clear wave first',            cat: 'objective', pri: 'warning' },
  { time: 285,  spawnAt: 300,  msg: '🐉 Dragon spawns in 15s — position now',                cat: 'objective', pri: 'warning' },
  { time: 300,  msg: '🐉 DRAGON UP (5:00)',                                   cat: 'objective', pri: 'urgent'  },

  // ── Void Grubs (8:00) — spawns once, no respawn ──────────────────────────
  { time: 450,  spawnAt: 480,  msg: '🐛 Void Grubs spawn in 30s (8:00) — contest top side', cat: 'objective', pri: 'warning' },
  { time: 465,  spawnAt: 480,  msg: '🐛 Void Grubs spawn in 15s — top jungle position now', cat: 'objective', pri: 'warning' },
  { time: 480,  msg: '🐛 VOID GRUBS UP (8:00) — one chance, no respawn',     cat: 'objective', pri: 'urgent'  },

  // ── Mid game macro ───────────────────────────────────────────────────────
  { time: 600,  msg: 'Group for dragons — stop split pushing',                  cat: 'macro',     pri: 'normal'  },
  { time: 660,  msg: 'Ward river entrances and jungle paths',                   cat: 'vision',    pri: 'warning' },
  { time: 720,  msg: 'Slow-push before roaming — crash then move',             cat: 'wave',      pri: 'normal'  },

  // ── Rift Herald (15:00) — spawns once, despawns 19:45 ────────────────────
  { time: 870,  spawnAt: 900,  msg: '⚔ Rift Herald spawns in 30s (15:00) — watch top river', cat: 'objective', pri: 'warning' },
  { time: 885,  spawnAt: 900,  msg: '⚔ Rift Herald spawns in 15s — top side priority',       cat: 'objective', pri: 'warning' },
  { time: 900,  msg: '⚔ RIFT HERALD UP (15:00) — spawns once, use it fast',   cat: 'objective', pri: 'urgent'  },

  // ── Baron (20:00) ───────────────────────────────────────────────────────
  { time: 1150, spawnAt: 1200, msg: '🟣 Baron spawns in 50s — start warding Baron pit',       cat: 'objective', pri: 'warning' },
  { time: 1185, msg: 'Clear waves before Baron fight — no minion disadvantage', cat: 'wave',      pri: 'normal'  },
  { time: 1200, msg: '🟣 BARON NASHOR UP (20:00)',                             cat: 'objective', pri: 'urgent'  },

  // ── Late game ────────────────────────────────────────────────────────────
  { time: 1500, msg: 'Late game — never fight blind, always have vision first', cat: 'macro',     pri: 'normal'  },
  { time: 1800, msg: '30 min — one mistake ends the game, play clean',         cat: 'macro',     pri: 'normal'  },
]
