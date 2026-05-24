const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Tray, Menu, nativeImage } = require('electron')
const { uIOhook, UiohookKey } = require('uiohook-napi')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const https = require('https')
const path  = require('path')
const fs    = require('fs')

let mainWindow
let notifWindow
let champSelectWindow
let controlPanelWindow = null
let tray = null
let pollInterval
let lcuPollInterval
let ttsMuted = false   // synced from renderer
let anthropicApiKey = null
let lastAICallTime  = 0

// ── Battle log ────────────────────────────────────────────────────────────────
const battleLogPath = path.join(app.getPath('userData'), 'battle-log.json')
let battleLogWindow = null

function loadBattleLog() {
  try { return JSON.parse(fs.readFileSync(battleLogPath, 'utf8')) } catch { return [] }
}

function saveBattleLogEntry(entry) {
  const log = loadBattleLog()
  log.unshift({ ...entry, date: new Date().toISOString() })
  if (log.length > 100) log.length = 100
  try { fs.writeFileSync(battleLogPath, JSON.stringify(log)) } catch {}
  // Refresh open window if any
  if (battleLogWindow && !battleLogWindow.isDestroyed())
    battleLogWindow.webContents.send('log-data', { battleLog: loadBattleLog(), history: loadHistory() })
}

function createBattleLogWindow() {
  if (battleLogWindow && !battleLogWindow.isDestroyed()) {
    battleLogWindow.focus(); return
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 680, h = 500
  battleLogWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2),
    y: Math.floor((sh - h) / 2),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'battle-log-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  battleLogWindow.loadFile(path.join(__dirname, 'src', 'battle-log.html'))
  battleLogWindow.setAlwaysOnTop(true, 'screen-saver')
  battleLogWindow.webContents.once('did-finish-load', () => {
    battleLogWindow.webContents.send('log-data', { battleLog: loadBattleLog(), history: loadHistory() })
  })
}

// ── Control panel window (Ctrl+Shift+Z) ──────────────────────────────────────
function toggleControlPanel() {
  if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
    controlPanelWindow.close()
    controlPanelWindow = null
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return

  const [barX, barY] = mainWindow.getPosition()
  const [barW]       = mainWindow.getSize()
  const w = 440, h = 175
  controlPanelWindow = new BrowserWindow({
    width: w, height: h,
    x: barX + Math.floor((barW - w) / 2),
    y: barY + 80,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'control-panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  controlPanelWindow.loadFile(path.join(__dirname, 'src', 'control-panel.html'))
  // Use pop-up-menu level — highest always-on-top tier, appears above LoL
  controlPanelWindow.setAlwaysOnTop(true, 'pop-up-menu')
  controlPanelWindow.once('ready-to-show', () => {
    controlPanelWindow.show()
    controlPanelWindow.focus()
  })
  controlPanelWindow.on('closed', () => { controlPanelWindow = null })
}

ipcMain.on('close-control-panel', () => {
  if (controlPanelWindow && !controlPanelWindow.isDestroyed()) controlPanelWindow.close()
})

// ── System tray ───────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Open Controls (Ctrl+Shift+C)',
      click: () => toggleControlPanel(),
    },
    {
      label: ttsMuted ? '🔊 Unmute Voice' : '🔇 Mute Voice',
      click: () => {
        ttsMuted = !ttsMuted
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('set-tts-muted', ttsMuted)
        if (controlPanelWindow && !controlPanelWindow.isDestroyed())
          controlPanelWindow.webContents.send('overlay-state', { ttsMuted, moveMode })
        tray?.setContextMenu(buildTrayMenu())
      },
    },
    { type: 'separator' },
    {
      label: 'Quit LoL Coach',
      click: () => {
        app.quit()
      },
    },
  ])
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.ico')
    tray = new Tray(iconPath)
    tray.setToolTip('LoL Coach Overlay')
    tray.setContextMenu(buildTrayMenu())
    tray.on('click', () => toggleControlPanel())
  } catch (e) {
    console.error('Tray creation failed:', e.message)
  }
}

ipcMain.handle('get-overlay-state', () => ({ ttsMuted }))

ipcMain.handle('tts-toggle', () => {
  ttsMuted = !ttsMuted
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('set-tts-muted', ttsMuted)
  tray?.setContextMenu(buildTrayMenu())
  return { ttsMuted }
})

ipcMain.on('set-tts-state', (_, muted) => {
  ttsMuted = muted
  tray?.setContextMenu(buildTrayMenu())
})

// ── AI setup window ───────────────────────────────────────────────────────────
let aiSetupWindow = null

function createAiSetupWindow() {
  if (aiSetupWindow && !aiSetupWindow.isDestroyed()) {
    aiSetupWindow.focus(); return
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 560, h = 460
  aiSetupWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2),
    y: Math.floor((sh - h) / 2),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'ai-setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  aiSetupWindow.loadFile(path.join(__dirname, 'src', 'ai-setup.html'))
  aiSetupWindow.setAlwaysOnTop(true, 'screen-saver')
}

ipcMain.on('open-ai-setup',   () => createAiSetupWindow())
ipcMain.on('toggle-ai-setup', () => {
  if (aiSetupWindow && !aiSetupWindow.isDestroyed()) aiSetupWindow.close()
  else createAiSetupWindow()
})
ipcMain.on('close-ai-setup', () => { if (aiSetupWindow && !aiSetupWindow.isDestroyed()) aiSetupWindow.close() })

ipcMain.handle('get-ai-status', () => ({ hasKey: !!loadConfig().apiKey }))

ipcMain.handle('save-api-key-from-setup', (_, key) => {
  const trimmed = key.trim()
  saveConfig({ apiKey: trimmed })
  initAI(trimmed)
  // Notify main window so AI button + dot update
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('ai-key-saved')
  return true
})

// ── Recent games window ───────────────────────────────────────────────────────
let recentGamesWindow = null

function createRecentGamesWindow() {
  if (recentGamesWindow && !recentGamesWindow.isDestroyed()) {
    recentGamesWindow.focus(); return
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 400, h = 280
  recentGamesWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2),
    y: Math.floor((sh - h) / 2),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'recent-games-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  recentGamesWindow.loadFile(path.join(__dirname, 'src', 'recent-games.html'))
  recentGamesWindow.setAlwaysOnTop(true, 'screen-saver')
  recentGamesWindow.webContents.once('did-finish-load', () => {
    recentGamesWindow.webContents.send('recent-data', loadHistory().slice(0, 10))
  })
}

ipcMain.on('close-recent-games', () => {
  if (recentGamesWindow && !recentGamesWindow.isDestroyed()) recentGamesWindow.close()
})

// ── LCU state ────────────────────────────────────────────────────────────────
let lcuPort     = null
let lcuPass     = null
let champIdMap    = {}
let nameToId      = {}     // display name (lower) → numeric id
let nameToInternal= {}     // display name (lower) → internal name (e.g. "AurelionSol")
let lastCSKey     = null   // detect meaningful champ-select changes

// ── Game scout state ──────────────────────────────────────────────────────────
let gameScoutShown  = false
let scoutPlayers    = []   // all 10 players from showGameScout
let scoutStats      = {}   // summonerName → { display, tier } as they resolve
let gameWasRunning  = false  // tracks whether a game was active this session
let currentChampKit = null   // fetched from Meraki at game start
let cachedGameResult = null  // 'Win' or 'Lose' — cached during polling so it survives API shutdown

function buildScoutContext() {
  if (!scoutPlayers.length) return null
  const POS = { JUNGLE:'JG', TOP:'Top', MIDDLE:'Mid', BOTTOM:'Bot', UTILITY:'Sup' }
  const fmt = p => {
    const pos   = POS[p.position] ?? p.position ?? ''
    const stats = scoutStats[p.summonerName]
    return `${p.champion}${pos ? `(${pos})` : ''}${stats?.display ? ' ' + stats.display : ''}`
  }
  const enemies = scoutPlayers.filter(p => !p.isAlly).map(fmt)
  const allies  = scoutPlayers.filter(p => p.isAlly && !p.isMe).map(fmt)
  const parts   = []
  if (enemies.length) parts.push(`Enemy players: ${enemies.join(', ')}`)
  if (allies.length)  parts.push(`Ally players: ${allies.join(', ')}`)
  return parts.join(' | ') || null
}

const LOCKFILE_PATHS = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
]

const configPath = path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return {} }
}

function saveConfig(patch) {
  const cfg = loadConfig()
  try { fs.writeFileSync(configPath, JSON.stringify({ ...cfg, ...patch })) } catch {}
}

function initAI(apiKey) {
  anthropicApiKey = apiKey?.trim() || null
}

// Direct HTTPS call to Anthropic API — no SDK needed
function callAnthropic({ systemText, userText, maxTokens }) {
  return new Promise((resolve, reject) => {
    if (!anthropicApiKey) { resolve(null); return }
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    })
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      timeout: 15000,
      headers: {
        'content-type':      'application/json',
        'x-api-key':         anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'prompt-caching-2024-07-31',
        'content-length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text?.trim() ?? null) }
        catch { reject(new Error('parse error')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── LCU helpers ───────────────────────────────────────────────────────────────
function findLockfile() {
  const cfg = loadConfig()
  const custom = cfg.lockfilePath
  if (custom && fs.existsSync(custom)) return custom
  for (const p of LOCKFILE_PATHS) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function parseLockfile(content) {
  const parts = content.trim().split(':')
  return { port: parts[2], password: parts[3] }
}

function fetchLCU(lcuPath) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`riot:${lcuPass}`).toString('base64')
    const req  = https.request({
      hostname: '127.0.0.1',
      port: lcuPort,
      path: lcuPath,
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 1500,
      headers: { 'Authorization': `Basic ${auth}` },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.on('error', reject)
    req.end()
  })
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: true }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { reject(new Error('parse')) } })
    }).on('error', reject)
  })
}

async function loadChampionMap() {
  // Try LCU first (works offline)
  try {
    const list = await fetchLCU('/lol-game-data/assets/v1/champions-summary.json')
    if (Array.isArray(list) && list.length > 10) {
      champIdMap = {}; nameToId = {}
      for (const c of list) {
        if (c.id > 0) { champIdMap[c.id] = c.name; nameToId[c.name.toLowerCase()] = c.id }
      }
      console.log(`Champion map loaded from LCU: ${Object.keys(champIdMap).length} champs`)
      return
    }
  } catch (e) {
    console.log('LCU champion map failed, trying Data Dragon:', e.message)
  }

  // Fallback: Riot Data Dragon CDN
  try {
    const versions  = await fetchJSON('https://ddragon.leagueoflegends.com/api/versions.json')
    const version   = versions[0]
    const champData = await fetchJSON(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
    champIdMap = {}; nameToId = {}; nameToInternal = {}
    for (const c of Object.values(champData.data)) {
      const id = parseInt(c.key)
      champIdMap[id] = c.name
      nameToId[c.name.toLowerCase()] = id
      nameToInternal[c.name.toLowerCase()] = c.id  // e.g. "AurelionSol", "Belveth"
    }
    console.log(`Champion map loaded from Data Dragon ${version}: ${Object.keys(champIdMap).length} champs`)
  } catch (e) {
    console.error('Champion map failed entirely:', e.message)
  }
}

// ── Meraki champion kit fetcher ───────────────────────────────────────────────
function toMerakiName(displayName) {
  // Use the accurate internal name from Data Dragon if available
  const internal = nameToInternal[displayName.toLowerCase()]
  if (internal) return internal
  // Fallback normalization: remove spaces, dots, apostrophes
  return displayName.replace(/['’\s.]/g, '')
}

function cleanAbilityDesc(text) {
  if (!text) return ''
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '#')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchChampionKit(displayName) {
  const merakiName = toMerakiName(displayName)
  try {
    const data = await fetchJSON(
      `https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/${merakiName}.json`
    )
    const abilities = data.abilities
    if (!abilities) return null

    const parseSlot = (key, label) => {
      const ab = abilities[key]?.[0]
      if (!ab?.name) return null
      const raw  = ab.effects?.[0]?.description ?? ''
      const desc = cleanAbilityDesc(raw)
      // Take up to first sentence or 80 chars
      const dot  = desc.indexOf('. ')
      const short = dot > 0 && dot < 80 ? desc.slice(0, dot + 1) : desc.slice(0, 80)
      return short ? `${label}(${ab.name}: ${short})` : `${label}(${ab.name})`
    }

    const parts = [
      parseSlot('P', 'Passive'),
      parseSlot('Q', 'Q'),
      parseSlot('W', 'W'),
      parseSlot('E', 'E'),
      parseSlot('R', 'R'),
    ].filter(Boolean)

    return parts.length ? parts.join(' | ') : null
  } catch (e) {
    console.log(`Meraki fetch failed for ${merakiName}:`, e.message)
    return null
  }
}

// ── Champ select window ───────────────────────────────────────────────────────
function createChampSelectWindow() {
  if (champSelectWindow && !champSelectWindow.isDestroyed()) return
  const cfg = loadConfig()
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const w = 760, h = 250
  champSelectWindow = new BrowserWindow({
    width: w, height: h,
    x: cfg.csBarX ?? Math.floor((sw - w) / 2),
    y: cfg.csBarY ?? 90,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'champ-select-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  champSelectWindow.loadFile(path.join(__dirname, 'src', 'champ-select.html'))
  champSelectWindow.setAlwaysOnTop(true, 'screen-saver')
  champSelectWindow.on('moved', () => {
    if (!champSelectWindow.isDestroyed()) {
      const [x, y] = champSelectWindow.getPosition()
      saveConfig({ csBarX: x, csBarY: y })
    }
  })
}

function closeChampSelectWindow() {
  if (champSelectWindow && !champSelectWindow.isDestroyed()) {
    champSelectWindow.close()
    champSelectWindow = null
  }
  lastCSKey = null
}

// ── Post-game window ──────────────────────────────────────────────────────────
let postGameWindow = null

function createPostGameWindow(data) {
  if (postGameWindow && !postGameWindow.isDestroyed()) postGameWindow.close()
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 780, h = 300
  postGameWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2),
    y: Math.floor((sh - h) / 2),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,   // needs to be clickable so user can close it
    webPreferences: {
      preload: path.join(__dirname, 'post-game-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  postGameWindow.loadFile(path.join(__dirname, 'src', 'post-game.html'))
  postGameWindow.setAlwaysOnTop(true, 'screen-saver')
  postGameWindow.webContents.once('did-finish-load', () => {
    postGameWindow.webContents.send('post-game-data', data)
  })
}

// ── LCU polling ───────────────────────────────────────────────────────────────
function processChampSelect(session) {
  const myCell = session.localPlayerCellId
  const me     = (session.myTeam ?? []).find(p => p.cellId === myCell)
  if (!me) return

  const pos      = (me.assignedPosition || 'unknown').toUpperCase()
  const resolve  = id => (id > 0 ? (champIdMap[id] || `#${id}`) : null)

  const myTeam = (session.myTeam ?? []).map(p => ({
    position:   (p.assignedPosition || '').toUpperCase(),
    champion:   resolve(p.championId),
    championId: p.championId,
    summonerId: p.summonerId,
    isMe:       p.cellId === myCell,
  }))

  const theirTeam = (session.theirTeam ?? []).map(p => ({
    position:   (p.assignedPosition || '').toUpperCase(),
    champion:   resolve(p.championId),
    championId: p.championId,
    summonerId: p.summonerId,
  }))

  const bans = []
  for (const group of (session.actions ?? [])) {
    for (const act of group) {
      if (act.type === 'ban' && act.completed && act.championId > 0) {
        const n = resolve(act.championId)
        if (n) bans.push(n)
      }
    }
  }

  const myLocked = resolve(me.championId)
  const state    = { position: pos, myTeam, theirTeam, bans, myLocked }
  const key      = JSON.stringify(state)
  if (key === lastCSKey) return
  lastCSKey = key

  createChampSelectWindow()
  if (champSelectWindow && !champSelectWindow.isDestroyed())
    champSelectWindow.webContents.send('cs-update', state)
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('champ-select-active')
}

function startLCUPolling() {
  lcuPollInterval = setInterval(async () => {
    const lockPath = findLockfile()
    if (!lockPath) {
      if (champSelectWindow) closeChampSelectWindow()
      return
    }
    try {
      const { port, password } = parseLockfile(fs.readFileSync(lockPath, 'utf8'))
      lcuPort = port; lcuPass = password
      const session = await fetchLCU('/lol-champ-select/v1/session')
      processChampSelect(session)
    } catch {
      // Not in champ select — close window if open
      if (champSelectWindow) {
        closeChampSelectWindow()
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('champ-select-ended')
      }
    }
  }, 2000)
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  const cfg = loadConfig()
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize

  initAI(cfg.apiKey)

  mainWindow = new BrowserWindow({
    width: 900,
    height: 72,
    x: cfg.barX ?? Math.floor((screenWidth - 780) / 2),
    y: cfg.barY ?? 8,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    title: 'LoL Coach',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  createNotifWindow()

  mainWindow.on('moved', () => {
    if (!mainWindow.isDestroyed()) {
      const [x, y] = mainWindow.getPosition()
      saveConfig({ barX: x, barY: y })
    }
  })

  startPolling()
}

function createNotifWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 680, h = 130
  notifWindow = new BrowserWindow({
    width: w, height: h,
    x: Math.floor((sw - w) / 2),
    y: Math.floor(sh * 0.28),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'notif-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  notifWindow.loadFile(path.join(__dirname, 'src', 'notif.html'))
  notifWindow.setAlwaysOnTop(true, 'screen-saver')
  notifWindow.setIgnoreMouseEvents(true, { forward: true })
}


function fetchGameData() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/allgamedata',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 1500,
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.on('error', reject)
    req.end()
  })
}

function fetchEventsOnly() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1',
      port: 2999,
      path: '/liveclientdata/eventdata',
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 800,
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.on('error', reject)
    req.end()
  })
}

// ── Game scout window ─────────────────────────────────────────────────────────
function showGameScout(gameData) {
  if (gameScoutShown) return

  const allPlayers = gameData.allPlayers ?? []
  // Wait until the game actually has player data — first polls during loading
  // screen sometimes return an empty allPlayers array
  if (allPlayers.length === 0) return

  gameScoutShown = true

  const myName = gameData.activePlayer?.summonerName ?? ''

  // Find which team the local player is on — use case-insensitive compare
  // because the API can return Riot ID ("Name#TAG") or legacy names
  const me     = allPlayers.find(p =>
    p.summonerName?.toLowerCase() === myName.toLowerCase()
  )
  const myTeam = me?.team ?? (allPlayers[0]?.team ?? 'ORDER')

  const mapPlayer = p => ({
    summonerName: p.summonerName,
    champion:     p.championName
                  ?? (p.rawChampionName?.replace(/^game_character_displayname_/i, '') ?? '?'),
    championId:   nameToId[(p.championName ?? '').toLowerCase()] ?? 0,
    position:     (p.position || '').toUpperCase(),
    isMe:         p.summonerName?.toLowerCase() === myName.toLowerCase(),
  })

  const allies  = allPlayers.filter(p => p.team === myTeam).map(p => ({ ...mapPlayer(p), isAlly: true }))
  const enemies = allPlayers.filter(p => p.team !== myTeam).map(p => ({ ...mapPlayer(p), isAlly: false }))

  // Cache for AI coaching context
  scoutPlayers = [...allies, ...enemies]
  scoutStats   = {}

  console.log(`Scout: ${allies.length} allies, ${enemies.length} enemies (myTeam=${myTeam})`)

  // Fetch current champion kit from Meraki (live patch data)
  const myChamp = allies.find(p => p.isMe)
  if (myChamp?.champion) {
    currentChampKit = null
    fetchChampionKit(myChamp.champion).then(kit => {
      currentChampKit = kit
      console.log(`Meraki kit loaded for ${myChamp.champion}:`, kit ? 'OK' : 'failed')
    })
  }
}

function startPolling() {
  const poll = async () => {
    try {
      const data = await fetchGameData()
      gameWasRunning = true
      // Cache Win/Lose result during normal polling so it survives API shutdown
      const events = data?.events?.Events ?? []
      for (const ev of events) {
        if (ev.EventName === 'GameEnd' && ev.Result) {
          cachedGameResult = ev.Result
        }
      }
      showGameScout(data)
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('game-data', data)
    } catch {
      if (gameWasRunning) {
        // Game just ended — try one final events fetch to capture GameEnd result.
        // Even if the API is already down we still send cachedGameResult if we have it.
        gameWasRunning = false
        try {
          const evData = await fetchEventsOnly()
          // Merge cached result into event list in case this fetch missed it
          if (cachedGameResult && !evData?.Events?.some(e => e.EventName === 'GameEnd')) {
            evData.Events = [...(evData.Events ?? []), { EventName: 'GameEnd', Result: cachedGameResult }]
          }
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send('final-events', evData)
        } catch {
          // API fully down — synthesize the event from cached result if available
          if (cachedGameResult && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('final-events', {
              Events: [{ EventName: 'GameEnd', Result: cachedGameResult }]
            })
          }
        }
        cachedGameResult = null  // reset for next game
      }
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('game-not-running')
      // Reset so scout data is fresh next game
      gameScoutShown  = false
      scoutPlayers    = []
      scoutStats      = {}
      currentChampKit = null
    }
  }
  poll()
  pollInterval = setInterval(poll, 2000)
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on('close-window',    () => app.quit())
ipcMain.on('minimize-window', () => mainWindow?.minimize())

ipcMain.on('open-battle-log',   () => createBattleLogWindow())
ipcMain.on('toggle-battle-log', () => {
  if (battleLogWindow && !battleLogWindow.isDestroyed()) battleLogWindow.close()
  else createBattleLogWindow()
})
ipcMain.on('close-battle-log', () => { if (battleLogWindow && !battleLogWindow.isDestroyed()) battleLogWindow.close() })
ipcMain.on('save-battle-log',  (_, entry) => saveBattleLogEntry(entry))
ipcMain.handle('get-battle-log', () => loadBattleLog())

ipcMain.handle('delete-log-entry', (_, date) => {
  const target = new Date(date).getTime()
  const within = (d) => Math.abs(new Date(d).getTime() - target) < 180000
  // Remove from battle log
  try {
    const bl = loadBattleLog().filter(e => !within(e.date))
    fs.writeFileSync(battleLogPath, JSON.stringify(bl))
  } catch {}
  // Remove from session history
  try {
    const h = loadHistory().filter(e => !within(e.date))
    fs.writeFileSync(sessionPath, JSON.stringify(h))
  } catch {}
  // Push updated data to open window
  if (battleLogWindow && !battleLogWindow.isDestroyed())
    battleLogWindow.webContents.send('log-data', { battleLog: loadBattleLog(), history: loadHistory() })
})

ipcMain.handle('clear-all-logs', () => {
  try { fs.writeFileSync(battleLogPath, JSON.stringify([])) } catch {}
  try { fs.writeFileSync(sessionPath,   JSON.stringify([])) } catch {}
  if (battleLogWindow && !battleLogWindow.isDestroyed())
    battleLogWindow.webContents.send('log-data', { battleLog: [], history: [] })
})

ipcMain.on('show-center-notif', (event, data) => {
  if (notifWindow && !notifWindow.isDestroyed())
    notifWindow.webContents.send('notif', data)
})

ipcMain.on('dismiss-center-notif', () => {
  if (notifWindow && !notifWindow.isDestroyed())
    notifWindow.webContents.send('notif-dismiss')
})

ipcMain.on('show-post-game',   (_, data) => createPostGameWindow(data))
ipcMain.on('close-post-game',  () => { if (postGameWindow && !postGameWindow.isDestroyed()) postGameWindow.close() })
ipcMain.on('open-recent-games', () => createRecentGamesWindow())
ipcMain.on('open-url',          (_, url) => shell.openExternal(url))

ipcMain.handle('scout-stats', async (_, { summonerName }) => {
  if (!lcuPort || !lcuPass || !summonerName) return null
  try {
    const encoded  = encodeURIComponent(summonerName)
    const result   = await fetchLCU(`/lol-summoner/v1/summoners?name=${encoded}`)
    // LCU may return array or single object
    const summoner = Array.isArray(result) ? result[0] : result
    if (!summoner?.puuid) return null

    let rankDisplay = 'Unranked'
    let tier = 'unranked'
    try {
      const ranked = await fetchLCU(`/lol-ranked/v1/ranked-stats/${summoner.puuid}`)
      const soloQ  = ranked?.queueMap?.RANKED_SOLO_5x5
      if (soloQ && soloQ.tier && soloQ.tier !== 'NONE' && soloQ.tier !== '') {
        const wins  = soloQ.wins ?? 0
        const total = wins + (soloQ.losses ?? 0)
        const wr    = total > 0 ? Math.round((wins / total) * 100) : 0
        const tName = soloQ.tier.charAt(0) + soloQ.tier.slice(1).toLowerCase()
        const div   = (soloQ.division && soloQ.division !== 'NA') ? ` ${soloQ.division}` : ''
        rankDisplay = `${tName}${div} · ${wr}%`
        tier = soloQ.tier.toLowerCase()
      }
    } catch {}

    const stats = { display: rankDisplay, tier }
    scoutStats[summonerName] = stats   // cache for AI coaching
    return stats
  } catch (e) {
    console.log('scout-stats error:', e.message)
    return null
  }
})

ipcMain.handle('get-scout-context', () => buildScoutContext())
ipcMain.handle('get-champ-kit',    () => currentChampKit)

ipcMain.handle('ai-postgame', async (event, prompt) => {
  try {
    return await callAnthropic({
      systemText: 'You are a League of Legends post-game coach. Analyze why the player won or lost based on their stats and key events. Give 3-4 specific sentences. Identify the single most important factor and one concrete thing to improve next game. Reference their champion, role, and actual numbers. No fluff. No markdown, no asterisks, no bold formatting — plain text only.',
      userText: prompt, maxTokens: 200,
    })
  } catch (e) { console.error('AI post-game error:', e.message); return null }
})

ipcMain.handle('get-version',  () => app.getVersion())
ipcMain.handle('has-api-key',  () => !!loadConfig().apiKey)

ipcMain.handle('lcu-stats', async (_, { summonerId, championId }) => {
  if (!lcuPort || !lcuPass || !summonerId) return null
  try {
    // 1. Summoner → puuid
    const summoner = await fetchLCU(`/lol-summoner/v1/summoners/${summonerId}`)
    const puuid = summoner?.puuid
    if (!puuid) return null

    // 2. Ranked stats
    let rankDisplay = 'Unranked'
    let tier = 'unranked'
    try {
      const ranked = await fetchLCU(`/lol-ranked/v1/ranked-stats/${puuid}`)
      const soloQ  = ranked?.queueMap?.RANKED_SOLO_5x5
      if (soloQ && soloQ.tier && soloQ.tier !== 'NONE' && soloQ.tier !== '') {
        const wins  = soloQ.wins ?? 0
        const total = wins + (soloQ.losses ?? 0)
        const wr    = total > 0 ? Math.round((wins / total) * 100) : 0
        const tName = soloQ.tier.charAt(0) + soloQ.tier.slice(1).toLowerCase()
        const div   = (soloQ.division && soloQ.division !== 'NA') ? ` ${soloQ.division}` : ''
        rankDisplay = `${tName}${div} · ${wr}%`
        tier = soloQ.tier.toLowerCase()
      }
    } catch {}

    // 3. Champion mastery
    let masteryStr = ''
    if (championId > 0) {
      try {
        const m = await fetchLCU(`/lol-champion-mastery/v1/champion-mastery/by-summoner/${summonerId}/by-champion/${championId}`)
        const lvl = m?.championLevel ?? 0
        if (lvl >= 5) masteryStr = ` · M${lvl}${lvl >= 7 ? '⭐' : ''}`
      } catch {}
    }

    return { display: rankDisplay + masteryStr, tier }
  } catch (e) {
    console.log('lcu-stats error:', e.message)
    return null
  }
})

ipcMain.handle('save-api-key', (event, key) => {
  const trimmed = key.trim()
  saveConfig({ apiKey: trimmed })
  initAI(trimmed)
  return true
})

function trimToSentence(text) {
  if (!text) return text
  const m = text.match(/^[\s\S]*[.!?]/)
  return m ? m[0].trim() : text
}

ipcMain.handle('ai-coaching', async (event, prompt) => {
  if (!anthropicApiKey) return null
  const now = Date.now()
  if (now - lastAICallTime < 5000) return null
  lastAICallTime = now
  try {
    return trimToSentence(await callAnthropic({
      systemText: 'You are a League of Legends in-game coach. Give 1-2 specific actionable sentences tailored to the player\'s champion and role. Focus on macro play, win conditions, positioning, and objective control rather than specific ability names or mechanics that may have changed in recent patches. The game time is included in the prompt — never suggest objectives or events that have already passed. Name champions and objectives. If player intel with ranks is provided, call out high-elo threats. No fluff, no markdown. Max 50 words.',
      userText: prompt, maxTokens: 120,
    }))
  } catch (e) { console.error('AI coaching error:', e.message); return null }
})

ipcMain.handle('ai-game-start', async (event, prompt) => {
  try {
    return trimToSentence(await callAnthropic({
      systemText: 'You are a League of Legends in-game coach giving a game plan at match start. Give 2 sentences: one laning strategy based on the champion\'s general playstyle and matchup, one win condition. Avoid referencing specific ability names or mechanics that may be outdated — focus on macro patterns, trading windows, and power spikes by level/item. If player intel with ranks is included, call out high-elo threats by name. No markdown. Max 60 words.',
      userText: prompt, maxTokens: 150,
    }))
  } catch (e) { console.error('AI game-start error:', e.message); return null }
})

ipcMain.handle('ai-champ-select', async (event, prompt) => {
  try {
    return await callAnthropic({
      systemText: 'You are a League of Legends champion select coach. Recommend exactly 3 champions for the given role. Format your response as exactly 3 lines: "1. ChampName — reason" where reason is under 10 words. Consider enemy comp and ally synergy. Be specific.',
      userText: prompt, maxTokens: 160,
    })
  } catch (e) { console.error('AI champ-select error:', e.message); return null }
})

// ── Session history ───────────────────────────────────────────────────────────
const sessionPath = path.join(app.getPath('userData'), 'session-history.json')
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(sessionPath, 'utf8')) } catch { return [] }
}
ipcMain.handle('save-game-result', (_, result) => {
  const h = loadHistory()
  h.unshift({ ...result, date: new Date().toISOString() })
  if (h.length > 20) h.length = 20
  try { fs.writeFileSync(sessionPath, JSON.stringify(h)) } catch {}
})
ipcMain.handle('load-session-history', () => loadHistory().slice(0, 5))

// ── Alert settings ────────────────────────────────────────────────────────────
ipcMain.handle('load-alert-settings', () => {
  return loadConfig().alertMutes ?? { jg: false, objectives: false, missing: false, push: false, power: false }
})
ipcMain.handle('save-alert-settings', (_, mutes) => saveConfig({ alertMutes: mutes }))

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()
  loadChampionMap()   // pre-load so names are ready before champ select opens
  startLCUPolling()

  // globalShortcut uses RegisterHotKey which LoL's DirectInput bypasses.
  // uiohook-napi uses a low-level OS hook (WH_KEYBOARD_LL) that fires first.
  // setImmediate ensures the callback runs on the Node.js event loop thread.
  uIOhook.on('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.keycode === UiohookKey.C) {
      setImmediate(() => toggleControlPanel())
    }
  })
  uIOhook.start()

  globalShortcut.register('F9', () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('jg-ping')
  })

  globalShortcut.register('F12', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools()
      else mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  uIOhook.stop()
  if (tray) { tray.destroy(); tray = null }
})

app.on('window-all-closed', () => {
  clearInterval(pollInterval)
  clearInterval(lcuPollInterval)
  // Don't quit here — the "Quit" tray menu item calls app.quit() explicitly.
  // This lets the tray keep the app alive even if all windows are closed.
})
