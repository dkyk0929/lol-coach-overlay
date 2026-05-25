// Runs in GitHub Actions (Node 20).
// Uses puppeteer-extra + stealth plugin to bypass Cloudflare bot detection,
// then intercepts Lolalytics' internal JSON API responses.

'use strict'
const { readFileSync, writeFileSync } = require('fs')
const path           = require('path')
const puppeteer      = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const BUILDS_PATH = path.join(__dirname, '..', 'builds.json')

const TREE_NAMES = { 8000:'Precision', 8100:'Domination', 8200:'Sorcery', 8300:'Inspiration', 8400:'Resolve' }
const KEYSTONE_NAMES = {
  8005:'Press the Attack', 8008:'Lethal Tempo',      8021:'Fleet Footwork', 8010:'Conqueror',
  8112:'Electrocute',      8124:'Predator',           8128:'Dark Harvest',   9923:'Hail of Blades',
  8214:'Summon Aery',      8229:'Arcane Comet',       8230:'Phase Rush',
  8351:'Glacial Augment',  8360:'Unsealed Spellbook', 8369:'First Strike',
  8437:'Grasp of the Undying', 8439:'Aftershock',     8465:'Guardian',
}
const KEYSTONE_ICONS = {
  8005:'Precision/PressTheAttack/PressTheAttack.png',
  8008:'Precision/LethalTempo/LethalTempoTemp.png',
  8021:'Precision/FleetFootwork/FleetFootwork.png',
  8010:'Precision/Conqueror/Conqueror.png',
  8112:'Domination/Electrocute/Electrocute.png',
  8124:'Domination/Predator/Predator.png',
  8128:'Domination/DarkHarvest/DarkHarvest.png',
  9923:'Domination/HailOfBlades/HailOfBlades.png',
  8214:'Sorcery/SummonAery/SummonAery.png',
  8229:'Sorcery/ArcaneComet/ArcaneComet.png',
  8230:'Sorcery/PhaseRush/PhaseRush.png',
  8351:'Inspiration/GlacialAugment/GlacialAugment.png',
  8360:'Inspiration/UnsealedSpellbook/UnsealedSpellbook.png',
  8369:'Inspiration/FirstStrike/FirstStrike.png',
  8437:'Resolve/GraspOfTheUndying/GraspOfTheUndying.png',
  8439:'Resolve/Aftershock/Aftershock.png',
  8465:'Resolve/Guardian/Guardian.png',
}
const PERK_IMG_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/'

const POS_SLUG      = { TOP:'top', JUNGLE:'jungle', MIDDLE:'mid', BOTTOM:'adc', UTILITY:'support' }
const ALL_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const champSlug     = (name) => name.toLowerCase().replace(/[^a-z]/g, '')

// ── Data Dragon champion list ────────────────────────────────────────────────
async function getAllChampions() {
  const vRes  = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  const ver   = (await vRes.json())[0]
  const cRes  = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)
  const cData = await cRes.json()
  return Object.values(cData.data).map(c => c.name)
}

// ── Rune / item parsers ──────────────────────────────────────────────────────
function parseRuneRow(r) {
  if (!r) return null
  const ids = Array.isArray(r.ids) ? r.ids : (r.selectedPerkIds ?? [])
  if (!ids.length) return null
  const primaryStyleId = r.primaryStyleId ?? 8000
  const subStyleId     = r.subStyleId     ?? 8200
  const rawWR          = r.wr ?? 0
  const icon           = KEYSTONE_ICONS[ids[0]]
  return {
    ids,
    primaryStyleId,
    subStyleId,
    keystone:      KEYSTONE_NAMES[ids[0]] ?? `Perk ${ids[0]}`,
    keystoneIcon:  icon ? PERK_IMG_BASE + icon : null,
    primaryTree:   TREE_NAMES[primaryStyleId] ?? 'Unknown',
    secondaryTree: TREE_NAMES[subStyleId]     ?? 'Unknown',
    winRate:       Math.round((rawWR < 1 ? rawWR * 100 : rawWR) * 10) / 10,
    pickRate:      r.n ?? r.pick ?? 0,
  }
}

// Try to find runes in any known shape of Lolalytics JSON payload
function extractRunes(data) {
  const candidates = [
    data?.runes?.items,
    data?.runes,
    data?.data?.runes?.items,
    data?.data?.runes,
    data?.pageProps?.data?.runes?.items,
    data?.props?.pageProps?.data?.runes?.items,
  ]
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && c[0]?.ids) return c
  }
  return null
}

function extractItems(data) {
  const candidates = [
    data?.items,
    data?.data?.items,
    data?.pageProps?.data?.items,
    data?.props?.pageProps?.data?.items,
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const core = Array.isArray(raw) ? raw : (raw.core ?? raw.coreItem ?? raw.items ?? null)
    if (Array.isArray(core) && core.length > 0) {
      const ids   = core.slice(0, 3).map(x => typeof x === 'object' ? x.id   : x).filter(Boolean)
      const names = core.slice(0, 3).map(x => typeof x === 'object' ? (x.name ?? '') : '').filter(Boolean)
      if (ids.length) return { ids, names }
    }
  }
  return null
}

function buildResult(apiData) {
  const runeRows = extractRunes(apiData)
  if (!runeRows || runeRows.length === 0) return null

  const byPick = [...runeRows].sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
  const byWR   = [...runeRows].sort((a, b) => {
    const w = r => r.wr != null ? (r.wr < 1 ? r.wr * 100 : r.wr) : 0
    return w(b) - w(a)
  })
  const mostUsedRunes = parseRuneRow(byPick[0])
  const mostWonRunes  = parseRuneRow(byWR[0])
  if (!mostUsedRunes) return null

  return {
    ddVersion: apiData?.patch ?? apiData?.ddVersion ?? '',
    mostUsed:  { runes: mostUsedRunes, items: extractItems(apiData) },
    mostWon:   { runes: mostWonRunes ?? mostUsedRunes, items: extractItems(apiData) },
  }
}

// ── Per-page fetch with response interception ────────────────────────────────
async function fetchChampBuild(page, name, position) {
  const url = `https://lolalytics.com/champion/${champSlug(name)}/${POS_SLUG[position]}/build/`

  return new Promise(async (resolve) => {
    let resolved = false
    const done = (val) => { if (!resolved) { resolved = true; resolve(val) } }

    // Timeout safety
    const timer = setTimeout(() => done(null), 20000)

    // Intercept all JSON responses from lolalytics.com
    const handler = async (response) => {
      try {
        const respUrl = response.url()
        if (!respUrl.includes('lolalytics.com')) return
        const ct = response.headers()['content-type'] ?? ''
        if (!ct.includes('json')) return

        const json = await response.json().catch(() => null)
        if (!json) return

        const result = buildResult(json)
        if (result) {
          clearTimeout(timer)
          page.off('response', handler)
          done(result)
        }
      } catch { /* ignore */ }
    }
    page.on('response', handler)

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
      // If Cloudflare shows "Just a moment..." wait for it to solve and redirect
      await page.waitForFunction(
        () => document.title !== 'Just a moment...' && document.title.length > 0,
        { timeout: 12000 }
      ).catch(() => {})
      // Extra pause for the real page's async data calls to fire
      await new Promise(r => setTimeout(r, 3000))
    } catch (e) {
      // navigation error — let the timeout fire or data already resolved
    }

    // If response interception didn't fire, try extracting from page state
    if (!resolved) {
      page.off('response', handler)
      const pageData = await page.evaluate(() => {
        // Try common global state variables used by analytics sites
        const candidates = [
          window.__INITIAL_STATE__,
          window.__APP_STATE__,
          window.__REDUX_STATE__,
          window.__DATA__,
          window.__NUXT__,
        ]
        // Also try script tags with JSON content
        for (const s of document.querySelectorAll('script[type="application/json"]')) {
          try { candidates.push(JSON.parse(s.textContent)) } catch {}
        }
        // Debug: log page title + first script data keys
        const title   = document.title
        const scripts = [...document.querySelectorAll('script:not([src])')].map(s => s.textContent.slice(0,80)).filter(Boolean)
        return { candidates: candidates.filter(Boolean), title, scriptCount: scripts.length, scripts: scripts.slice(0,3) }
      }).catch(() => null)

      if (pageData) {
        // Log debug info for first champion so we can diagnose the page structure
        if (name === 'Aatrox') {
          console.log(`\n[debug-${position}] title="${pageData.title}" scripts=${pageData.scriptCount}`)
          console.log(`[debug-${position}] intercepted=${pageData.interceptedUrls?.join(', ') ?? 'none'}`)
          console.log(`[debug-${position}] scripts:`, JSON.stringify(pageData.scripts).slice(0, 400))
        }
        for (const c of pageData.candidates) {
          const result = buildResult(c)
          if (result) { clearTimeout(timer); done(result); return }
        }
      }

      clearTimeout(timer)
      done(null)
    }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let existing = { _meta: { updated: '', patch: '' }, champions: {} }
  try { existing = JSON.parse(readFileSync(BUILDS_PATH, 'utf8')) } catch {}
  const champions = existing.champions ?? {}

  console.log('Fetching champion list from Data Dragon…')
  const allChampNames = await getAllChampions()
  console.log(`Found ${allChampNames.length} champions\n`)

  const browser = await puppeteer.launch({
    headless: true,   // stealth works best with legacy headless mode
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',  // extra CF evasion
    ],
  })
  const page = await browser.newPage()
  // Stealth plugin handles most fingerprinting, but set a realistic UA too
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  await page.setViewport({ width: 1280, height: 800 })

  console.log('Warming up (Cloudflare cookie via stealth)…')
  await page.goto('https://lolalytics.com/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log('Ready.\n')

  let updated = 0, skipped = 0

  for (const name of allChampNames) {
    const key = name.toLowerCase()
    if (!champions[key]) champions[key] = {}

    for (const pos of ALL_POSITIONS) {
      process.stdout.write(`${name}/${pos}… `)
      const result = await fetchChampBuild(page, name, pos)
      if (result) {
        champions[key][pos] = result
        console.log(`✓ ${result.mostUsed.runes.keystone}`)
        updated++
      } else {
        console.log('–')
        skipped++
      }
    }

    // Save after every champion so partial progress survives a crash
    const patch = Object.values(champions).flatMap(c => Object.values(c)).find(v => v.ddVersion)?.ddVersion ?? ''
    existing._meta = { updated: new Date().toISOString().slice(0, 10), patch }
    existing.champions = champions
    writeFileSync(BUILDS_PATH, JSON.stringify(existing, null, 2))
  }

  await browser.close()
  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
