// Runs in GitHub Actions (Node 20).
// Uses Puppeteer (headless Chrome) to render Lolalytics pages so Cloudflare
// bot protection is bypassed. Extracts __NEXT_DATA__ after page load.
// Champions / positions that fail are skipped; the rest are still saved.

'use strict'
const { readFileSync, writeFileSync } = require('fs')
const path    = require('path')
const puppeteer = require('puppeteer')

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

const POS_SLUG     = { TOP:'top', JUNGLE:'jungle', MIDDLE:'mid', BOTTOM:'adc', UTILITY:'support' }
const ALL_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const champSlug     = (name) => name.toLowerCase().replace(/[^a-z]/g, '')

// ── Data Dragon champion list ────────────────────────────────────────────────
async function getAllChampions() {
  const vRes    = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  const ver     = (await vRes.json())[0]
  const cRes    = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)
  const cData   = await cRes.json()
  return Object.values(cData.data).map(c => c.name)  // e.g. "Aurelion Sol", "Wukong"
}

// ── Rune / item parsers ──────────────────────────────────────────────────────
function parseRuneRow(r) {
  if (!r) return null
  const ids = Array.isArray(r.ids) ? r.ids : (r.selectedPerkIds ?? [])
  if (!ids.length) return null
  const primaryStyleId = r.primaryStyleId ?? 8000
  const subStyleId     = r.subStyleId     ?? 8200
  const keystoneId     = ids[0]
  const rawWR          = r.wr ?? 0
  const icon           = KEYSTONE_ICONS[keystoneId]
  return {
    ids,
    primaryStyleId,
    subStyleId,
    keystone:      KEYSTONE_NAMES[keystoneId] ?? `Perk ${keystoneId}`,
    keystoneIcon:  icon ? PERK_IMG_BASE + icon : null,
    primaryTree:   TREE_NAMES[primaryStyleId] ?? 'Unknown',
    secondaryTree: TREE_NAMES[subStyleId]     ?? 'Unknown',
    winRate:       Math.round((rawWR < 1 ? rawWR * 100 : rawWR) * 10) / 10,
    pickRate:      r.n ?? r.pick ?? 0,
  }
}

function extractRunes(pageProps) {
  for (const c of [
    pageProps?.data?.runes?.items,
    pageProps?.apiData?.runes,
    pageProps?.apiData?.data?.runes?.items,
    pageProps?.runesData,
  ]) {
    if (Array.isArray(c) && c.length > 0) return c
  }
  return null
}

function extractItems(pageProps) {
  for (const raw of [
    pageProps?.data?.items,
    pageProps?.apiData?.items,
    pageProps?.apiData?.data?.items,
  ]) {
    if (!raw) continue
    const core = Array.isArray(raw) ? raw : (raw.core ?? raw.coreItem ?? raw.items ?? null)
    if (Array.isArray(core) && core.length > 0) {
      const ids   = core.slice(0, 3).map(x => (typeof x === 'object' ? x.id   : x)).filter(Boolean)
      const names = core.slice(0, 3).map(x => (typeof x === 'object' ? (x.name ?? '') : '')).filter(Boolean)
      if (ids.length) return { ids, names }
    }
  }
  return null
}

// ── Puppeteer page fetch ──────────────────────────────────────────────────────
async function fetchChampBuild(page, name, position) {
  const url = `https://lolalytics.com/champion/${champSlug(name)}/${POS_SLUG[position]}/build/`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
    // Small pause so Next.js hydration + any Cloudflare challenge completes
    await new Promise(r => setTimeout(r, 2000))

    const nextData = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__')
      if (!el) return null
      try { return JSON.parse(el.textContent) } catch { return null }
    })

    if (!nextData) {
      console.warn(`  [skip] ${name}/${position}: no __NEXT_DATA__`)
      return null
    }

    const pageProps = nextData?.props?.pageProps ?? nextData?.pageProps ?? {}
    const runeRows  = extractRunes(pageProps)

    if (!runeRows || runeRows.length === 0) {
      // Log keys once per champion to debug structure if needed
      if (position === 'TOP') {
        console.warn(`  [debug] ${name}/${position}: no rune rows. keys: ${Object.keys(pageProps).slice(0,8).join(', ')}`)
      }
      return null
    }

    const byPick = [...runeRows].sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    const byWR   = [...runeRows].sort((a, b) => {
      const w = r => r.wr != null ? (r.wr < 1 ? r.wr * 100 : r.wr) : 0
      return w(b) - w(a)
    })

    const mostUsedRunes = parseRuneRow(byPick[0])
    const mostWonRunes  = parseRuneRow(byWR[0])
    if (!mostUsedRunes) return null

    return {
      ddVersion: pageProps?.ddVersion ?? pageProps?.patch ?? '',
      mostUsed:  { runes: mostUsedRunes, items: extractItems(pageProps) },
      mostWon:   { runes: mostWonRunes ?? mostUsedRunes, items: extractItems(pageProps) },
    }
  } catch (e) {
    console.warn(`  [skip] ${name}/${position}: ${e.message}`)
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let existing = { _meta: { updated: '', patch: '' }, champions: {} }
  try { existing = JSON.parse(readFileSync(BUILDS_PATH, 'utf8')) } catch { /* start fresh */ }
  const champions = existing.champions ?? {}

  console.log('Fetching champion list from Data Dragon…')
  const allChampNames = await getAllChampions()
  console.log(`Found ${allChampNames.length} champions\n`)

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  // Warm up — visits homepage so Cloudflare sets its cookie before we scrape
  console.log('Warming up (Cloudflare cookie)…')
  await page.goto('https://lolalytics.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
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

    // Save after every champion so partial progress is never lost
    const patch = Object.values(champions).flatMap(c => Object.values(c)).find(v => v.ddVersion)?.ddVersion ?? ''
    existing._meta = { updated: new Date().toISOString().slice(0, 10), patch }
    existing.champions = champions
    writeFileSync(BUILDS_PATH, JSON.stringify(existing, null, 2))
  }

  await browser.close()
  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) })
