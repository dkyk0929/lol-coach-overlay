const POS_MAP = { TOP:'TOP', JUNGLE:'JG', MIDDLE:'MID', BOTTOM:'BOT', UTILITY:'SUP' }
const PORTRAIT_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'

document.getElementById('btn-close').addEventListener('click', () => window.scout.close())

const statCache    = new Map()
const statFetching = new Set()

window.scout.onData(({ allies, enemies }) => {
  renderTeam('ally-list',  allies,  true)
  renderTeam('enemy-list', enemies, false)
  loadStats([...allies, ...enemies])
})

function renderTeam(listId, players, isAlly) {
  document.getElementById(listId).innerHTML = players.map(p => playerRow(p, isAlly)).join('')
}

function playerRow(p, isAlly) {
  const pos     = POS_MAP[p.position] ?? ''
  const rowCls  = isAlly ? 'player-row' : 'player-row enemy-row'
  const nameCls = `champ-name${p.isMe ? ' me' : ''}`
  const imgCls  = `portrait${p.isMe ? ' me' : isAlly ? '' : ' enemy'}`
  const prefix  = p.isMe ? '▶ ' : ''

  const portraitEl = (p.championId > 0)
    ? `<img class="${imgCls}" src="${PORTRAIT_BASE}/${p.championId}.png"
         onerror="this.outerHTML='<div class=\\'portrait-placeholder\\'></div>'">`
    : `<div class="portrait-placeholder"></div>`

  const posPill = pos
    ? `<span class="pos-pill pos-${pos}">${pos}</span>`
    : ''

  const sid = encodeId(p.summonerName)

  return `<div class="${rowCls}">
    ${portraitEl}
    <div class="player-info">
      <div class="name-line">
        <span class="${nameCls}">${prefix}${p.champion ?? '?'}</span>
        ${posPill}
      </div>
      <div class="stat-line loading" id="stat-${sid}">···</div>
    </div>
  </div>`
}

// Safe DOM id from summoner name
function encodeId(name) {
  return (name ?? '').replace(/[^a-zA-Z0-9]/g, '_')
}

// ── Async stat loading ─────────────────────────────────────────────────────────

function loadStats(players) {
  for (const p of players) {
    const name = p.summonerName
    if (!name) continue
    if (statCache.has(name)) {
      updateStatEl(name, statCache.get(name))
    } else {
      fetchStats(name)
    }
  }
}

async function fetchStats(name) {
  if (statFetching.has(name) || statCache.has(name)) return
  statFetching.add(name)
  try {
    const stats = await window.scout.getStats(name)
    statCache.set(name, stats)
    updateStatEl(name, stats)
  } catch {
    statCache.set(name, null)
    updateStatEl(name, null)
  } finally {
    statFetching.delete(name)
  }
}

function updateStatEl(name, stats) {
  const el = document.getElementById(`stat-${encodeId(name)}`)
  if (!el) return
  if (!stats) {
    el.textContent = ''
    el.className   = 'stat-line'
    return
  }
  el.textContent = stats.display
  el.className   = `stat-line tier-${stats.tier}`
}
