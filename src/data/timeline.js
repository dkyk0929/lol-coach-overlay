// Timeline alerts keyed by game time in seconds.
// Season 2026 / Patch 26.13 timings.
// NOTE: Void Grubs, Rift Herald, and Atakhan are REMOVED in Season 2026.
const TIMELINE_ALERTS = [

  // ── Early game ──────────────────────────────────────────────────────────
  { time: 5,    msg: 'Focus CS — target 7+ per minute',                        cat: 'farming',   pri: 'normal'  },
  { time: 65,   msg: 'Freeze when behind — let them push into you',             cat: 'wave',      pri: 'normal'  },

  // ── Scuttlecrab (2:55) ──────────────────────────────────────────────────
  { time: 160,  msg: '⚠ Scuttler spawns in 15s — watch river',                cat: 'objective', pri: 'warning' },
  { time: 175,  msg: 'Scuttler up (2:55) — jungler heading to river',          cat: 'gank',      pri: 'warning' },
  { time: 190,  msg: '⚠ First gank window open — ward river bush now',        cat: 'vision',    pri: 'warning' },

  // ── Dragon (5:00) ───────────────────────────────────────────────────────
  { time: 270,  msg: '🐉 Dragon spawns in 30s — clear wave first',            cat: 'objective', pri: 'warning' },
  { time: 285,  msg: '🐉 Dragon spawns in 15s — position now',                cat: 'objective', pri: 'warning' },
  { time: 300,  msg: '🐉 DRAGON UP (5:00)',                                   cat: 'objective', pri: 'urgent'  },

  // ── Mid game macro ───────────────────────────────────────────────────────
  { time: 600,  msg: 'Group for dragons — stop split pushing',                  cat: 'macro',     pri: 'normal'  },
  { time: 660,  msg: 'Ward river entrances and jungle paths',                   cat: 'vision',    pri: 'warning' },
  { time: 720,  msg: 'Slow-push before roaming — crash then move',             cat: 'wave',      pri: 'normal'  },

  // ── Baron (20:00) ───────────────────────────────────────────────────────
  { time: 1150, msg: '🟣 Baron spawns in 50s — start warding Baron pit',       cat: 'objective', pri: 'warning' },
  { time: 1185, msg: 'Clear waves before Baron fight — no minion disadvantage', cat: 'wave',      pri: 'normal'  },
  { time: 1200, msg: '🟣 BARON NASHOR UP (20:00)',                             cat: 'objective', pri: 'urgent'  },

  // ── Late game ────────────────────────────────────────────────────────────
  { time: 1500, msg: 'Late game — never fight blind, always have vision first', cat: 'macro',     pri: 'normal'  },
  { time: 1800, msg: '30 min — one mistake ends the game, play clean',         cat: 'macro',     pri: 'normal'  },
]
