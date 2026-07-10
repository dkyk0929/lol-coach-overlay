const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell, Tray, Menu, nativeImage, net, dialog } = require('electron')
const { uIOhook, UiohookKey } = require('uiohook-napi')

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('disable-gpu-watchdog')
const https = require('https')
const path  = require('path')
const fs    = require('fs')

let mainWindow
let notifWindow
let champSelectWindow
let controlPanelWindow = null
let infoWindow = null
let tray = null
let pollInterval
let lcuPollInterval
let ttsMuted = false   // synced from renderer
let anthropicApiKey = null
let geminiApiKey = null
let aiProvider = 'anthropic'
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
  const w = 580, h = 640
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

// ── Info & Links window ────────────────────────────────────────────────────────
function createInfoWindow() {
  if (infoWindow && !infoWindow.isDestroyed()) {
    infoWindow.focus(); return
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = 400, h = 250
  infoWindow = new BrowserWindow({
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
      preload: path.join(__dirname, 'info-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  infoWindow.loadFile(path.join(__dirname, 'src', 'info.html'))
  infoWindow.setAlwaysOnTop(true, 'screen-saver')
}

ipcMain.on('open-info-window',   () => createInfoWindow())
ipcMain.on('toggle-info-window', () => {
  if (infoWindow && !infoWindow.isDestroyed()) infoWindow.close()
  else createInfoWindow()
})
ipcMain.on('close-info-window', () => { if (infoWindow && !infoWindow.isDestroyed()) infoWindow.close() })

ipcMain.handle('get-ai-status', () => {
  const cfg = loadConfig()
  const hasAnthropic = !!cfg.apiKey
  const hasGemini = !!cfg.geminiApiKey
  const activeProvider = cfg.aiProvider || 'anthropic'
  const hasKey = activeProvider === 'gemini' ? hasGemini : hasAnthropic
  return {
    hasAnthropicKey: hasAnthropic,
    hasGeminiKey: hasGemini,
    aiProvider: activeProvider,
    hasKey: hasKey
  }
})

ipcMain.handle('save-api-key-from-setup', async (_, provider, key) => {
  const trimmed = key.trim()
  if (provider === 'gemini') {
    const originalGeminiApiKey = geminiApiKey
    geminiApiKey = trimmed
    try {
      const res = await callGemini({
        systemText: 'System test key.',
        userText: 'Respond with OK',
        maxTokens: 5
      })
      if (!res) {
        throw new Error('Received empty response from Gemini API')
      }
    } catch (err) {
      geminiApiKey = originalGeminiApiKey // restore
      return { success: false, error: err.message }
    }
    saveConfig({ geminiApiKey: trimmed, aiProvider: 'gemini' })
    aiProvider = 'gemini'
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('ai-key-saved')
    return { success: true }
  } else {
    const originalApiKey = anthropicApiKey
    anthropicApiKey = trimmed
    try {
      const res = await callAnthropic({
        systemText: 'System test key.',
        userText: 'Respond with OK',
        maxTokens: 5
      })
      if (!res) {
        throw new Error('Received empty response from Anthropic API')
      }
    } catch (err) {
      anthropicApiKey = originalApiKey // restore
      return { success: false, error: err.message }
    }
    saveConfig({ apiKey: trimmed, aiProvider: 'anthropic' })
    aiProvider = 'anthropic'
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('ai-key-saved')
    return { success: true }
  }
})

ipcMain.handle('set-ai-provider', (_, provider) => {
  if (provider === 'anthropic' || provider === 'gemini') {
    saveConfig({ aiProvider: provider })
    aiProvider = provider
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('ai-key-saved')
    return { success: true }
  }
  return { success: false, error: 'Invalid provider' }
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
let lcuPort       = null
let lcuPass       = null
let lcuSummonerId = null   // cached from /lol-summoner/v1/current-summoner
let champIdMap    = {}
let nameToId      = {}     // display name (lower) → numeric id
let nameToInternal= {}     // display name (lower) → internal name (e.g. "AurelionSol")
let lastCSKey     = null   // detect meaningful champ-select changes
let ddVersion     = null   // latest Data Dragon version (set when champ map loads)
let itemRecipesText = ''  // resolved "Name = Comp1 + Comp2 (Xg total)" lines, from Data Dragon


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
const itemCachePath = path.join(app.getPath('userData'), 'item-recipes-cache.json')

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch { return {} }
}

function saveConfig(patch) {
  const cfg = loadConfig()
  try { fs.writeFileSync(configPath, JSON.stringify({ ...cfg, ...patch })) } catch {}
}

function initAI(cfg) {
  anthropicApiKey = cfg.apiKey?.trim() || null
  geminiApiKey = cfg.geminiApiKey?.trim() || null
  aiProvider = cfg.aiProvider || 'anthropic'
}

let gameRulesCached = null
function getGameRulesText() {
  if (gameRulesCached !== null) return gameRulesCached
  try {
    const filePath = path.join(__dirname, 'src', 'data', 'game_rules.json')
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const rules = []
      if (data.patch) rules.push(`Current Patch: ${data.patch}`)
      if (data.removed_items && data.removed_items.length > 0) {
        rules.push(`REMOVED ITEMS (DO NOT suggest or mention these): ${data.removed_items.join(', ')}`)
      }
      if (data.replaced_or_renamed && data.replaced_or_renamed.length > 0) {
        rules.push(`REPLACED OR RENAMED ITEMS: ${data.replaced_or_renamed.join(', ')}`)
      }
      if (data.new_items_introduced && data.new_items_introduced.length > 0) {
        rules.push(`NEW ITEMS IN CURRENT META: ${data.new_items_introduced.join(', ')}`)
      }
      if (data.objective_spawn_rules && data.objective_spawn_rules.length > 0) {
        rules.push(`OBJECTIVE TIMINGS: ${data.objective_spawn_rules.join(' | ')}`)
      }
      if (data.champion_reworks && data.champion_reworks.length > 0) {
        rules.push(`CHAMPION REWORKS INFO: ${data.champion_reworks.join(' | ')}`)
      }
      if (data.general_notes && data.general_notes.length > 0) {
        rules.push(`ADDITIONAL RULES & CONSTRAINTS: ${data.general_notes.join(' ')}`)
      }
      if (itemRecipesText) {
        rules.push(`VERIFIED ITEM RECIPES (use these exact component paths, do not guess others): ${itemRecipesText}`)
      }
      gameRulesCached = '\n\n' + rules.join('\n')
      return gameRulesCached
    }
  } catch (e) {
    console.error('Failed to load game rules:', e.message)
  }
  return ''
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
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode !== 200) {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`
            reject(new Error(errMsg))
          } else {
            resolve(parsed.content?.[0]?.text?.trim() ?? null)
          }
        }
        catch (err) { reject(new Error('Failed to parse API response: ' + err.message)) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 15 seconds')) })
    req.on('error', (e) => {
      let msg = e.message
      if (msg.includes('CERT') || msg.includes('cert') || msg.includes('ssl')) {
        msg = 'SSL Certificate Verification Error. Usually caused by an antivirus, firewall, proxy, or VPN decrypting your network traffic.'
      }
      reject(new Error(msg))
    })
    req.write(body)
    req.end()
  })
}

// Same as callAnthropic but with the web_search tool enabled — used once at
// game start for a grounded matchup/itemization brief, since that call has
// slack time (early laning) unlike the fast in-game coaching calls, which
// must stay search-free to keep latency low.
function callAnthropicWithSearch({ systemText, userText, maxTokens }) {
  return new Promise((resolve, reject) => {
    if (!anthropicApiKey) { resolve(null); return }
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: [{ type: 'text', text: systemText }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: userText }],
    })
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      timeout: 25000,
      headers: {
        'content-type':      'application/json',
        'x-api-key':         anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-length':    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode !== 200) {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`
            reject(new Error(errMsg))
          } else {
            // Response interleaves text blocks with server_tool_use / web_search_tool_result
            // blocks — concatenate just the text blocks for the final answer.
            const text = (parsed.content ?? [])
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join(' ')
              .trim()
            resolve(text || null)
          }
        }
        catch (err) { reject(new Error('Failed to parse API response: ' + err.message)) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 25 seconds')) })
    req.on('error', (e) => reject(new Error(e.message)))
    req.write(body)
    req.end()
  })
}

// Direct HTTPS call to Gemini API
function callGemini({ systemText, userText, maxTokens }) {
  return new Promise((resolve, reject) => {
    if (!geminiApiKey) { resolve(null); return }
    const body = JSON.stringify({
      contents: [{
        parts: [{ text: userText }]
      }],
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      generationConfig: {
        maxOutputTokens: maxTokens,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    })
    
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      timeout: 15000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode !== 200) {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`
            reject(new Error(errMsg))
          } else {
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text
            resolve(text?.trim() ?? null)
          }
        }
        catch (err) { reject(new Error('Failed to parse API response: ' + err.message)) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 15 seconds')) })
    req.on('error', (e) => {
      let msg = e.message
      if (msg.includes('CERT') || msg.includes('cert') || msg.includes('ssl')) {
        msg = 'SSL Certificate Verification Error. Usually caused by an antivirus, firewall, proxy, or VPN.'
      }
      reject(new Error(msg))
    })
    req.write(body)
    req.end()
  })
}

// Same as callGemini but with Google Search grounding enabled — used for the
// one-time, web-search-grounded matchup brief (see callAnthropicWithSearch).
function callGeminiWithSearch({ systemText, userText, maxTokens }) {
  return new Promise((resolve, reject) => {
    if (!geminiApiKey) { resolve(null); return }
    const body = JSON.stringify({
      contents: [{
        parts: [{ text: userText }]
      }],
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      tools: [{ google_search: {} }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        thinkingConfig: {
          thinkingBudget: 0
        }
      }
    })

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      timeout: 25000,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode !== 200) {
            const errMsg = parsed.error?.message || `HTTP ${res.statusCode}`
            reject(new Error(errMsg))
          } else {
            const text = parsed.candidates?.[0]?.content?.parts
              ?.map(p => p.text).filter(Boolean).join(' ')
            resolve(text?.trim() || null)
          }
        }
        catch (err) { reject(new Error('Failed to parse API response: ' + err.message)) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 25 seconds')) })
    req.on('error', (e) => reject(new Error(e.message)))
    req.write(body)
    req.end()
  })
}

// Routing wrapper
function callAI({ systemText, userText, maxTokens }) {
  if (aiProvider === 'gemini') {
    return callGemini({ systemText, userText, maxTokens })
  } else {
    return callAnthropic({ systemText, userText, maxTokens })
  }
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
    console.log('LCU client not detected (normal when League is closed). Using Data Dragon champion map fallback.')
  }

  // Fallback: Riot Data Dragon CDN
  try {
    const versions  = await fetchJSON('https://ddragon.leagueoflegends.com/api/versions.json')
    const version   = versions[0]
    ddVersion = version
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

// ── Item recipe fetcher (Data Dragon) ─────────────────────────────────────────
// Builds "Name = Comp1 + Comp2 (Xg total)" lines for every purchasable Summoner's
// Rift item with a build path, so the AI never has to guess/hallucinate a recipe.
// Cached to disk keyed by Data Dragon version — only re-fetches on a patch change.
async function loadItemRecipes() {
  try {
    let version = ddVersion
    if (!version) {
      const versions = await fetchJSON('https://ddragon.leagueoflegends.com/api/versions.json')
      version = versions[0]
    }

    let cached = null
    try { cached = JSON.parse(fs.readFileSync(itemCachePath, 'utf8')) } catch {}
    if (cached && cached.version === version && cached.text) {
      itemRecipesText = cached.text
      gameRulesCached = null
      console.log(`Item recipes loaded from cache (Data Dragon ${version}): ${cached.count} items`)
      return
    }

    const itemData = await fetchJSON(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)
    const idToName = {}
    for (const [id, item] of Object.entries(itemData.data)) idToName[id] = item.name

    const seen = new Set()
    const lines = []
    for (const item of Object.values(itemData.data)) {
      if (!item.maps?.['11'] || !item.gold?.purchasable) continue
      if ((item.depth ?? 1) < 2) continue           // skip basic components, not "recipes"
      if (!item.from || item.from.length === 0) continue
      if (seen.has(item.name)) continue             // dedup alt item-IDs for the same name
      seen.add(item.name)
      const comps = item.from.map(id => idToName[id] ?? '?').join(' + ')
      lines.push(`${item.name} = ${comps} (${item.gold.total}g total)`)
    }

    itemRecipesText = lines.join(' | ')
    gameRulesCached = null   // force getGameRulesText() to rebuild with fresh recipes
    try {
      fs.writeFileSync(itemCachePath, JSON.stringify({ version, text: itemRecipesText, count: lines.length }))
    } catch {}
    console.log(`Item recipes loaded from Data Dragon ${version}: ${lines.length} items`)
  } catch (e) {
    // Fail soft — fall back to whatever's cached on disk (even from an older version)
    // rather than leaving the AI with zero recipe grounding.
    try {
      const cached = JSON.parse(fs.readFileSync(itemCachePath, 'utf8'))
      if (cached?.text) { itemRecipesText = cached.text; gameRulesCached = null }
    } catch {}
    console.error('Item recipe fetch failed:', e.message)
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
  const w = 760, h = 360
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
    spell1:     p.spell1Id ?? 0,
    spell2:     p.spell2Id ?? 0,
    isMe:       p.cellId === myCell,
  }))

  const theirTeam = (session.theirTeam ?? []).map(p => ({
    position:   (p.assignedPosition || '').toUpperCase(),
    champion:   resolve(p.championId),
    championId: p.championId,
    summonerId: p.summonerId,
    spell1:     p.spell1Id ?? 0,
    spell2:     p.spell2Id ?? 0,
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

  const myLocked     = resolve(me.championId)
  const myChampionId = me.championId ?? 0
  const mySummonerId = me.summonerId  ?? 0
  const state        = { position: pos, myTeam, theirTeam, bans, myLocked, myChampionId, mySummonerId }
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
      if (port !== lcuPort || password !== lcuPass) {
        lcuPort = port; lcuPass = password
        lcuSummonerId = null   // reset so we re-fetch on next tick
      }
      if (!lcuSummonerId) {
        try {
          const me = await fetchLCU('/lol-summoner/v1/current-summoner')
          if (me?.summonerId) lcuSummonerId = me.summonerId
        } catch { /* not ready yet */ }
      }
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

  initAI(cfg)

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


// ── Update checker ────────────────────────────────────────────────────────────
function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/repos/dkyk0929/lol-coach-overlay/releases/latest',
      method: 'GET',
      headers: { 'User-Agent': 'lol-coach-overlay' },
      timeout: 5000,
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

// Returns true if `a` (e.g. "1.8.2") is newer than `b`
function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0, nb = pb[i] ?? 0
    if (na !== nb) return na > nb
  }
  return false
}

async function checkForUpdate() {
  try {
    const release = await fetchLatestRelease()
    const latestTag = (release?.tag_name ?? '').replace(/^v/, '')
    if (!latestTag) return
    const current = app.getVersion()
    if (isNewerVersion(latestTag, current)) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update available',
        message: `A new version is available: v${latestTag} (you have v${current})`,
        detail: release.name || '',
        buttons: ['Download Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      if (response === 0) {
        shell.openExternal(release.html_url || 'https://github.com/dkyk0929/lol-coach-overlay/releases/latest')
      }
    }
  } catch (e) {
    console.error('Update check failed:', e.message)
  }
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
ipcMain.on('open-coffee',      () => shell.openExternal('https://buymeacoffee.com/bdannykimt'))
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
  const cfg = loadConfig()
  const provider = cfg.aiProvider || 'anthropic'
  const hasKey = provider === 'gemini' ? !!cfg.geminiApiKey : !!cfg.apiKey
  if (!hasKey) return null

  try {
    return await callAI({
      systemText: 'You are a League of Legends post-game coach. Analyze why the player won or lost based on their stats and key events. Give 3-4 specific sentences. Identify the single most important factor and one concrete thing to improve next game. Reference their champion, role, and actual numbers. No fluff. No markdown, no asterisks, no bold formatting — plain text only.' + getGameRulesText(),
      userText: prompt, maxTokens: 200,
    })
  } catch (e) {
    console.error('AI post-game error:', e.message)
    throw e
  }
})

ipcMain.handle('get-version',  () => app.getVersion())
ipcMain.handle('has-api-key',  () => {
  const cfg = loadConfig()
  const provider = cfg.aiProvider || 'anthropic'
  return provider === 'gemini' ? !!cfg.geminiApiKey : !!cfg.apiKey
})

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
  saveConfig({ apiKey: trimmed, aiProvider: 'anthropic' })
  initAI(loadConfig())
  return true
})

function trimToSentence(text) {
  if (!text) return text
  const m = text.match(/^[\s\S]*[.!?]/)
  return m ? m[0].trim() : text
}

ipcMain.handle('ai-coaching', async (event, prompt) => {
  const hasKey = aiProvider === 'gemini' ? !!geminiApiKey : !!anthropicApiKey
  if (!hasKey) return null
  const now = Date.now()
  if (now - lastAICallTime < 5000) return null
  lastAICallTime = now
  try {
    return trimToSentence(await callAI({
      systemText: 'You are a League of Legends in-game coach. Give 1-2 specific actionable sentences tailored to the player\'s champion, role, and current state. Focus on macro play, win conditions, positioning, build adjustments, and objective control. Analyze the enemy team composition/items to suggest counter items (e.g. Magic Resist, Anti-heal, Pen) when appropriate. NEVER recommend buying or building an item that is already listed in the player\'s inventory (\'My items\'). Be aware of game momentum (recent events). On death, analyze the killer\'s details to recommend defensive pivots. Never suggest objectives or events that have already passed. Name champions. No fluff, no markdown. Max 50 words.' + getGameRulesText(),
      userText: prompt, maxTokens: 120,
    }))
  } catch (e) { console.error('AI coaching error:', e.message); return null }
})

ipcMain.handle('ai-game-start', async (event, prompt) => {
  const cfg = loadConfig()
  const provider = cfg.aiProvider || 'anthropic'
  const hasKey = provider === 'gemini' ? !!cfg.geminiApiKey : !!cfg.apiKey
  if (!hasKey) return null

  try {
    const responseText = await callAI({
      systemText: 'You are a League of Legends in-game coach giving a game plan at match start. Analyze the matchup and return a JSON object with exactly two keys:\n1. "advice": A string of exactly 2 sentences: one laning strategy based on the champion\'s general playstyle and matchup, one win condition. Focus on macro patterns. Avoid referencing specific ability names. If player intel with ranks is included, call out high-elo threats by name.\n2. "targetCS": A number representing the recommended target CS per minute for this matchup (e.g., between 5.0 and 9.5). Default to 7.0 if unsure.\nReturn ONLY the JSON object. Do not include markdown formatting or wrapper text.' + getGameRulesText(),
      userText: prompt, maxTokens: 200,
    })
    if (!responseText) return null
    const cleaned = responseText.replace(/```json|```/g, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      return {
        advice: trimToSentence(parsed.advice),
        targetCS: typeof parsed.targetCS === 'number' ? parsed.targetCS : 7.0
      }
    } catch (parseErr) {
      console.error('JSON parse failed for game-start, falling back:', parseErr.message)
      let targetCS = 7.0
      const csMatch = cleaned.match(/"targetCS"\s*:\s*([0-9.]+)/)
      if (csMatch && csMatch[1]) {
        const val = parseFloat(csMatch[1])
        if (!isNaN(val)) targetCS = val
      }
      return {
        advice: trimToSentence(cleaned),
        targetCS
      }
    }
  } catch (e) {
    console.error('AI game-start error:', e.message)
    throw e
  }
})

// One-time, web-search-grounded matchup + itemization brief fired at game
// start (has slack time unlike the fast in-game coaching calls). Cached by
// the renderer and appended as context to every ai-coaching call afterward.
ipcMain.handle('ai-matchup-brief', async (event, prompt) => {
  const cfg = loadConfig()
  const provider = cfg.aiProvider || 'anthropic'
  const hasKey = provider === 'gemini' ? !!cfg.geminiApiKey : !!cfg.apiKey
  if (!hasKey) return null

  const systemText = 'You are a League of Legends coach with live web search access. Research the specific champion matchup and role given, using current patch information. Give a concise answer in under 120 words covering: (1) how to play the matchup — key things to do and avoid, (2) the win condition, (3) recommended item build for this specific matchup. No markdown, no asterisks, plain text only.' + getGameRulesText()

  try {
    return provider === 'gemini'
      ? await callGeminiWithSearch({ systemText, userText: prompt, maxTokens: 300 })
      : await callAnthropicWithSearch({ systemText, userText: prompt, maxTokens: 300 })
  } catch (e) {
    console.error('AI matchup brief error:', e.message)
    return null
  }
})

ipcMain.handle('ai-champ-select', async (event, prompt) => {
  const cfg = loadConfig()
  const provider = cfg.aiProvider || 'anthropic'
  const hasKey = provider === 'gemini' ? !!cfg.geminiApiKey : !!cfg.apiKey
  if (!hasKey) return null

  try {
    return await callAI({
      systemText: 'You are a League of Legends champion select coach. Recommend exactly 3 champions for the given role. Format your response as exactly 3 lines: "1. ChampName — reason" where reason is under 10 words. Consider enemy comp and ally synergy. Be specific.' + getGameRulesText(),
      userText: prompt, maxTokens: 160,
    })
  } catch (e) {
    console.error('AI champ-select error:', e.message)
    throw e
  }
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
  loadChampionMap().then(loadItemRecipes)   // item recipes reuse ddVersion set by the champ map load
  startLCUPolling()
  checkForUpdate()

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

  // Manual lane pings — lets the player confirm a sighting with their own
  // eyes/minimap, since the Live Client API has no fog-of-war visibility data.
  const LANE_PING_KEYS = { F5: 'TOP', F6: 'MIDDLE', F7: 'BOTTOM', F8: 'UTILITY' }
  for (const [key, position] of Object.entries(LANE_PING_KEYS)) {
    globalShortcut.register(key, () => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('lane-ping', position)
    })
  }

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
