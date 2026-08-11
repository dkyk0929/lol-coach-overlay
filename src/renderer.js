// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const waitingScreen = $('waiting-screen')
const gameScreen    = $('game-screen')
const appEl         = $('app')

const MODE = new URLSearchParams(location.search).get('mode') === 'dashboard' ? 'dashboard' : 'bar'
const dashboardScreen = $('dashboard-screen')

if (MODE === 'dashboard') {
  appEl.classList.add('hidden')
  dashboardScreen.classList.remove('hidden')
}

function dualEl(id) {
  return MODE === 'dashboard' ? document.getElementById('dash-' + id) : document.getElementById(id)
}

// ── Dashboard feed ────────────────────────────────────────────────────────────
function renderFeedEntry({ msg, pri, time }) {
  const list = $('dash-feed-list')
  if (!list) return
  const row = document.createElement('div')
  row.className = `dash-feed-row pri-${pri}`
  const timeEl = document.createElement('span')
  timeEl.className = 'dash-feed-time'
  timeEl.textContent = fmtTime(time)
  const msgEl = document.createElement('span')
  msgEl.textContent = msg
  row.appendChild(timeEl)
  row.appendChild(msgEl)
  list.insertBefore(row, list.firstChild)   // newest at top
}

function renderFeedBacklog() {
  const list = $('dash-feed-list')
  if (!list) return
  list.innerHTML = ''
  // alertLogFull is oldest-first; rendering oldest-to-newest through
  // renderFeedEntry (which always inserts at the top) ends with newest on top.
  for (const entry of state.alertLogFull) renderFeedEntry(entry)
}

// ── Dashboard widget declutter ───────────────────────────────────────────────
async function initDashboardWidgets() {
  if (MODE !== 'dashboard') return
  const widgets = await window.lolCoach.getDashboardWidgets()
  applyDashboardWidgetVisibility(widgets)
  $('dash-widget-feed').checked       = widgets.feed
  $('dash-widget-objectives').checked = widgets.objectives
  $('dash-widget-csgold').checked     = widgets.csGold

  const save = () => {
    const next = {
      feed:       $('dash-widget-feed').checked,
      objectives: $('dash-widget-objectives').checked,
      csGold:     $('dash-widget-csgold').checked,
    }
    applyDashboardWidgetVisibility(next)
    window.lolCoach.saveDashboardWidgets(next)
  }
  $('dash-widget-feed').addEventListener('change', save)
  $('dash-widget-objectives').addEventListener('change', save)
  $('dash-widget-csgold').addEventListener('change', save)
}

function applyDashboardWidgetVisibility({ feed, objectives, csGold }) {
  $('dash-feed-panel').classList.toggle('hidden', !feed)
  $('dash-obj-panel').classList.toggle('hidden', !objectives)
  $('dash-cs-panel').classList.toggle('hidden', !csGold)
  // The stats row itself would otherwise sit there as an empty 90px strip
  // if both panels inside it are off.
  document.querySelector('.dash-stats-row').classList.toggle('hidden', !objectives && !csGold)
}

initDashboardWidgets()

if (MODE === 'dashboard') {
  $('dash-btn-tts').addEventListener('click', () => setTTSMuted(!ttsMuted))
  $('dash-btn-back').addEventListener('click', () => window.lolCoach.switchToBar())
  $('dash-btn-log').addEventListener('click', () => window.lolCoach.toggleBattleLog())
  $('dash-btn-ai').addEventListener('click', () => window.lolCoach.toggleAiSetup())
  $('dash-btn-info').addEventListener('click', () => window.lolCoach.toggleInfoWindow())
}

function applyAramPresentation() {
  dualEl('jg-last').textContent  = 'ARAM'
  dualEl('jg-threat').textContent = ''
  dualEl('drake-icon').textContent = '⚔'
  dualEl('ally-drakes').textContent = ''
  dualEl('enemy-drakes').textContent = ''
  dualEl('drake-sep').textContent = ''
  dualEl('obj-countdown').textContent = ''
  if (MODE === 'dashboard') {
    $('dash-sep-1').textContent = ''
    $('dash-sep-2').textContent = ''
  }
}

// ── Opacity system ───────────────────────────────────────────────────────────
let opacityValue = parseInt(localStorage.getItem('opacityValue') ?? '85')

function applyOpacity(val) {
  if (val !== undefined) opacityValue = val
  const active = opacityValue / 100
  const dimmed = Math.max(0.12, active * 0.55)
  document.documentElement.style.setProperty('--active-opacity', active)
  document.documentElement.style.setProperty('--dimmed-opacity', dimmed)
  const btn = $('btn-opacity')
  if (btn) btn.textContent = `${opacityValue}%`
  const valEl = $('opacity-value')
  if (valEl) valEl.textContent = `${opacityValue}%`
  const slider = $('opacity-slider')
  if (slider) slider.value = opacityValue
  localStorage.setItem('opacityValue', opacityValue)
}

let opacityPanelOpen = false
function toggleOpacityPanel() {
  opacityPanelOpen = !opacityPanelOpen
  const panel = $('opacity-panel')
  const btn   = $('btn-opacity')
  panel.classList.toggle('hidden', !opacityPanelOpen)
  btn.classList.toggle('open', opacityPanelOpen)
}

// ── TTS / Voice system ───────────────────────────────────────────────────────
let ttsMuted = false
let bestVoice = null

function initVoice() {
  const pick = () => {
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return
    // Prefer neural/natural online voices first
    const natural = voices.find(v => /Natural|Online/i.test(v.name) && v.lang.startsWith('en'))
    const enUS    = voices.find(v => v.lang === 'en-US')
    const enAny   = voices.find(v => v.lang.startsWith('en'))
    bestVoice = natural || enUS || enAny || voices[0]
  }
  pick()
  window.speechSynthesis.onvoiceschanged = pick
}

initVoice()

function sanitizeForTTS(text) {
  return text
    .replace(/\brespawn(s|ed|ing)?\b/gi, 'back up')
    .replace(/\brespawned\b/gi, 'back up')
    .replace(/\bjg\b/gi, 'jungle')
    .replace(/\badc\b/gi, 'marksman')
    .replace(/\bcs\b/gi, 'CS')
    .replace(/\bkda\b/gi, 'K D A')
    .replace(/\bbaron\b/gi, 'Baron')
    .replace(/\brift herald\b/gi, 'Rift Herald')
    .replace(/[⚠✅📍🗡🔥🛡👁💀🐉🟣⚔⚡✦●—·]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function speak(text, urgent = false) {
  if (ttsMuted || !window.speechSynthesis) return
  if (urgent) window.speechSynthesis.cancel()
  const utt   = new SpeechSynthesisUtterance(sanitizeForTTS(text))
  utt.voice   = bestVoice
  utt.rate    = 0.92
  utt.pitch   = 1.0
  utt.volume  = 0.95
  window.speechSynthesis.speak(utt)
}

function isCoachStatementRelevant(text, apiElapsedTime = 0) {
  if (state.isARAM) return true;

  const lowerText = text.toLowerCase();
  
  // Parse relative time mentions, e.g. "in 30s", "in 30 seconds", "in 1 minute", "in 1m"
  const relativeTimeRegex = /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m)\b/gi;
  let match;
  let mentionedTimeSec = null;

  while ((match = relativeTimeRegex.exec(lowerText)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('m')) {
      mentionedTimeSec = value * 60;
    } else {
      mentionedTimeSec = value;
    }
    break; // Only check the first relative time mention
  }

  // A window this tight is unusable by the time it's rendered and spoken —
  // reject outright regardless of how fast the API call itself was, since
  // rendering + TTS add their own real-world delay on top of the round trip.
  if (mentionedTimeSec !== null && mentionedTimeSec <= 5) {
    console.log(`[Relevance Filter] Rejected — window too tight to act on (${mentionedTimeSec}s): "${text}"`);
    return false;
  }

  // If a short relative time is mentioned (e.g. under 45 seconds),
  // and the API request itself took longer than 10 seconds,
  // reject if the API latency is significant relative to the time mentioned.
  if (mentionedTimeSec !== null && mentionedTimeSec <= 45 && apiElapsedTime > 10) {
    console.log(`[Relevance Filter] Rejected short time advice due to API latency (${Math.round(apiElapsedTime)}s): "${text}"`);
    return false;
  }

  // Parse absolute times, e.g. "at 20:00", "at 15:30"
  const absoluteTimeRegex = /\b(\d{1,2}):(\d{2})\b/gi;
  let absMatch = absoluteTimeRegex.exec(lowerText);
  let mentionedAbsoluteSec = null;
  if (absMatch) {
    const mins = parseInt(absMatch[1], 10);
    const secs = parseInt(absMatch[2], 10);
    mentionedAbsoluteSec = mins * 60 + secs;
  }

  // Generic "already happened" check — applies to ANY absolute time mention,
  // not just Dragon/Baron. If the AI names a clock time already in the past,
  // it's stale no matter what it's talking about.
  if (mentionedAbsoluteSec !== null && state.gameTime > mentionedAbsoluteSec + 5) {
    console.log(`[Relevance Filter] Rejected — absolute time ${fmtTime(mentionedAbsoluteSec)} has already passed: "${text}"`);
    return false;
  }

  if (state.isARAM) {
    const invalidAramWords = /\b(dragon|drake|baron|grub|grubs|herald|scuttle|scuttler|jungle|jungler|roam|roaming)\b/i
    if (invalidAramWords.test(lowerText)) {
      console.log(`[Relevance Filter] Rejected ARAM invalid objective/jungle advice: "${text}"`)
      return false
    }
  }

  const hasDragon = lowerText.includes('dragon') || lowerText.includes('drake');
  const hasBaron = lowerText.includes('baron');
  const hasGrubs = lowerText.includes('grub');
  const hasHerald = lowerText.includes('herald');

  // Void Grubs and Rift Herald are one-time objectives with a hard despawn —
  // once that window's closed, any mention of them is stale by definition.
  if (hasGrubs && state.gameTime > 495) {
    console.log(`[Relevance Filter] Rejected — Void Grubs window already closed: "${text}"`);
    return false;
  }
  if (hasHerald && state.gameTime > 915) {
    console.log(`[Relevance Filter] Rejected — Rift Herald window already closed: "${text}"`);
    return false;
  }

  // Generic champion life/death staleness — catches any named champion whose
  // dead/alive/respawning status the AI got wrong by the time the response
  // came back, not just Dragon/Baron. Live status comes from state.allPlayers,
  // which the poll loop keeps fresh independent of the AI round trip.
  const deathWords  = /\b(dead|died|dying|killed|respawn(?:s|ing|ed)?)\b/;
  const aliveWords  = /\b(alive|respawned|back (?:up|in lane)|returned)\b/;
  for (const p of state.allPlayers ?? []) {
    const champLower = p.championName?.toLowerCase();
    if (!champLower || !lowerText.includes(champLower)) continue;

    if (deathWords.test(lowerText) && !aliveWords.test(lowerText) && !p.isDead) {
      console.log(`[Relevance Filter] Rejected — ${p.championName} is alive now, but AI said: "${text}"`);
      return false;
    }
    if (aliveWords.test(lowerText) && p.isDead) {
      console.log(`[Relevance Filter] Rejected — ${p.championName} is dead now, but AI said: "${text}"`);
      return false;
    }
    // If a respawn timer was quoted, check it against the real one.
    if (p.isDead && mentionedTimeSec !== null && Math.abs((p.respawnTimer ?? 0) - mentionedTimeSec) > 10) {
      console.log(`[Relevance Filter] Rejected — ${p.championName} respawns in ${Math.round(p.respawnTimer ?? 0)}s, but AI said ${mentionedTimeSec}s: "${text}"`);
      return false;
    }
  }

  if (hasDragon) {
    const dragonLeft = state.nextDragonSpawn - state.gameTime;

    if (mentionedTimeSec !== null) {
      if (dragonLeft <= 0) {
        console.log(`[Relevance Filter] Rejected dragon advice: dragon is already alive, but AI said: "${text}"`);
        return false;
      }
      if (Math.abs(dragonLeft - mentionedTimeSec) > 15) {
        console.log(`[Relevance Filter] Rejected dragon advice: dragon spawns in ${Math.round(dragonLeft)}s, but AI said relative ${mentionedTimeSec}s: "${text}"`);
        return false;
      }
    }

    // Already-passed case is caught by the generic absolute-time check above.
    if (mentionedAbsoluteSec !== null && Math.abs(state.nextDragonSpawn - mentionedAbsoluteSec) > 20) {
      console.log(`[Relevance Filter] Rejected dragon advice: next spawn is at ${fmtTime(state.nextDragonSpawn)}, but AI said absolute ${fmtTime(mentionedAbsoluteSec)}: "${text}"`);
      return false;
    }
  }

  if (hasBaron) {
    const baronLeft = state.nextBaronSpawn - state.gameTime;

    if (mentionedTimeSec !== null) {
      if (baronLeft <= 0) {
        console.log(`[Relevance Filter] Rejected baron advice: baron is already alive, but AI said: "${text}"`);
        return false;
      }
      if (Math.abs(baronLeft - mentionedTimeSec) > 20) {
        console.log(`[Relevance Filter] Rejected baron advice: baron spawns in ${Math.round(baronLeft)}s, but AI said relative ${mentionedTimeSec}s: "${text}"`);
        return false;
      }
    }

    // Already-passed case is caught by the generic absolute-time check above.
    if (mentionedAbsoluteSec !== null) {
      if (Math.abs(state.nextBaronSpawn - mentionedAbsoluteSec) > 20) {
        console.log(`[Relevance Filter] Rejected baron advice: next spawn is at ${fmtTime(state.nextBaronSpawn)}, but AI said absolute ${fmtTime(mentionedAbsoluteSec)}: "${text}"`);
        return false;
      }
    }
  }

  return true;
}

function setTTSMuted(muted, notify = true) {
  ttsMuted = muted
  const btn = $('btn-tts')
  if (muted) {
    btn.textContent = '🔇'
    btn.classList.add('muted')
    window.speechSynthesis.cancel()
  } else {
    btn.textContent = '🔊'
    btn.classList.remove('muted')
  }
  if (MODE === 'dashboard') {
    const dashBtn = $('dash-btn-tts')
    dashBtn.textContent = muted ? '🔇 VOICE OFF' : '🔊 VOICE ON'
    dashBtn.classList.toggle('muted', muted)
  }
  if (notify) window.lolCoach.notifyTtsMuted(muted)
}

// Control panel can toggle TTS remotely
window.lolCoach.onSetTtsMuted((muted) => setTTSMuted(muted, false))

$('btn-tts').addEventListener('click', () => setTTSMuted(!ttsMuted))

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'm') { e.preventDefault(); setTTSMuted(!ttsMuted) }
})

// ── State ───────────────────────────────────────────────────────────────────
let state = freshState()

function freshState() {
  return {
    running: false,
    gameTime: 0,
    activeName: '',
    allPlayers: [],
    prevLevel: 0,
    prevItemCount: 0,
    shownTimeline: new Set(),
    respawnAlerted: new Set(),
    seenEventIds: new Set(),
    currentFocus: '',
    alertLog: [],
    myChampion: null,
    myPosition: null,
    cs: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    currentGold: 0,
    allyTeam: [],
    enemyTeam: [],
    allyDrakes: 0,
    enemyDrakes: 0,
    justDied: false,
    lastAICallAt: -999,
    aiEnabled: false,
    gamePlanFired: false,
    matchupBriefFired: false,
    matchupBrief: null,
    lastVisionReminderAt: -999,
    gamePlanShowing: false,
    enemyDeadPrev: {},
    enemyLastSeen: {},
    missingAlertAt: {},
    enemyItemSets: {},
    recallAlertedAt: {},
    objJgAlertedAt: {},
    csDeltaHistory: [],
    nextDragonSpawn: 300,
    nextBaronSpawn: 1200,
    isARAM: false,
    unsupportedMode: false,
    aiMessageAt: -999,
    gameResult: null,
    alertLogFull: [],
    targetCS: 7.0,
    recentGameEvents: [],
    roamAlerts: new Set(),
    laneOpponentWasDead: false,
    opponentPrevItems: [],
    jungler: {
      name: null, champion: null, level: 1,
      isDead: false, lastSeenTime: 0, lastSeenSide: null,
      unseenAlertAt: 0,
    },
  }
}

// ── Mode-switch state handoff ────────────────────────────────────────────────
// Fields that can't be cheaply rebuilt from the next live-client-data tick —
// see the design doc's "State handoff" section for why this list exists.
// Anything added to freshState() later that needs to survive a mode switch
// must be added here too — it will not happen automatically.
//
// This includes every per-event dedup tracker, not just display values: if
// `seenEventIds`/`respawnAlerted`/`shownTimeline`/`roamAlerts` don't survive,
// the very next game-data tick after a switch replays every event of the
// game from scratch (checkEvents/checkTimeline/checkRespawnAlerts all guard
// on these) — double-counting drakes, re-firing "DRAGON BACK UP" as a fresh
// urgent alert, and re-triggering "you just died" AI coaching, all instantly.
// Electron's IPC uses the structured clone algorithm, which (unlike JSON)
// natively supports Set and Map, so these can be captured as-is.
function captureHandoffState() {
  return {
    running:           state.running,
    activeName:        state.activeName,
    alertLog:          state.alertLog,
    alertLogFull:      state.alertLogFull,
    csDeltaHistory:    state.csDeltaHistory,
    jungler:           state.jungler,
    kills:             state.kills,
    deaths:            state.deaths,
    assists:           state.assists,
    targetCS:          state.targetCS,
    matchupBrief:      state.matchupBrief,
    matchupBriefFired: state.matchupBriefFired,
    gamePlanFired:     state.gamePlanFired,
    allyTeam:          state.allyTeam,
    enemyTeam:         state.enemyTeam,
    isARAM:            state.isARAM,
    myChampion:        state.myChampion,
    myPosition:        state.myPosition,
    gameResult:        state.gameResult,
    allyDrakes:        state.allyDrakes,
    enemyDrakes:       state.enemyDrakes,
    nextDragonSpawn:   state.nextDragonSpawn,
    nextBaronSpawn:    state.nextBaronSpawn,
    aiEnabled:         state.aiEnabled,
    seenEventIds:      state.seenEventIds,
    respawnAlerted:    state.respawnAlerted,
    shownTimeline:     state.shownTimeline,
    roamAlerts:        state.roamAlerts,
    enemyLastSeen:     state.enemyLastSeen,
    missingAlertAt:    state.missingAlertAt,
    objJgAlertedAt:    state.objJgAlertedAt,
    recallAlertedAt:   state.recallAlertedAt,
    gameTime:          state.gameTime,
    cs:                state.cs,
    currentGold:       state.currentGold,
  }
}

function applyHandoffState(data) {
  if (!data) return
  Object.assign(state, data)
  // Object.assign restores `state.running` directly, bypassing the
  // waiting→game screen swap that normally only happens inside the
  // `if (!state.running)` branch of onGameData (renderer.js:388-397) — do
  // it here instead, or the new window would sit on its waiting screen
  // forever while state quietly keeps updating underneath it.
  if (state.running) {
    waitingScreen.classList.add('hidden')
    gameScreen.classList.remove('hidden')
    appEl.classList.add('dimmed')
  }
  if (state.isARAM) applyAramPresentation()
}

window.lolCoach.onCaptureState(() => {
  window.lolCoach.sendCapturedState(captureHandoffState())
})

window.lolCoach.onRestoreState((data) => {
  applyHandoffState(data)
  if (MODE === 'dashboard') renderFeedBacklog()
})


// ── Hover to un-dim ──────────────────────────────────────────────────────────
// Window is always interactive — no pass-through toggling needed.
// Just remove the dim when the cursor enters, re-apply when it leaves.
document.addEventListener('mouseenter', () => appEl.classList.remove('dimmed'))
document.addEventListener('mouseleave', () => { if (state.running) appEl.classList.add('dimmed') })

// ── Icon grid buttons ─────────────────────────────────────────────────────────
$('btn-log').addEventListener('click',     () => window.lolCoach.toggleBattleLog())
$('btn-coffee').addEventListener('click',  () => window.lolCoach.openUrl('https://buymeacoffee.com/bdannykimt'))
$('btn-opacity').addEventListener('click', () => toggleOpacityPanel())
$('btn-info').addEventListener('click',    () => window.lolCoach.toggleInfoWindow())
$('btn-dashboard-mode').addEventListener('click', () => window.lolCoach.switchToDashboard())

async function initDashboardModeButton() {
  if (MODE !== 'bar') return
  const { hasSecondDisplay } = await window.lolCoach.getDisplayInfo()
  if (hasSecondDisplay) $('btn-dashboard-mode').classList.remove('hidden')
}
initDashboardModeButton()

// Opacity slider
$('opacity-slider').addEventListener('input', (e) => applyOpacity(parseInt(e.target.value)))
// Close opacity panel when clicking outside it
document.addEventListener('click', (e) => {
  if (opacityPanelOpen && !$('opacity-panel').contains(e.target) && e.target !== $('btn-opacity')) {
    toggleOpacityPanel()
  }
})

// ── Window controls ───────────────────────────────────────────────────────────
$('btn-minimize').addEventListener('click', () => window.lolCoach.minimizeWindow())
$('btn-close').addEventListener('click',    () => window.lolCoach.closeWindow())

// ── Back button ───────────────────────────────────────────────────────────────
const backBtn = $('back-btn')
backBtn.addEventListener('click', () => {
  gameScreen.classList.add('hidden')
  waitingScreen.classList.remove('hidden')
  backBtn.classList.add('hidden')
  appEl.classList.remove('dimmed')
})

// ── AI setup popup ────────────────────────────────────────────────────────────
function setAiActive(active) {
  state.aiEnabled = active
  const btn = $('btn-ai')
  if (active) {
    btn.classList.add('active')
    btn.title = 'AI Coaching active — click to manage'
  } else {
    btn.classList.remove('active')
    btn.title = 'Set up AI Coaching'
  }
  if (MODE === 'dashboard') {
    const dashBtn = $('dash-btn-ai')
    if (active) {
      dashBtn.classList.add('active')
      dashBtn.title = 'AI Coaching active — click to manage'
    } else {
      dashBtn.classList.remove('active')
      dashBtn.title = 'Set up AI Coaching'
    }
  }
}

async function initApiKeyUI() {
  const hasKey = await window.lolCoach.hasApiKey()
  setAiActive(hasKey)
}

$('btn-ai').addEventListener('click', () => window.lolCoach.toggleAiSetup())
window.lolCoach.onAiKeySaved(() => setAiActive(true))

initApiKeyUI()
applyOpacity()
window.lolCoach.getVersion().then(v => {
  const el = document.querySelector('.waiting-version')
  if (el) el.textContent = `v${v}`
})

// ── Window controls already wired above in controls hover zone ───────────────

// ── IPC: game data ────────────────────────────────────────────────────────────
window.lolCoach.onGameData((data) => {
  if (!data?.gameData) return

  const { gameData, activePlayer, allPlayers, events } = data

  if (!state.running) {
    const aiEnabled  = state.aiEnabled
    state            = freshState()
    state.running    = true
    state.aiEnabled  = aiEnabled
    state.activeName = activePlayer.summonerName
    waitingScreen.classList.add('hidden')
    gameScreen.classList.remove('hidden')
    appEl.classList.add('dimmed')
    if (MODE === 'dashboard') renderFeedBacklog()   // clears the DOM list — alertLogFull is empty again
  }

  const isAramDetected = (
    gameData.gameMode?.toUpperCase().includes('ARAM') ||
    gameData.mapName?.toLowerCase().includes('howling') ||
    gameData.mapName?.toLowerCase().includes('map12') ||
    gameData.mapNumber === 12 ||
    (allPlayers && allPlayers.length >= 8 && allPlayers.every(p => !p.position || p.position === 'NONE' || p.position === ''))
  )

  if (!state.isARAM && isAramDetected) {
    state.isARAM = true
    applyAramPresentation()
  }

  // Anything that isn't ARAM or modern Summoner's Rift (e.g. League Classic,
  // which uses old-school objective/item rules we don't track) gets disabled
  // rather than risk confidently giving wrong advice. Only acts on a positive
  // detection — a blank gameMode on an early tick never triggers this, so a
  // real SR/ARAM game can't get falsely locked out by incomplete first-tick data.
  if (!state.unsupportedMode && !state.isARAM && gameData.gameMode && gameData.gameMode !== 'CLASSIC') {
    state.unsupportedMode = true
    console.log('Unsupported game mode detected, disabling tracking:', gameData.gameMode, gameData.mapName, gameData.mapNumber)
    gameScreen.classList.add('hidden')
    waitingScreen.classList.remove('hidden')
    const sub = document.querySelector('.waiting-sub')
    if (sub) sub.textContent = `Unsupported mode (${gameData.gameMode}) — coaching disabled`
    const focusEl = dualEl('focus-text')
    focusEl.textContent = `Unsupported mode (${gameData.gameMode}) — coaching disabled`
    focusEl.style.color = '#5A6A7A'
  }
  if (state.unsupportedMode) return

  state.gameTime   = gameData.gameTime
  state.allPlayers = allPlayers
  state.currentGold = activePlayer.currentGold ?? 0

  if (state.gamePlanShowing && gameData.gameTime > 15) {
    state.gamePlanShowing = false
    window.lolCoach.dismissCenterNotif()
  }

  const me      = findMe(allPlayers, activePlayer.summonerName)
  const cs      = me?.scores?.creepScore ?? 0
  const kills   = me?.scores?.kills      ?? 0
  const deaths  = me?.scores?.deaths     ?? 0
  const assists = me?.scores?.assists    ?? 0
  const level   = activePlayer.level ?? 1
  const items   = me?.items ?? []
  const prevLevel = state.prevLevel

  state.cs      = cs
  state.kills   = kills
  state.deaths  = deaths
  state.assists = assists
  state.level   = level
  if (me?.championName) state.myChampion = me.championName
  if (me?.position)     state.myPosition = me.position

  // Capture team comps once on game start — then fire game plan
  if (!state.allyTeam.length && me?.team) {
    state.allyTeam  = allPlayers.filter(p => p.team === me.team).map(p => `${p.championName}(${p.position})`)
    state.enemyTeam = allPlayers.filter(p => p.team !== me.team).map(p => `${p.championName}(${p.position})`)
    // Feature 2: game plan AI call fires after team comps are known
    if (state.aiEnabled && !state.gamePlanFired) {
      state.gamePlanFired = true
      requestGamePlan()
    }
  }

  updateCS(gameData.gameTime, cs, me)
  updateGoldDiff(me, allPlayers)
  checkEvents(events?.Events ?? [], activePlayer.summonerName, allPlayers, me?.team)
  checkPowerSpikes(level, prevLevel, items, state.prevItemCount)
  checkEnemyPushWindow(allPlayers, me?.team, me, gameData.gameTime)

  if (!state.isARAM) {
    updateDrakeDisplay()
    checkTimeline(gameData.gameTime)
    checkRespawnAlerts(gameData.gameTime)
    checkWaveHints(gameData.gameTime)
    updateJungler(gameData.gameTime, allPlayers, me?.team)
    checkEnemyRecalls(allPlayers, me?.team, gameData.gameTime, state.myPosition)
    checkMissingLaners(allPlayers, me?.team, me, gameData.gameTime)
    checkAllinWindow(level, me, allPlayers, gameData.gameTime)
    updateObjectiveCountdown(gameData.gameTime)

    const opponent = allPlayers.find(p =>
      p.team !== me?.team &&
      p.position === state.myPosition &&
      p.position !== 'JUNGLE'
    )
    if (opponent) {
      checkRoamWindows(me, opponent, gameData.gameTime)
    }

    const pos = state.myPosition
    if (gameData.gameTime < 300 && pos !== 'UTILITY' && pos !== 'JUNGLE') updateEarlyFocus(gameData.gameTime, cs)
  }

  // Flush any non-urgent hint that was queued while AI message lock was active
  if (pendingFocusHint && state.gameTime - state.aiMessageAt >= 15) {
    const p = pendingFocusHint
    pendingFocusHint = null
    setFocus(p.msg, false, p.color)
  }

  // Feature 3: Vision score reminder (not applicable in ARAM)
  if (!state.isARAM) checkVisionReminder(gameData.gameTime, me)

  // Respawn timer overrides coaching text while dead
  const respawn = me?.respawnTimer ?? 0
  if (respawn > 0) {
    const focusEl = dualEl('focus-text')
    focusEl.textContent = `💀 Respawn in ${Math.ceil(respawn)}s`
    focusEl.style.color = '#5A6A7A'
  }

  // AI coaching
  if (state.aiEnabled && respawn <= 0) {
    if (state.justDied) {
      state.justDied = false
      requestAICoaching('death')
    } else if (state.gameTime - state.lastAICallAt >= 45 && state.gameTime > 120) {
      requestAICoaching('periodic')
    }
  }
  if (state.justDied && respawn <= 0) state.justDied = false

  state.prevLevel     = level
  state.prevItemCount = items.length
})

window.lolCoach.onGameNotRunning(() => {
  if (state.running) {
    // Feature 5: Post-game recap — show before resetting
    showPostGameRecap()
  }
})

// Final events sent by main.js just before declaring game-not-running.
// Used to capture the GameEnd event (Win/Lose result) if it wasn't in the
// last game-data poll before the Live Client API shut down.
window.lolCoach.onFinalEvents((data) => {
  const events = data?.Events ?? []
  for (const ev of events) {
    if (ev.EventName === 'GameEnd' && ev.Result) {
      state.gameResult = ev.Result
    }
  }
})

// ── Feature 5: Post-game recap ───────────────────────────────────────────────
function showPostGameRecap() {
  state.running = false  // prevent re-trigger on repeated game-not-running events

  const duration = fmtTime(state.gameTime)
  const kda      = `${state.kills}/${state.deaths}/${state.assists}`
  const cspm     = state.gameTime > 60 ? (state.cs / (state.gameTime / 60)).toFixed(1) : '0.0'
  const resultTag = state.gameResult ? ` · ${state.gameResult.toUpperCase()}` : ''
  const modeTag   = state.isARAM ? ' · ARAM' : ` | Drakes: ${state.allyDrakes} vs ${state.enemyDrakes}`
  const recap     = `GG${resultTag} — KDA: ${kda} | CS/min: ${cspm}${modeTag} | ${duration}`

  const focusEl = dualEl('focus-text')
  focusEl.textContent = recap
  focusEl.style.color = state.gameResult === 'Win' ? '#1FD65F' : state.gameResult === 'Lose' ? '#FF3B3B' : '#C084FC'
  appEl.classList.remove('dimmed')
  backBtn.classList.remove('hidden')  // show ← back button

  window.lolCoach.saveGameResult({
    champion: state.myChampion, position: state.myPosition,
    kills: state.kills, deaths: state.deaths, assists: state.assists,
    cs: state.cs, gameTime: state.gameTime,
    allyDrakes: state.allyDrakes, enemyDrakes: state.enemyDrakes,
    result: state.gameResult,
    matchupResearchUsed: !!state.matchupBrief,
  })

  // Launch post-game analysis window
  if (state.gameTime > 300) {
    window.lolCoach.showPostGame({
      result:       state.gameResult,
      champion:     state.myChampion,
      position:     state.myPosition,
      kills:        state.kills,
      deaths:       state.deaths,
      assists:      state.assists,
      cs:           state.cs,
      cspm,
      gameTime:     state.gameTime,
      allyDrakes:   state.allyDrakes,
      enemyDrakes:  state.enemyDrakes,
      allyTeam:     state.allyTeam,
      enemyTeam:    state.enemyTeam,
      isARAM:       state.isARAM,
      alertLogFull: state.alertLogFull.slice(-30),
      matchupResearchUsed: !!state.matchupBrief,
    })
  }
}

// ── CS display ───────────────────────────────────────────────────────────────
function updateCS(gameTime, cs, me) {
  const el  = dualEl('cs-delta')
  const pos = state.myPosition

  if (pos === 'UTILITY') {
    // Support: show ward score instead
    const wards = Math.floor(me?.scores?.wardScore ?? 0)
    const expectedWards = (gameTime / 60) * 1.5
    el.textContent = `👁 ${wards}`
    el.style.color = wards >= expectedWards ? '#1FD65F' : '#C89B3C'
    dualEl('wave-trend').textContent = ''
    return
  }

  if (pos === 'JUNGLE') {
    // Jungle: lane CS pace is meaningless — show raw CS count
    if (gameTime > 90) {
      el.textContent = `${cs}`
      el.style.color = '#C8AA6E'
    } else {
      el.textContent = '—'; el.style.color = ''
    }
    dualEl('wave-trend').textContent = ''
    return
  }

  // Laners: existing delta vs pace
  if (gameTime > 90) {
    const target = state.targetCS || 7.0
    const delta = cs - Math.floor((gameTime / 60) * target)
    el.textContent = delta >= 0 ? `+${delta}` : String(delta)
    el.style.color = delta >= 0 ? '#1FD65F' : delta >= -15 ? '#C89B3C' : '#FF3B3B'
    state.csDeltaHistory.push({ t: gameTime, d: delta })
    if (state.csDeltaHistory.length > 30) state.csDeltaHistory.shift()
    updateWaveTrend(delta)

    // Add title / tooltip comparing with opponent and clarifying target pace
    const opponent = state.allPlayers.find(p => p.team !== me?.team && p.position === me?.position && p.position !== 'JUNGLE')
    if (opponent) {
      const oppCS = opponent.scores?.creepScore ?? 0
      const vsOpp = cs - oppCS
      const vsOppStr = vsOpp >= 0 ? `+${vsOpp}` : String(vsOpp)
      el.title = `CS vs Target Pace: ${delta >= 0 ? '+' : ''}${delta}\nCS vs Opponent (${opponent.championName}): ${vsOppStr}`
    } else {
      el.title = `CS vs Target Pace: ${delta >= 0 ? '+' : ''}${delta}`
    }
  } else {
    el.textContent = '—'; el.style.color = ''; el.title = ''
  }
}

function updateWaveTrend(current) {
  const el   = dualEl('wave-trend')
  const hist = state.csDeltaHistory
  if (!el || hist.length < 5) { if (el) el.textContent = ''; return }
  const prev  = hist[Math.max(0, hist.length - 5)].d
  const trend = current - prev
  if      (trend >= 2)  { el.textContent = '↑'; el.className = 'wave-up' }
  else if (trend <= -2) { el.textContent = '↓'; el.className = 'wave-down' }
  else                  { el.textContent = '';  el.className = '' }
}

// ── Gold diff ────────────────────────────────────────────────────────────────
function estimateGoldSpent(player) {
  return (player?.items ?? []).reduce((sum, i) => sum + (i.price ?? 0), 0)
}

function updateGoldDiff(me, allPlayers) {
  const el = dualEl('gold-diff')
  if (!me || state.gameTime < 90) { el.textContent = ''; return }

  const myTotal      = state.currentGold + estimateGoldSpent(me)
  const enemyLaner   = allPlayers.find(p => p.position === me.position && p.team !== me.team)
  if (!enemyLaner)   { el.textContent = ''; return }

  const diff = myTotal - estimateGoldSpent(enemyLaner)
  const abs  = Math.abs(diff)
  el.textContent = abs < 50 ? 'even' : (diff >= 0 ? `+${fmtg(abs)}` : `-${fmtg(abs)}`)
  el.style.color = diff > 200 ? '#1FD65F' : diff < -200 ? '#FF3B3B' : '#4A5A6A'
}

function fmtg(n) { return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(Math.round(n)) }

// ── Drake tracker ─────────────────────────────────────────────────────────────
function updateDrakeDisplay() {
  dualEl('ally-drakes').textContent  = state.allyDrakes
  dualEl('enemy-drakes').textContent = state.enemyDrakes
  const zone = MODE === 'dashboard' ? $('dash-drake-group') : $('drake-zone')
  zone.classList.toggle('soul-warning', state.enemyDrakes >= 3)
}

// ── Early game focus ─────────────────────────────────────────────────────────
function updateEarlyFocus(gameTime, cs) {
  if (gameTime < 90) { setFocus('Last hit every minion — 6 cs = 1 kill gold', false); return }
  const target = state.targetCS || 7.0
  const deficit = Math.floor((gameTime / 60) * target) - cs
  if      (deficit <= 5)  setFocus('CS on pace — keep it up!', false)
  else if (deficit <= 15) setFocus(`Last hit — ${deficit} CS behind pace`, false)
  else                    setFocus(`Farm focus — ${deficit} CS behind target`, true)
}

// Pending non-urgent hint to show once AI message lock expires
let pendingFocusHint = null

function setFocus(msg, urgent, color) {
  // Non-urgent hints don't overwrite an AI message for 15 seconds — queue instead of drop
  if (!urgent && state.gameTime - state.aiMessageAt < 15) {
    pendingFocusHint = { msg, color }
    return
  }
  pendingFocusHint = null
  const el = dualEl('focus-text')
  el.textContent = msg
  if (color) {
    el.style.color = color
  } else {
    el.style.color = urgent ? '#FF6B35' : '#C89B3C'
  }
  state.currentFocus = msg
}

// ── Jungler display ──────────────────────────────────────────────────────────
function setJunglerThreat(level) {
  if (MODE === 'dashboard') {
    const dot = dualEl('jg-threat')
    dot.classList.remove('jg-dead', 'jg-warning', 'jg-danger')
    if (level) dot.classList.add(`jg-${level}`)
    return
  }
  const el = $('jg-zone')
  el.classList.remove('jg-dead', 'jg-warning', 'jg-danger')
  if (level) el.classList.add(`jg-${level}`)
}

function renderJungler() {
  const j = state.jungler
  if (!j.name) return
  const lastEl = dualEl('jg-last')
  if (j.isDead) {
    lastEl.textContent = `${j.champion} 💀 dead`; lastEl.style.color = '#1FD65F'
  } else if (j.lastSeenSide === 'objective') {
    lastEl.textContent = `${j.champion} · last: obj`; lastEl.style.color = '#5A6A7A'
  } else if (j.lastSeenSide) {
    lastEl.textContent = `${j.champion} · last: ${j.lastSeenSide}`; lastEl.style.color = '#5A6A7A'
  } else {
    lastEl.textContent = `${j.champion} · untracked`; lastEl.style.color = '#5A6A7A'
  }
}

// ── Timeline alerts ──────────────────────────────────────────────────────────
// TIMELINE_ALERTS is defined in data/timeline.js (loaded before this script)
const ALERT_CATS = new Set(['objective'])

function checkTimeline(gameTime) {
  if (state.isARAM) return
  for (const alert of TIMELINE_ALERTS) {
    if (!state.shownTimeline.has(alert.time) && gameTime >= alert.time) {
      state.shownTimeline.add(alert.time)
      // Skip alerts more than 45s in the past — avoids firing stale objective
      // warnings when the overlay starts mid-game or state resets
      if (gameTime - alert.time > 45) continue
      // Skip pre-spawn countdowns ("spawns in 15s") if the objective has
      // already spawned by the time this tick runs (e.g. after a lagged/
      // delayed poll) — the hardcoded countdown text would otherwise claim
      // something is about to spawn when it's already up on the map.
      if (alert.spawnAt && gameTime >= alert.spawnAt) continue

      let msg = alert.msg
      if (alert.time === 5 && state.targetCS && state.targetCS !== 7.0) {
        msg = `Focus CS — target ${state.targetCS.toFixed(1)}+ per minute`
      }

      if (ALERT_CATS.has(alert.cat)) {
        pushAlert(msg, alert.cat, alert.pri)
        // Feature 1: Speak urgent objective alerts
        if (alert.pri === 'urgent') speak(msg.replace(/[🐛🐉🟣⚔⚠]/gu, '').trim(), true)
      } else {
        setFocus(msg, alert.pri === 'urgent')
      }
    }
  }
}

// ── Dragon / Baron respawn alerts ────────────────────────────────────────────
// TIMELINE_ALERTS covers first spawns; this handles subsequent respawns.
function checkRespawnAlerts(gameTime) {
  if (state.isARAM) return

  // Dragon respawns (first spawn at 300s handled by TIMELINE_ALERTS)
  const dSpawn = state.nextDragonSpawn
  if (dSpawn > 300) {
    const dLeft = dSpawn - gameTime
    const d30 = `d-${dSpawn}-30`, d15 = `d-${dSpawn}-15`, d0 = `d-${dSpawn}-0`
    if (!state.respawnAlerted.has(d30) && dLeft <= 30 && dLeft > 15) {
      state.respawnAlerted.add(d30)
      pushAlert('🐉 Dragon respawns in 30s', 'objective', 'warning')
    }
    if (!state.respawnAlerted.has(d15) && dLeft <= 15 && dLeft > 0) {
      state.respawnAlerted.add(d15)
      pushAlert('🐉 Dragon respawns in 15s', 'objective', 'warning')
    }
    if (!state.respawnAlerted.has(d0) && dLeft <= 0) {
      state.respawnAlerted.add(d0)
      pushAlert('🐉 DRAGON BACK UP', 'objective', 'urgent')
      speak('Dragon is back up', true)
    }
  }

  // Baron respawns (first spawn at 1200s handled by TIMELINE_ALERTS)
  const bSpawn = state.nextBaronSpawn
  if (bSpawn > 1200) {
    const bLeft = bSpawn - gameTime
    const b50 = `b-${bSpawn}-50`, b15 = `b-${bSpawn}-15`, b0 = `b-${bSpawn}-0`
    if (!state.respawnAlerted.has(b50) && bLeft <= 50 && bLeft > 35) {
      state.respawnAlerted.add(b50)
      pushAlert('🟣 Baron respawns in 50s', 'objective', 'warning')
    }
    if (!state.respawnAlerted.has(b15) && bLeft <= 15 && bLeft > 0) {
      state.respawnAlerted.add(b15)
      pushAlert('🟣 Baron respawns in 15s', 'objective', 'warning')
    }
    if (!state.respawnAlerted.has(b0) && bLeft <= 0) {
      state.respawnAlerted.add(b0)
      pushAlert('🟣 BARON NASHOR BACK UP', 'objective', 'urgent')
      speak('Baron Nashor is back up', true)
    }
  }
}

// ── Game event alerts ─────────────────────────────────────────────────────────
function checkEvents(events, activeName, allPlayers, myTeam) {
  for (const ev of events) {
    if (state.seenEventIds.has(ev.EventID)) continue
    state.seenEventIds.add(ev.EventID)

    // Log important game events for momentum context
    let evDesc = ''
    if (ev.EventName === 'ChampionKill') {
      evDesc = `[${fmtTime(ev.EventTime)}] ${ev.KillerName} killed ${ev.VictimName}`
    } else if (ev.EventName === 'TurretKilled') {
      evDesc = `[${fmtTime(ev.EventTime)}] Turret destroyed by ${ev.KillerName || 'minions'}`
    } else if (ev.EventName === 'DragonKill' || ev.EventName === 'BaronKill' || ev.EventName === 'RiftHeraldKill') {
      evDesc = `[${fmtTime(ev.EventTime)}] ${ev.EventName.replace('Kill', '')} taken by ${ev.KillerName}`
    } else if (ev.EventName === 'InhibKilled') {
      evDesc = `[${fmtTime(ev.EventTime)}] Inhibitor destroyed by ${ev.KillerName}`
    }
    if (evDesc) {
      state.recentGameEvents.push(evDesc)
      if (state.recentGameEvents.length > 10) state.recentGameEvents.shift()
    }

    // Events older than 60s relative to current game time are stale — update
    // state silently but never announce them to avoid alerts for things that
    // already happened before the overlay connected or after a state reset.
    const stale = ev.EventTime < state.gameTime - 60

    // Drake stack tracking (ARAM has no Drake/Baron/JG)
    if (!state.isARAM && ev.EventName === 'DragonKill') {
      const killerIsAlly = isAllyName(ev.KillerName, myTeam, allPlayers)
      if (killerIsAlly) {
        state.allyDrakes++
      } else {
        state.enemyDrakes++
        if (!stale) {
          if (state.enemyDrakes === 3) {
            pushAlert('🐉 ENEMY SOUL POINT — next dragon = Soul. Drop everything and contest!', 'objective', 'urgent')
            speak('Enemy soul point! Drop everything and contest next dragon!', true)
          } else if (state.enemyDrakes === 4) {
            pushAlert('🐉 Enemy has Dragon Soul — avoid extended teamfights!', 'objective', 'urgent')
            speak('Enemy has Dragon Soul. Avoid extended teamfights!', true)
          }
        }
      }

      // Elder Dragon spawns 6 min after Soul (4th drake by either team) instead of the usual 5 min
      const soulJustClaimed = state.allyDrakes === 4 || state.enemyDrakes === 4
      state.nextDragonSpawn = ev.EventTime + (soulJustClaimed ? 360 : 300)

      if (!stale && !killerIsAlly) {
        if (state.gameTime > 600 && state.allyDrakes < state.enemyDrakes) {
          setFocus('Match their drake — contest next Dragon', false)
        }
      }
    }

    // Baron trade logic
    if (!state.isARAM && ev.EventName === 'BaronKill') {
      state.nextBaronSpawn = ev.EventTime + 360
      if (!stale) {
        const baronAlly = isAllyName(ev.KillerName, myTeam, allPlayers)
        if (!baronAlly) {
          if (state.allyDrakes < 4) {
            pushAlert("Enemy has Baron — Dragon is contestable if it's up", 'macro', 'warning')
          }
        } else {
          pushAlert('Your team has Baron buff', 'macro', 'normal')
        }
      }
    }

    // Always update last-seen timestamps from kill events — even stale ones
    // give us accurate tracking data for the missing-laner system
    if (ev.EventName === 'ChampionKill') {
      const allInvolved = [ev.KillerName, ...(ev.Assisters ?? []), ev.VictimName]
      for (const name of allInvolved) {
        const p = allPlayers.find(pl => matchName(pl.summonerName, name))
        if (p && myTeam && p.team !== myTeam) {
          state.enemyLastSeen[p.summonerName] = ev.EventTime
        }
      }
    }

    // JG tracking — always update lastSeenTime, only alert if fresh
    if (!state.isARAM && ev.EventName === 'ChampionKill' && state.jungler.name) {
      const jn       = state.jungler.name
      const involved = matchName(ev.KillerName, jn) ||
        (Array.isArray(ev.Assisters) && ev.Assisters.some((a) => matchName(a, jn)))
      if (involved) {
        state.jungler.lastSeenTime = ev.EventTime
        if (!stale) {
          const victim  = allPlayers.find((p) => matchName(p.summonerName, ev.VictimName))
          const pos     = victim?.position ?? ''
          const laneMap = { TOP: 'top', MID: 'mid', BOT: 'bot', UTILITY: 'bot', BOTTOM: 'bot' }
          const lane    = laneMap[pos] ?? (matchName(ev.VictimName, activeName) ? 'lane' : null)
          if (lane) {
            state.jungler.lastSeenSide = `${lane} side`
            pushAlert(`🗡 JG ganked ${lane}`, 'gank', 'warning')
          }
        }
      }
      if (matchName(ev.VictimName, jn)) state.jungler.lastSeenTime = ev.EventTime
    }

    if (!state.isARAM && ['DragonKill','BaronKill','RiftHeraldKill'].includes(ev.EventName) &&
        state.jungler.name && matchName(ev.KillerName, state.jungler.name)) {
      state.jungler.lastSeenTime = ev.EventTime
      state.jungler.lastSeenSide = 'objective'
    }

    if (!stale && ev.EventName === 'ChampionKill' && matchName(ev.VictimName, activeName)) {
      state.justDied = true
      state.lastKillerName = ev.KillerName
      speak('You died', true)
    }

    if (ev.EventName === 'GameEnd') {
      state.gameResult = ev.Result ?? null  // 'Win' or 'Lose'
    }

    if (!stale) {
      if (state.isARAM && ['DragonKill', 'BaronKill', 'RiftHeraldKill'].includes(ev.EventName)) {
        continue
      }
      const alert = handleGameEvent(ev, activeName, allPlayers)
      if (alert) pushAlert(alert.msg, alert.cat, alert.pri)
    }
  }
}

// ── Power spikes ─────────────────────────────────────────────────────────────
function checkPowerSpikes(level, prevLevel, items, prevItemCount) {
  // prevLevel=0 means this is the first data point after a state reset —
  // we don't know the real previous level so skip to avoid stale level alerts
  if (prevLevel === 0) return
  if (prevLevel < 6  && level >= 6)  pushAlert('🔥 Level 6 — ultimate unlocked', 'power', 'urgent')
  if (prevLevel < 11 && level >= 11) pushAlert('🔥 Level 11 — ult rank 2 power spike', 'power', 'warning')
  if (prevLevel < 16 && level >= 16) pushAlert('🔥 Level 16 — max ult, full power', 'power', 'warning')
  if (items.length > prevItemCount && prevItemCount > 0) {
    const item = items[items.length - 1]
    if (item?.price >= 2500) pushAlert('🛡 Big item completed — power spike', 'power', 'normal')
  }
}

// ── Wave hints ───────────────────────────────────────────────────────────────
const WAVE_HINTS = [
  { time: 480,  msg: "Before roaming: crash your wave so they can't free farm", done: false },
  { time: 840,  msg: 'Slow-push = stack 2–3 waves, then shove and take a fight', done: false },
  { time: 1080, msg: 'Crash waves before any major teamfight or objective',       done: false },
  { time: 1380, msg: 'Keep waves crashed in enemy base when you have Baron buff', done: false },
]

const SUPPORT_HINTS = [
  { time: 480,  msg: 'Ward enemy jungle paths — Herald and Dragon fights incoming', done: false },
  { time: 840,  msg: 'Buy Control Ward on every back — keep river vision up',  done: false },
  { time: 1080, msg: 'Roam mid when ADC shoves — look for picks with JG',      done: false },
  { time: 1380, msg: 'Zone enemies off Baron with vision before your team engages', done: false },
]

function checkWaveHints(gameTime) {
  const hints = state.myPosition === 'UTILITY' ? SUPPORT_HINTS : WAVE_HINTS
  if (state.myPosition === 'JUNGLE') return
  for (const h of hints) {
    if (!h.done && gameTime >= h.time) {
      h.done = true
      // Skip if hint is more than 60s stale — avoids coaching about the past
      if (gameTime - h.time > 60) continue
      setFocus(h.msg, false)
    }
  }
}

// ── Feature 3: Vision score reminder ─────────────────────────────────────────
function checkVisionReminder(gameTime, me) {
  if (!me || gameTime < 300) return
  const isSupport  = state.myPosition === 'UTILITY'
  const cooldown   = isSupport ? 90 : 180
  const multiplier = isSupport ? 2.5 : 1.5   // supports expected to ward more
  if (gameTime - state.lastVisionReminderAt < cooldown) return
  const wardScore = Math.floor(me?.scores?.wardScore ?? 0)
  const expected  = (gameTime / 60) * multiplier
  if (wardScore < expected) {
    state.lastVisionReminderAt = gameTime
    const msg = isSupport
      ? `👁 Ward score low (${wardScore}) — place wards and buy Control Ward`
      : `👁 Vision score low — buy a Control Ward on next back`
    setFocus(msg, false)
  }
}

// ── Jungler tracking ─────────────────────────────────────────────────────────
function updateJungler(gameTime, allPlayers, myTeam) {
  if (!myTeam) return

  if (!state.jungler.name) {
    const j = allPlayers.find((p) => p.position === 'JUNGLE' && p.team !== myTeam)
    if (!j) return
    state.jungler.name     = j.summonerName
    state.jungler.champion = j.championName
    state.jungler.level    = j.level
    state.jungler.lastSeenTime = gameTime
    // Note: game plan (Feature 2) fires first via requestGamePlan() in the team comp block
    // This focus message shows if no game plan was fired (AI not enabled)
    if (!state.gamePlanFired) {
      setFocus(`Enemy JG: ${j.championName} — first gank ~2:55`, false)
    }
    return
  }

  const j       = allPlayers.find((p) => matchName(p.summonerName, state.jungler.name))
  if (!j) return
  const wasDead = state.jungler.isDead
  const prevLvl = state.jungler.level
  state.jungler.isDead = j.isDead
  state.jungler.level  = j.level

  if (!wasDead && j.isDead)               { state.jungler.lastSeenTime = gameTime; pushAlert(`✅ ${state.jungler.champion} is dead`, 'gank', 'normal') }
  if (wasDead  && !j.isDead && gameTime > 60) { state.jungler.lastSeenTime = gameTime; pushAlert(`⚠ ${state.jungler.champion} respawned`, 'gank', 'warning') }
  if (prevLvl  < 6 && j.level >= 6)      pushAlert(`⚠ ${state.jungler.champion} hit 6 — gank threat up`, 'gank', 'warning')

  if (!j.isDead) {
    const unseen      = gameTime - state.jungler.lastSeenTime
    const sinceWarned = gameTime - state.jungler.unseenAlertAt
    const scuttleWin  = gameTime >= 160 && gameTime <= 230
    if (unseen > 90 && gameTime > 300) {
      setJunglerThreat('danger')
      if (sinceWarned > 150) {
        pushAlert(`⚠ ${state.jungler.champion} missing`, 'gank', 'urgent')
        speak(`${state.jungler.champion} missing`, true)
        state.jungler.unseenAlertAt = gameTime
      }
    } else if (scuttleWin || (gameTime >= 160 && gameTime <= 210)) {
      setJunglerThreat('warning')
    } else {
      setJunglerThreat(null)
    }
    checkObjectiveJgProximity(gameTime, unseen)
  }
  renderJungler()
}

// Objectives draw junglers toward them before/around spawn — heads-up the
// player when the enemy JG hasn't been confirmed recently and an objective
// window is open, since that's exactly when a river/objective-area gank is likely.
function checkObjectiveJgProximity(gameTime, unseen) {
  if (state.isARAM || unseen < 25) return

  const windows = [
    { key: 'grubs',  start: 440,                        end: 495,                        label: 'Void Grubs' },
    { key: 'herald', start: 860,                         end: 915,                        label: 'Rift Herald' },
    { key: 'dragon', start: state.nextDragonSpawn - 35,  end: state.nextDragonSpawn + 25, label: 'Dragon'      },
    { key: 'baron',  start: state.nextBaronSpawn  - 45,  end: state.nextBaronSpawn  + 25, label: 'Baron'       },
  ]

  for (const w of windows) {
    if (gameTime < w.start || gameTime > w.end) continue
    const lastAlert = state.objJgAlertedAt[w.key] ?? -999
    if (gameTime - lastAlert < (w.end - w.start) + 5) continue
    state.objJgAlertedAt[w.key] = gameTime
    setJunglerThreat('warning')
    pushAlert(`👀 ${state.jungler.champion} unaccounted for — likely near ${w.label}`, 'gank', 'warning')
    speak(`Watch for ${state.jungler.champion} near ${w.label}`, false)
  }
}

// ── Alert system ─────────────────────────────────────────────────────────────
function pushAlert(msg, cat, pri) {
  const isAiTip = pri === 'ai' || pri === 'gameplan'
  // AI tips already set focusText directly (with their own color) right
  // before calling pushAlert (see requestGamePlan/requestAICoaching) —
  // routing them through setFocus too would trigger its 15s re-lock logic
  // and re-render them later at the wrong color, clobbering whatever
  // legitimate hint is showing by then.
  if (!isAiTip) setFocus(msg, pri === 'urgent')
  // Keep the AI's own past tips out of its own "recent alerts" context —
  // alertLog feeds straight back into the next requestAICoaching() prompt.
  if (!isAiTip) {
    state.alertLog.unshift({ msg, pri, time: state.gameTime })
    if (state.alertLog.length > 4) state.alertLog.pop()
  }
  // Keep full log for post-game analysis
  state.alertLogFull.push({ msg, cat, pri, time: state.gameTime })

  if (MODE === 'dashboard') {
    renderFeedEntry({ msg, cat, pri, time: state.gameTime })
    if (pri === 'urgent')  playUrgentSound()
    if (pri === 'warning') playWarningSound()
    return
  }

  if      (pri === 'urgent')  { window.lolCoach.showCenterNotif(msg, 'urgent'); playUrgentSound() }
  else if (pri === 'warning') { playWarningSound() }
  else if (isAiTip)           { window.lolCoach.showCenterNotif(msg, pri) }
}

// ── Feature 2: Game plan at match start ──────────────────────────────────────
async function requestGamePlan() {
  const [scoutCtx, champKit] = await Promise.all([
    window.lolCoach.getScoutContext(),
    window.lolCoach.getChampKit(),
  ])
  const prompt = [
    `My champion: ${state.myChampion ?? '?'}${state.isARAM ? ' (ARAM Mode on Howling Abyss)' : ` (${state.myPosition ?? '?'})`}`,
    champKit ? `Current kit (live patch): ${champKit}` : '',
    `Ally team:  ${state.allyTeam.join(', ') || 'unknown'}`,
    `Enemy team: ${state.enemyTeam.join(', ') || 'unknown'}`,
    scoutCtx ? scoutCtx : '',
    state.isARAM
      ? 'CRITICAL ARAM RULES: This is an ARAM match. There are NO junglers, NO Scuttle Crabs, NO Void Grubs, NO Dragons, NO Barons, NO laning phases, and NO roaming. DO NOT mention Scuttle Crab, Void Grubs, Dragon, Baron, junglers, or roaming under any circumstances.\nTRIGGER: ARAM game just started — give a 2-sentence teamfight and positioning strategy.'
      : 'TRIGGER: game just started — give a 2-sentence laning strategy. If any enemies are high elo (Diamond+), mention the threat.',
  ].filter(Boolean).join('\n')

  try {
    const response = await window.lolCoach.aiGameStart(prompt)
    if (response) {
      let advice = response.advice || response
      if (state.isARAM && typeof advice === 'string') {
        advice = advice
          .replace(/(?:roam|secure|contest)\s+with\s+your\s+jungler[^\.\!\?]*[\.\!\?]?/gi, '')
          .replace(/(?:secure|contest)\s+(?:Scuttle|Scuttle Crab|Void Grubs|Dragon|Baron)[^\.\!\?]*[\.\!\?]?/gi, '')
          .replace(/Scuttle\s+Crab[^\.\!\?]*[\.\!\?]?/gi, '')
          .replace(/Void\s+Grubs[^\.\!\?]*[\.\!\?]?/gi, '')
          .trim()
      }
      state.targetCS = response.targetCS || 7.0
      const focusEl = dualEl('focus-text')
      focusEl.textContent = `✦ ${advice}`
      focusEl.style.color = '#C084FC'
      state.currentFocus = `✦ ${advice}`
      state.aiMessageAt  = state.gameTime  // lock bar for 15s
      state.gamePlanShowing = true
      pushAlert(`✦ ${advice}`, 'ai', 'gameplan')
      speak(advice, false)
      state.lastAICallAt = -999
    }
  } catch {}

  // Fire the deeper, web-search-grounded matchup/itemization brief once,
  // in parallel — it has more slack time than the fast advice above, so a
  // few extra seconds of search latency here is fine. Cached in state and
  // appended to every requestAICoaching() call afterward.
  if (!state.isARAM && !state.matchupBriefFired) {
    const me       = state.allPlayers.find(p => matchName(p.summonerName, state.activeName))
    const opponent = state.allPlayers.find(p =>
      p.team !== me?.team && p.position === state.myPosition && p.position !== 'JUNGLE'
    )
    if (opponent) {
      state.matchupBriefFired = true
      const briefPrompt = `I'm playing ${state.myChampion} as ${state.myPosition} against ${opponent.championName}. Search for current-patch matchup advice and itemization for this specific matchup, then answer.`
      window.lolCoach.getMatchupBrief(briefPrompt).then(brief => {
        if (brief) {
          state.matchupBrief = brief
          pushAlert('✓ Matchup research loaded — coaching grounded in live search', 'info', 'normal')
        } else {
          pushAlert('⚠ Matchup research unavailable — coaching using general knowledge', 'info', 'normal')
        }
      })
    }
  }
}

// ── AI coaching ───────────────────────────────────────────────────────────────
async function requestAICoaching(trigger) {
  if (!state.running || state.gameTime < 120) return
  state.lastAICallAt = state.gameTime

  const j     = state.jungler
  const targetCS = state.targetCS || 7.0
  const delta = state.cs - Math.floor((state.gameTime / 60) * targetCS)
  const phase = state.gameTime < 600 ? 'early' : state.gameTime < 1200 ? 'mid' : 'late'

  const jgStatus = j.isDead ? 'dead'
    : (state.gameTime - j.lastSeenTime > 90 ? `MISSING ${Math.floor(state.gameTime - j.lastSeenTime)}s` : `last seen ${j.lastSeenSide ?? 'unknown'}`)

  const myItems    = state.allPlayers.find(p => matchName(p.summonerName, state.activeName))?.items?.map(i => i.displayName).filter(Boolean) ?? []
  const recentEvts = state.alertLog.slice(0, 3).map(a => a.msg).join(' | ') || 'none'

  const [scoutCtx, champKit] = await Promise.all([
    window.lolCoach.getScoutContext(),
    window.lolCoach.getChampKit(),
  ])

  // Build live objective state so AI never references spawns that already happened
  const baronLeft  = state.nextBaronSpawn  - state.gameTime
  const dragonLeft = state.nextDragonSpawn - state.gameTime
  const objParts   = []
  if (!state.isARAM) {
    if (state.gameTime >= 1200) {
      objParts.push(baronLeft <= 0
        ? `Baron: ALIVE NOW (spawned at ${fmtTime(state.nextBaronSpawn)})`
        : `Baron: spawns at ${fmtTime(state.nextBaronSpawn)} (in ${Math.ceil(baronLeft)}s)`)
    }
    objParts.push(dragonLeft <= 0
      ? `Dragon: ALIVE NOW (spawned at ${fmtTime(state.nextDragonSpawn)})`
      : `Dragon: spawns at ${fmtTime(state.nextDragonSpawn)} (in ${Math.ceil(dragonLeft)}s)`)
  }

  // Find lane opponent for accurate level/CS comparison
  const me       = state.allPlayers.find(p => matchName(p.summonerName, state.activeName))
  const opponent = state.allPlayers.find(p =>
    p.team !== me?.team &&
    p.position === state.myPosition &&
    p.position !== 'JUNGLE'
  )
  const oppLvl = opponent?.level ?? '?'
  const oppCS  = opponent?.scores?.creepScore ?? '?'
  const myLvl  = state.level ?? '?'

  const oppCSNum = typeof oppCS === 'number' ? oppCS : 0
  const vsOpponentDelta = state.cs - oppCSNum
  const vsOpponentStr = opponent ? `, vs Lane Opponent: ${vsOpponentDelta >= 0 ? '+' : ''}${vsOpponentDelta} CS` : ''

  const recentRecallsStr = Object.entries(state.recallAlertedAt)
    .filter(([, t]) => state.gameTime - t < 30)
    .map(([name]) => state.allPlayers.find(p => matchName(p.summonerName, name))?.championName ?? name)
    .join(', ')

  const allySummary = state.allPlayers
    .filter(p => me && p.team === me.team && !matchName(p.summonerName, state.activeName))
    .map(p => {
      const status = p.isDead ? `DEAD (respawns in ${Math.ceil(p.respawnTimer)}s)` : 'ALIVE'
      const kda = `${p.scores?.kills ?? 0}/${p.scores?.deaths ?? 0}/${p.scores?.assists ?? 0}`
      return `${p.championName} (${p.position ?? 'unknown'}, ${status}, KDA: ${kda})`
    })
    .join(' | ')

  const enemySummary = state.allPlayers
    .filter(p => me && p.team !== me.team)
    .map(p => {
      const status = p.isDead ? `DEAD (respawns in ${Math.ceil(p.respawnTimer)}s)` : 'ALIVE'
      const items = p.items?.map(i => i.displayName).filter(Boolean).join(', ') || 'none'
      const kda = `${p.scores?.kills ?? 0}/${p.scores?.deaths ?? 0}/${p.scores?.assists ?? 0}`
      const cs = p.scores?.creepScore ?? 0
      return `${p.championName} (${p.position ?? 'unknown'}, ${status}, KDA: ${kda}, CS: ${cs}, Items: ${items})`
    })
    .join(' | ')

  const lines = [
    `My champion: ${state.myChampion ?? '?'}${state.isARAM ? ' (ARAM)' : ` (${state.myPosition ?? '?'})`} — ${phase} game (${fmtTime(state.gameTime)})`,
    champKit ? `Current kit (live patch): ${champKit}` : '',
    state.matchupBrief ? `Verified Matchup Brief (web-search grounded, gathered at game start): ${state.matchupBrief}` : '',
    scoutCtx ?? '',
    `My Status: ${state.kills}/${state.deaths}/${state.assists} | Level: ${myLvl} | CS: ${state.cs} (vs Target Pace: ${delta >= 0 ? '+' : ''}${delta} CS${vsOpponentStr}) | Items: ${myItems.join(', ') || 'none'}`,
    `Allies Status: ${allySummary || 'none'}`,
    `Enemies Status: ${enemySummary || 'none'}`,
    ...(!state.isARAM ? [
      `Drakes: Ally ${state.allyDrakes} · Enemy ${state.enemyDrakes}`,
      `Enemy JG: ${j.champion ?? '?'} — ${jgStatus}`,
      objParts.join(' | '),
      recentRecallsStr ? `Recently recalled (last 30s, likely absent from lane/river): ${recentRecallsStr}` : '',
    ] : []),
    `Recent Alerts: ${recentEvts}`,
    `Recent Game Events: ${state.recentGameEvents?.join(' | ') || 'None'}`,
  ].filter(Boolean)

  if (trigger === 'death') {
    lines.push('TRIGGER: player just died — advise on respawn plan')
    if (state.lastKillerName) {
      const killer = state.allPlayers.find(p => matchName(p.summonerName, state.lastKillerName))
      if (killer) {
        const kKDA = `${killer.scores?.kills ?? 0} Kills / ${killer.scores?.deaths ?? 0} Deaths / ${killer.scores?.assists ?? 0} Assists`
        const kItems = killer.items?.map(i => i.displayName).filter(Boolean).join(', ') || 'none'
        lines.push(`Death Info: Killed by ${killer.championName} (KDA: ${kKDA}, Items: ${kItems})`)
      }
    }
  }

  const requestTime = state.gameTime
  try {
    const advice = await window.lolCoach.aiCoaching(lines.join('\n'))
    if (advice) {
      const apiElapsedTime = state.gameTime - requestTime
      if (!isCoachStatementRelevant(advice, apiElapsedTime)) {
        return
      }
      const focusEl = dualEl('focus-text')
      focusEl.textContent = `✦ ${advice}`
      focusEl.style.color = '#7ee8f5'
      state.aiMessageAt = state.gameTime  // lock bar for 15s
      pushAlert(`✦ ${advice}`, 'ai', 'ai')
      speak(advice, false)
    }
  } catch {}
}


// ── Enemy recall detector ─────────────────────────────────────────────────────
// Items can only be purchased at base, so a new item ID appearing on an enemy
// is a confirmed "they were at base a moment ago" signal — unlike CS/level/HP,
// which the API reports regardless of fog-of-war visibility.
function checkEnemyRecalls(allPlayers, myTeam, gameTime, myPosition) {
  if (!myTeam || gameTime < 90) return
  for (const p of allPlayers) {
    if (p.team === myTeam) continue
    // Direct lane opponent already gets dedicated recall handling in checkRoamWindows
    if (myPosition && myPosition !== 'JUNGLE' && p.position === myPosition) continue
    const name = p.summonerName
    const currentIds = new Set((p.items ?? []).map(i => i.itemID))
    const prevIds = state.enemyItemSets[name]
    state.enemyItemSets[name] = currentIds

    if (!prevIds || p.isDead) continue
    const gotNewItem = [...currentIds].some(id => !prevIds.has(id))
    if (!gotNewItem) continue

    const lastAlert = state.recallAlertedAt[name] ?? -999
    if (gameTime - lastAlert < 25) continue
    state.recallAlertedAt[name] = gameTime

    if (state.jungler.name && matchName(name, state.jungler.name)) {
      state.jungler.lastSeenTime = gameTime
      state.jungler.lastSeenSide = 'base (recalled)'
      setJunglerThreat(null)
      pushAlert('🛍 Enemy jungler recalled', 'gank', 'warning')
    } else {
      const laneLabel = { TOP: 'Top', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' }[p.position] ?? 'Enemy laner'
      pushAlert(`🛍 ${laneLabel} recalled`, 'wave', 'normal')
    }
  }
}

// ── Missing laner tracker ─────────────────────────────────────────────────────
// NOTE: Riot's Live Client Data API reports all champions' CS/level/HP/items
// regardless of actual fog-of-war visibility, so those fields can't be used
// as a "seen" signal — enemyLastSeen is only updated from kill/death events
// (see checkEvents) and the resets below, which are timing signals we can trust.
const MISSING_THRESHOLD = { MIDDLE: 150, TOP: 210, BOTTOM: 210, UTILITY: 210 }

function checkMissingLaners(allPlayers, myTeam, me, gameTime) {
  if (!myTeam || !me || gameTime < 180) return
  const jgName = state.jungler.name

  const enemies = allPlayers.filter(p =>
    p.team !== myTeam &&
    p.position !== 'JUNGLE' &&
    !matchName(p.summonerName, jgName) &&
    p.position !== me.position  // skip our own matchup — JG handles that pressure
  )

  for (const enemy of enemies) {
    if (enemy.isDead) {
      // Reset tracking when they die — they'll re-appear on respawn events
      state.enemyLastSeen[enemy.summonerName] = gameTime
      state.missingAlertAt[enemy.summonerName] = 0
      continue
    }

    const lastSeen   = state.enemyLastSeen[enemy.summonerName] ?? gameTime
    const alertedAt  = state.missingAlertAt[enemy.summonerName] ?? 0
    const unseen     = gameTime - lastSeen
    const threshold  = MISSING_THRESHOLD[enemy.position] ?? 210

    if (unseen >= threshold && gameTime - alertedAt > threshold) {
      state.missingAlertAt[enemy.summonerName] = gameTime
      const role = enemy.position === 'MIDDLE' ? 'Mid' : enemy.position === 'TOP' ? 'Top' : 'Bot'
      const msg  = `👁 Enemy ${role} (${enemy.championName}) missing — check your flank`
      pushAlert(msg, 'missing', enemy.position === 'MIDDLE' ? 'warning' : 'normal')
      if (enemy.position === 'MIDDLE') speak(`Enemy mid ${enemy.championName} missing. Watch your flank.`, false)
    }
  }
}

// ── Enemy death push window ───────────────────────────────────────────────────
function checkEnemyPushWindow(allPlayers, myTeam, me, gameTime) {
  if (!myTeam || !me || gameTime < 60) return

  const enemies = allPlayers.filter(p => p.team !== myTeam)
  const jgName  = state.jungler.name
  const prev    = state.enemyDeadPrev

  const next = {}
  enemies.forEach(p => { next[p.summonerName] = p.isDead })
  state.enemyDeadPrev = next

  // First tick after state reset: prev is empty so every dead enemy would
  // look "newly dead" — skip to avoid a flood of stale push-window alerts
  if (Object.keys(prev).length === 0) return

  // Only react to newly dead non-JG enemies (JG death already alerted by updateJungler)
  const newlyDead = enemies.filter(p =>
    p.isDead && !prev[p.summonerName] && !matchName(p.summonerName, jgName)
  )
  if (newlyDead.length === 0) return

  const totalDead = enemies.filter(p => p.isDead).length
  const lanerDied = newlyDead.find(p => p.position === me.position)

  if (totalDead >= 3) {
    const msg = state.isARAM
      ? `${totalDead} enemies down — numbers advantage`
      : `${totalDead} enemies down — objectives are open`
    pushAlert(msg, 'push', 'urgent')
    speak(state.isARAM ? `${totalDead} enemies down. Numbers advantage.` : `${totalDead} enemies down. Objectives are open.`, true)
  } else if (lanerDied && totalDead >= 2) {
    const msg = state.isARAM
      ? '2 enemies down'
      : 'Laner down with backup — objective window open'
    pushAlert(msg, 'push', 'warning')
    speak(state.isARAM ? '2 enemies down.' : 'Laner down with backup. Objective window open.', false)
  } else if (lanerDied) {
    const t = Math.ceil(lanerDied.respawnTimer ?? 0)
    const tStr = t > 0 ? ` — ${t}s window` : ''
    pushAlert(`Enemy laner dead${tStr}`, 'push', 'normal')
    speak('Enemy laner is dead.', false)
  }
}

function checkRoamWindows(me, opponent, gameTime) {
  if (!me || !opponent || gameTime < 180) return
  if (state.myPosition === 'JUNGLE' || state.myPosition === 'UTILITY') return

  const isDead = opponent.isDead
  const respawnTimer = opponent.respawnTimer ?? 0

  if (isDead) {
    if (respawnTimer > 8 && respawnTimer <= 14 && !state.roamAlerts.has(`respawn-soon-${opponent.summonerName}`)) {
      state.roamAlerts.add(`respawn-soon-${opponent.summonerName}`)
      const msg = `⚠ Enemy ${opponent.championName} respawning in ${Math.ceil(respawnTimer)}s`
      pushAlert(msg, 'wave', 'warning')
      speak(`Enemy ${opponent.championName} respawning in ${Math.ceil(respawnTimer)} seconds.`, false)
    }
  } else {
    if (state.laneOpponentWasDead && !isDead) {
      const msg = `⚔ Enemy ${opponent.championName} respawned — returning to lane`
      pushAlert(msg, 'wave', 'normal')
      speak(`Enemy ${opponent.championName} respawned, returning to lane.`, false)
      state.roamAlerts.delete(`respawn-soon-${opponent.summonerName}`)
    }

    // Recall item scanning
    const oppItems = opponent.items?.map(i => i.itemID).filter(Boolean) ?? []
    const prevItems = state.opponentPrevItems || []

    const boughtItem = oppItems.some(id => !prevItems.includes(id))
    if (boughtItem && prevItems.length > 0 && !state.laneOpponentWasDead) {
      const msg = `⚡ Enemy ${opponent.championName} recalled & bought items — possible power spike`
      pushAlert(msg, 'wave', 'normal')
      speak(`Enemy ${opponent.championName} recalled and bought items.`, false)
    }
    state.opponentPrevItems = oppItems
  }
  state.laneOpponentWasDead = isDead
}

// ── Situational context badge ─────────────────────────────────────────────────
// Shows raw facts (HP%, JG status) — player decides what to do with them
function checkAllinWindow(level, me, allPlayers, gameTime) {
  const badge = dualEl('allin-badge')
  if (!me || !badge) return
  if (level < 6) { badge.classList.add('hidden'); return }
  // Jungle has no fixed lane opponent — "my position" would match the enemy
  // jungler themselves, making the JG-safety check self-referential/meaningless
  if (state.myPosition === 'JUNGLE') { badge.classList.add('hidden'); return }

  const j      = state.jungler
  const jgSafe = j.name && (j.isDead || gameTime - j.lastSeenTime > 90)
  if (!jgSafe) { badge.classList.add('hidden'); return }

  const enemyLaner = allPlayers.find(p => p.position === me.position && p.team !== me.team)
  if (!enemyLaner || enemyLaner.isDead) { badge.classList.add('hidden'); return }

  const eHP = (enemyLaner.stats?.currentHealth && enemyLaner.stats?.maxHealth)
    ? enemyLaner.stats.currentHealth / enemyLaner.stats.maxHealth : null
  if (eHP !== null && eHP > 0.65) { badge.classList.add('hidden'); return }

  // Show context data, not a directive
  const hpStr = eHP !== null ? `${Math.round(eHP * 100)}% HP` : 'Low HP'
  const jgStr = j.isDead ? 'JG dead' : 'JG MIA'
  badge.textContent = `${hpStr} · ${jgStr}`
  badge.classList.remove('hidden')
}

// ── Objective countdown ───────────────────────────────────────────────────────
function updateObjectiveCountdown(gameTime) {
  const el = dualEl('obj-countdown')
  if (!el) return
  const dragonLeft = state.nextDragonSpawn - gameTime
  const baronLeft  = state.nextBaronSpawn  - gameTime

  let text = '', urgent = false
  if (baronLeft > 0 && baronLeft <= 120) {
    text = `🟣${fmtCd(baronLeft)}`; urgent = baronLeft <= 30
  } else if (dragonLeft > 0 && dragonLeft <= 90) {
    text = fmtCd(dragonLeft); urgent = dragonLeft <= 20
  }
  el.textContent = text
  el.classList.toggle('urgent', urgent)
}

function fmtCd(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
}

// ── Sound system ─────────────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)()

function playTone(freq, dur, vol = 0.18, type = 'sine') {
  try {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain()
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
    gain.gain.setValueAtTime(0, audioCtx.currentTime)
    gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + dur)
  } catch {}
}

function playWarningSound() { playTone(880, 0.12); setTimeout(() => playTone(880, 0.12), 160) }
function playUrgentSound()  { playTone(660, 0.13, 0.25); setTimeout(() => playTone(990, 0.18, 0.25), 140) }

document.addEventListener('mousemove', () => { if (audioCtx.state === 'suspended') audioCtx.resume() }, { once: true })

// ── Helpers ───────────────────────────────────────────────────────────────────
function findMe(allPlayers, activeName) {
  return allPlayers.find(p =>
    p.summonerName === activeName ||
    p.summonerName === activeName.split('#')[0] ||
    activeName.startsWith(p.summonerName)
  )
}

function matchName(a, b) {
  if (!a || !b) return false
  const clean = s => s.split('#')[0].toLowerCase().trim()
  return clean(a) === clean(b)
}

function isAllyName(name, myTeam, allPlayers) {
  const p = allPlayers.find(p => matchName(p.summonerName, name))
  return p?.team === myTeam
}

function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`
}
