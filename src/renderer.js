// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const waitingScreen = $('waiting-screen')
const gameScreen    = $('game-screen')
const focusText     = $('focus-text')
const appEl         = $('app')

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

  const hasDragon = lowerText.includes('dragon') || lowerText.includes('drake');
  const hasBaron = lowerText.includes('baron');

  if (hasDragon) {
    const dragonLeft = state.nextDragonSpawn - state.gameTime;

    if (mentionedTimeSec !== null) {
      if (dragonLeft <= 0) {
        console.log(`[Relevance Filter] Rejected dragon advice: dragon is already alive, but AI said: "${text}"`);
        return false;
      }
      if (Math.abs(dragonLeft - mentionedTimeSec) > 35) {
        console.log(`[Relevance Filter] Rejected dragon advice: dragon spawns in ${Math.round(dragonLeft)}s, but AI said relative ${mentionedTimeSec}s: "${text}"`);
        return false;
      }
    }

    if (mentionedAbsoluteSec !== null) {
      if (state.gameTime > mentionedAbsoluteSec) {
        console.log(`[Relevance Filter] Rejected dragon advice: absolute time ${fmtTime(mentionedAbsoluteSec)} has passed, but AI said: "${text}"`);
        return false;
      }
      if (Math.abs(state.nextDragonSpawn - mentionedAbsoluteSec) > 20) {
        console.log(`[Relevance Filter] Rejected dragon advice: next spawn is at ${fmtTime(state.nextDragonSpawn)}, but AI said absolute ${fmtTime(mentionedAbsoluteSec)}: "${text}"`);
        return false;
      }
    }
  }

  if (hasBaron) {
    const baronLeft = state.nextBaronSpawn - state.gameTime;

    if (mentionedTimeSec !== null) {
      if (baronLeft <= 0) {
        console.log(`[Relevance Filter] Rejected baron advice: baron is already alive, but AI said: "${text}"`);
        return false;
      }
      if (Math.abs(baronLeft - mentionedTimeSec) > 45) {
        console.log(`[Relevance Filter] Rejected baron advice: baron spawns in ${Math.round(baronLeft)}s, but AI said relative ${mentionedTimeSec}s: "${text}"`);
        return false;
      }
    }

    if (mentionedAbsoluteSec !== null) {
      if (state.gameTime > mentionedAbsoluteSec) {
        console.log(`[Relevance Filter] Rejected baron advice: absolute time ${fmtTime(mentionedAbsoluteSec)} has passed, but AI said: "${text}"`);
        return false;
      }
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
    lastVisionReminderAt: -999,
    gamePlanShowing: false,
    enemyDeadPrev: {},
    enemyLastSeen: {},
    missingAlertAt: {},
    csDeltaHistory: [],
    nextDragonSpawn: 300,
    nextBaronSpawn: 1200,
    isARAM: false,
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

// ── Manual JG ping (Ctrl+J) ───────────────────────────────────────────────────
window.lolCoach.onJgPing(() => {
  if (!state.running || !state.jungler.name) return
  state.jungler.lastSeenTime  = state.gameTime
  state.jungler.unseenAlertAt = state.gameTime
  setJunglerThreat(null)
  renderJungler()
  const msg = `📍 ${state.jungler.champion} spotted — timer reset`
  setFocus(msg, false)
  window.lolCoach.showCenterNotif(msg, 'normal')
  speak(`${state.jungler.champion} spotted`, false)
})



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
    if (gameData.gameMode === 'ARAM') {
      state.isARAM = true
      $('jg-last').textContent  = 'ARAM'
      $('jg-threat').textContent = ''
      $('drake-icon').textContent = '⚔'
      $('ally-drakes').textContent = ''
      $('enemy-drakes').textContent = ''
      document.querySelector('.drake-sep').textContent = ''
      $('obj-countdown').textContent = ''
    }
    waitingScreen.classList.add('hidden')
    gameScreen.classList.remove('hidden')
    appEl.classList.add('dimmed')
  }

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
    focusText.textContent = `💀 Respawn in ${Math.ceil(respawn)}s`
    focusText.style.color = '#5A6A7A'
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

  focusText.textContent = recap
  focusText.style.color = state.gameResult === 'Win' ? '#1FD65F' : state.gameResult === 'Lose' ? '#FF3B3B' : '#C084FC'
  appEl.classList.remove('dimmed')
  backBtn.classList.remove('hidden')  // show ← back button

  window.lolCoach.saveGameResult({
    champion: state.myChampion, position: state.myPosition,
    kills: state.kills, deaths: state.deaths, assists: state.assists,
    cs: state.cs, gameTime: state.gameTime,
    allyDrakes: state.allyDrakes, enemyDrakes: state.enemyDrakes,
    result: state.gameResult,
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
    })
  }
}

// ── CS display ───────────────────────────────────────────────────────────────
function updateCS(gameTime, cs, me) {
  const el  = $('cs-delta')
  const pos = state.myPosition

  if (pos === 'UTILITY') {
    // Support: show ward score instead
    const wards = Math.floor(me?.scores?.wardScore ?? 0)
    const expectedWards = (gameTime / 60) * 1.5
    el.textContent = `👁 ${wards}`
    el.style.color = wards >= expectedWards ? '#1FD65F' : '#C89B3C'
    $('wave-trend').textContent = ''
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
    $('wave-trend').textContent = ''
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
  const el   = $('wave-trend')
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
  const el = $('gold-diff')
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
  $('ally-drakes').textContent  = state.allyDrakes
  $('enemy-drakes').textContent = state.enemyDrakes
  const zone = $('drake-zone')
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
  focusText.textContent = msg
  if (color) {
    focusText.style.color = color
  } else {
    focusText.style.color = urgent ? '#FF6B35' : '#C89B3C'
  }
  state.currentFocus = msg
}

// ── Jungler display ──────────────────────────────────────────────────────────
function setJunglerThreat(level) {
  const el = $('jg-zone')
  el.classList.remove('jg-dead', 'jg-warning', 'jg-danger')
  if (level) el.classList.add(`jg-${level}`)
}

function renderJungler() {
  const j = state.jungler
  if (!j.name) return
  const lastEl = $('jg-last')
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
  for (const alert of TIMELINE_ALERTS) {
    if (!state.shownTimeline.has(alert.time) && gameTime >= alert.time) {
      state.shownTimeline.add(alert.time)
      // Skip alerts more than 45s in the past — avoids firing stale objective
      // warnings when the overlay starts mid-game or state resets
      if (gameTime - alert.time > 45) continue

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
      pushAlert('🐉 Dragon respawns in 30s — position now', 'objective', 'warning')
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
      pushAlert('🟣 Baron respawns in 50s — ward Baron pit now', 'objective', 'warning')
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
            window.lolCoach.showCenterNotif('🐉 ENEMY SOUL POINT — next dragon = Soul. Drop everything and contest!', 'urgent')
            playUrgentSound()
            speak('Enemy soul point! Drop everything and contest next dragon!', true)
          } else if (state.enemyDrakes === 4) {
            window.lolCoach.showCenterNotif('🐉 Enemy has Dragon Soul — avoid extended teamfights!', 'urgent')
            playUrgentSound()
            speak('Enemy has Dragon Soul. Avoid extended teamfights!', true)
          }
        }
      }

      state.nextDragonSpawn = ev.EventTime + 300

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
            pushAlert("Enemy Baron — take Dragon if it's up, push side lanes", 'macro', 'warning')
          }
        } else {
          pushAlert('Baron buff — split push side lanes, don\'t fight in jungle', 'macro', 'normal')
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
  if (prevLevel < 6  && level >= 6)  pushAlert('🔥 Level 6 — ult unlocked! Look for plays', 'power', 'urgent')
  if (prevLevel < 11 && level >= 11) pushAlert('🔥 Level 11 — ult rank 2 power spike', 'power', 'warning')
  if (prevLevel < 16 && level >= 16) pushAlert('🔥 Level 16 — max ult! Full power', 'power', 'warning')
  if (items.length > prevItemCount && prevItemCount > 0) {
    const item = items[items.length - 1]
    if (item?.price >= 2500) pushAlert('🛡 Big item completed — look for a fight', 'power', 'normal')
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
      setFocus(`Enemy JG: ${j.championName} — first gank ~3:30`, false)
    }
    return
  }

  const j       = allPlayers.find((p) => matchName(p.summonerName, state.jungler.name))
  if (!j) return
  const wasDead = state.jungler.isDead
  const prevLvl = state.jungler.level
  state.jungler.isDead = j.isDead
  state.jungler.level  = j.level

  if (!wasDead && j.isDead)               { state.jungler.lastSeenTime = gameTime; pushAlert(`✅ ${state.jungler.champion} is dead — play aggressive`, 'gank', 'normal') }
  if (wasDead  && !j.isDead && gameTime > 60) { state.jungler.lastSeenTime = gameTime; pushAlert(`⚠ ${state.jungler.champion} respawned — ward up`, 'gank', 'warning') }
  if (prevLvl  < 6 && j.level >= 6)      pushAlert(`⚠ ${state.jungler.champion} hit 6 — gank threat up`, 'gank', 'warning')

  if (!j.isDead) {
    const unseen      = gameTime - state.jungler.lastSeenTime
    const sinceWarned = gameTime - state.jungler.unseenAlertAt
    const scuttleWin  = gameTime >= 180 && gameTime <= 270
    if (unseen > 90 && gameTime > 300) {
      setJunglerThreat('danger')
      if (sinceWarned > 150) {
        const msg = `⚠ ${state.jungler.champion} missing — ward up!`
        window.lolCoach.showCenterNotif(msg, 'urgent')
        playUrgentSound()
        speak(`${state.jungler.champion} missing. Ward up!`, true)
        state.jungler.unseenAlertAt = gameTime
      }
    } else if (scuttleWin || (gameTime >= 180 && gameTime <= 240)) {
      setJunglerThreat('warning')
    } else {
      setJunglerThreat(null)
    }
  }
  renderJungler()
}

// ── Alert system ─────────────────────────────────────────────────────────────
function pushAlert(msg, cat, pri) {
  setFocus(msg, pri === 'urgent')
  state.alertLog.unshift({ msg, pri, time: state.gameTime })
  if (state.alertLog.length > 4) state.alertLog.pop()
  // Keep full log for post-game analysis
  state.alertLogFull.push({ msg, cat, pri, time: state.gameTime })
  if      (pri === 'urgent')  { window.lolCoach.showCenterNotif(msg, 'urgent'); playUrgentSound() }
  else if (pri === 'warning') { playWarningSound() }
}

// ── Feature 2: Game plan at match start ──────────────────────────────────────
async function requestGamePlan() {
  const [scoutCtx, champKit] = await Promise.all([
    window.lolCoach.getScoutContext(),
    window.lolCoach.getChampKit(),
  ])
  const prompt = [
    `My champion: ${state.myChampion ?? '?'}${state.isARAM ? ' (ARAM)' : ` (${state.myPosition ?? '?'})`}`,
    champKit ? `Current kit (live patch): ${champKit}` : '',
    `Ally team:  ${state.allyTeam.join(', ') || 'unknown'}`,
    `Enemy team: ${state.enemyTeam.join(', ') || 'unknown'}`,
    scoutCtx ? scoutCtx : '',
    state.isARAM
      ? 'TRIGGER: ARAM game just started — give a 2-sentence teamfight and ability-use strategy.'
      : 'TRIGGER: game just started — give a 2-sentence laning strategy. If any enemies are high elo (Diamond+), mention the threat.',
  ].filter(Boolean).join('\n')

  try {
    const response = await window.lolCoach.aiGameStart(prompt)
    if (response) {
      const advice = response.advice || response
      state.targetCS = response.targetCS || 7.0
      focusText.textContent = `✦ ${advice}`
      focusText.style.color = '#C084FC'
      state.currentFocus = `✦ ${advice}`
      state.aiMessageAt  = state.gameTime  // lock bar for 15s
      state.gamePlanShowing = true
      window.lolCoach.showCenterNotif(`✦ ${advice}`, 'gameplan')
      speak(advice, false)
      state.lastAICallAt = -999
    }
  } catch {}
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

  // Threat-based scanning: summarize enemy builds & stats
  const enemyItemsSummary = state.allPlayers
    .filter(p => me && p.team !== me.team)
    .map(p => {
      const pItems = p.items?.map(i => i.displayName).filter(Boolean).join(', ') || 'none'
      const kda = `${p.scores?.kills ?? 0} Kills / ${p.scores?.deaths ?? 0} Deaths / ${p.scores?.assists ?? 0} Assists`
      return `${p.championName} (KDA: ${kda}, Items: ${pItems})`
    })
    .join(' | ')

  const lines = [
    `My champion: ${state.myChampion ?? '?'}${state.isARAM ? ' (ARAM)' : ` (${state.myPosition ?? '?'})`} — ${phase} game (${fmtTime(state.gameTime)})`,
    champKit ? `Current kit (live patch): ${champKit}` : '',
    `Ally team:  ${state.allyTeam.join(', ') || 'unknown'}`,
    `Enemy team: ${state.enemyTeam.join(', ') || 'unknown'}`,
    scoutCtx ?? '',
    `Player Stats: ${state.kills} Kills / ${state.deaths} Deaths / ${state.assists} Assists | Level: ${myLvl} | CS: ${state.cs} (vs Target Pace: ${delta >= 0 ? '+' : ''}${delta} CS${vsOpponentStr})`,
    opponent ? `Lane opponent (${opponent.championName}): Level ${oppLvl} | CS ${oppCS}` : '',
    ...(!state.isARAM ? [
      `Drakes: Ally ${state.allyDrakes} · Enemy ${state.enemyDrakes}`,
      `Enemy JG: ${j.champion ?? '?'} — ${jgStatus}`,
      objParts.join(' | '),
    ] : []),
    `My items: ${myItems.join(', ') || 'none'}`,
    `Enemy Items/KDA: ${enemyItemsSummary || 'unknown'}`,
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
      focusText.textContent = `✦ ${advice}`
      focusText.style.color = '#7ee8f5'
      state.aiMessageAt = state.gameTime  // lock bar for 15s
      window.lolCoach.showCenterNotif(`✦ ${advice}`, 'ai')
      speak(advice, false)
    }
  } catch {}
}


// ── Missing laner tracker ─────────────────────────────────────────────────────
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
    const msg = `${totalDead} enemies down — take Dragon or Baron now!`
    pushAlert(msg, 'push', 'urgent')
    speak(`${totalDead} enemies down! Take an objective.`, true)
  } else if (lanerDied && totalDead >= 2) {
    pushAlert('Laner + another down — push for plates or Dragon', 'push', 'warning')
    speak('Laner down with backup. Extend push or take Dragon.', false)
  } else if (lanerDied) {
    const t = Math.ceil(lanerDied.respawnTimer ?? 0)
    const tStr = t > 0 ? ` — ${t}s window` : ''
    pushAlert(`Enemy laner dead${tStr} — crash wave and roam`, 'push', 'normal')
    speak('Enemy laner is dead. Crash the wave and roam.', false)
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
      const msg = `⚠ Enemy ${opponent.championName} respawning in ${Math.ceil(respawnTimer)}s — crash wave and recall`
      pushAlert(msg, 'wave', 'warning')
      speak(`Enemy ${opponent.championName} respawning in ${Math.ceil(respawnTimer)} seconds. Crash wave and recall.`, false)
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
      const msg = `⚡ Enemy ${opponent.championName} recalled & bought items — check their power spike`
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
  const badge = $('allin-badge')
  if (!me || !badge) return
  if (level < 6) { badge.classList.add('hidden'); return }

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
  const el = $('obj-countdown')
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
