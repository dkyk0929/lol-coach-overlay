// Runs in GitHub Actions (Node 20).
// Fetches Lolalytics build pages, parses embedded __NEXT_DATA__ JSON,
// and writes results to builds.json.
// Champions that fail (403/timeout/parse error) are skipped so the rest
// of the file is still written.

'use strict'
const { readFileSync, writeFileSync } = require('fs')
const path = require('path')

const BUILDS_PATH = path.join(__dirname, '..', 'builds.json')

const TREE_NAMES = { 8000:'Precision', 8100:'Domination', 8200:'Sorcery', 8300:'Inspiration', 8400:'Resolve' }
const KEYSTONE_NAMES = {
  8005:'Press the Attack', 8008:'Lethal Tempo',      8021:'Fleet Footwork', 8010:'Conqueror',
  8112:'Electrocute',      8124:'Predator',           8128:'Dark Harvest',   9923:'Hail of Blades',
  8214:'Summon Aery',      8229:'Arcane Comet',       8230:'Phase Rush',
  8351:'Glacial Augment',  8360:'Unsealed Spellbook',  8369:'First Strike',
  8437:'Grasp of the Undying', 8439:'Aftershock',    8465:'Guardian',
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

const POS_SLUG = { TOP:'top', JUNGLE:'jungle', MIDDLE:'mid', BOTTOM:'adc', UTILITY:'support' }

const champSlug = (name) => name.toLowerCase().replace(/[^a-z]/g, '')

// Lolalytics position slugs that actually have data for a given role
const ALL_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

// Fetch all champion names from Data Dragon (always current patch, all 160+ champs)
async function getAllChampions() {
  const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
  const versions    = await versionsRes.json()
  const ver         = versions[0]
  const dataRes     = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`)
  const data        = await dataRes.json()
  // data.data keys are internal names like "AurelionSol", "MonkeyKing" (Wukong), etc.
  // .name is the display name. We use the key (internal) for the slug since it matches Lolalytics.
  return Object.values(data.data).map(c => c.name)  // display names, e.g. "Aurelion Sol", "Wukong"
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://lolalytics.com/',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('__NEXT_DATA__ not found')
  return JSON.parse(match[1])
}

function parseRuneRow(r) {
  if (!r) return null
  const ids = Array.isArray(r.ids) ? r.ids : (r.selectedPerkIds ?? [])
  if (!ids.length) return null
  const primaryStyleId = r.primaryStyleId ?? 8000
  const subStyleId     = r.subStyleId     ?? 8200
  const keystoneId     = ids[0]
  const icon           = KEYSTONE_ICONS[keystoneId]
  const rawWR          = r.wr ?? 0
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
  const candidates = [
    pageProps?.data?.runes?.items,
    pageProps?.apiData?.runes,
    pageProps?.apiData?.data?.runes?.items,
    pageProps?.runesData,
  ]
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c
  }
  return null
}

function extractItems(pageProps) {
  const candidates = [
    pageProps?.data?.items,
    pageProps?.apiData?.items,
    pageProps?.apiData?.data?.items,
  ]
  for (const raw of candidates) {
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

async function fetchChampBuild(name, position) {
  const slug    = champSlug(name)
  const posSlug = POS_SLUG[position]
  const url     = `https://lolalytics.com/champion/${slug}/${posSlug}/build/`

  let html
  try { html = await fetchPage(url) }
  catch (e) { console.warn(`  [skip] ${name}/${position}: ${e.message}`); return null }

  let nextData
  try { nextData = extractNextData(html) }
  catch (e) { console.warn(`  [skip] ${name}/${position}: parse error — ${e.message}`); return null }

  const pageProps = nextData?.props?.pageProps ?? nextData?.pageProps ?? {}
  const runeRows  = extractRunes(pageProps)

  if (!runeRows || runeRows.length === 0) {
    console.warn(`  [debug] ${name}/${position}: no rune rows. pageProps keys: ${Object.keys(pageProps).join(', ')}`)
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

  const items = extractItems(pageProps)
  const ddVersion = pageProps?.ddVersion ?? pageProps?.patch ?? ''

  return {
    ddVersion,
    mostUsed: { runes: mostUsedRunes, items },
    mostWon:  { runes: mostWonRunes ?? mostUsedRunes, items },
  }
}

async function main() {
  let existing = { _meta: { updated: '', patch: '' }, champions: {} }
  try { existing = JSON.parse(readFileSync(BUILDS_PATH, 'utf8')) } catch { /* start fresh */ }

  const champions = existing.champions ?? {}
  let updated = 0, skipped = 0

  console.log('Fetching champion list from Data Dragon…')
  const allChampNames = await getAllChampions()
  console.log(`Found ${allChampNames.length} champions\n`)

  for (const name of allChampNames) {
    const key = name.toLowerCase()
    if (!champions[key]) champions[key] = {}

    for (const pos of ALL_POSITIONS) {
      console.log(`Fetching ${name} (${pos})…`)
      const result = await fetchChampBuild(name, pos)
      if (result) {
        champions[key][pos] = result
        console.log(`  ✓ ${name}/${pos}: ${result.mostUsed.runes.keystone} | items: ${result.mostUsed.items?.names?.join(', ') ?? 'none'}`)
        updated++
      } else {
        skipped++
      }
      await sleep(1200)
    }
  }

  const patch = Object.values(champions).flatMap(c => Object.values(c)).find(v => v.ddVersion)?.ddVersion ?? ''
  existing._meta = { updated: new Date().toISOString().slice(0, 10), patch }
  existing.champions = champions

  writeFileSync(BUILDS_PATH, JSON.stringify(existing, null, 2))
  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}. Patch: ${patch}`)
}

main().catch(e => { console.error(e); process.exit(1) })
