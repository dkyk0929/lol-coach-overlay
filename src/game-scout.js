const POS_MAP = { TOP:'TOP', JUNGLE:'JG', MIDDLE:'MID', BOTTOM:'BOT', UTILITY:'SUP' }
const PORTRAIT_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'

document.getElementById('btn-close').addEventListener('click', () => window.scout.close())

const statCache    = new Map()
const statFetching = new Set()
const matchesCache = new Map()   // sid → recent match[] for the hover tooltip

window.scout.onData(({ allies, enemies }) => {
  renderTeam('ally-grid',  allies)
  renderTeam('enemy-grid', enemies)
  loadStats([...allies, ...enemies])
})

function renderTeam(gridId, players) {
  const grid = document.getElementById(gridId)
  grid.innerHTML = players.map(p => playerCard(p)).join('')
  setupDragReorder(grid)
}

// ── Manual drag-to-reorder (the API's lane data isn't always right — let the
// player fix it by dragging a card into the correct slot). Each team is a
// single row of 5, so reordering is purely left/right. ─────────────────────
let draggedCard = null

function setupDragReorder(grid) {
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.scout-card')
    if (!card) return
    draggedCard = card
    card.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })

  grid.addEventListener('dragend', () => {
    if (draggedCard) draggedCard.classList.remove('dragging')
    draggedCard = null
  })

  grid.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (!draggedCard) return
    const target = e.target.closest('.scout-card')
    if (!target || target === draggedCard || target.parentElement !== grid) return
    const rect = e.clientX - target.getBoundingClientRect().left
    const before = rect < target.offsetWidth / 2
    grid.insertBefore(draggedCard, before ? target : target.nextSibling)
  })
}

function playerCard(p) {
  const pos     = POS_MAP[p.position] ?? ''
  const cardCls = `scout-card${p.isMe ? ' me' : ''}`
  const nameCls = `champ-name${p.isMe ? ' me' : ''}`
  const imgCls  = `portrait${p.isMe ? ' me' : ''}`
  const prefix  = p.isMe ? '▶ ' : ''

  const portraitEl = (p.championId > 0)
    ? `<img class="${imgCls}" src="${PORTRAIT_BASE}/${p.championId}.png"
         onerror="this.outerHTML='<div class=\\'portrait-placeholder\\'></div>'">`
    : `<div class="portrait-placeholder"></div>`

  const posPill = pos
    ? `<span class="pos-pill pos-${pos}">${pos}</span>`
    : ''

  const sid = encodeId(p.summonerName)

  return `<div class="${cardCls}" draggable="true">
    ${portraitEl}
    <div class="champ-name-line">
      <span class="${nameCls}">${prefix}${p.champion ?? '?'}</span>
      ${posPill}
    </div>
    <div class="stat-line loading" id="stat-${sid}">···</div>
    <div class="kda-line" id="kda-${sid}"></div>
    <div class="rings-row" id="rings-${sid}"></div>
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

function ring(pct, color, label, sub, extraCls) {
  const deg = Math.round((pct ?? 0) * 3.6)
  return `<div class="ring-wrap ${extraCls || ''}">
    <div class="ring" style="background: conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.08) 0deg)">
      <div class="ring-inner">${pct}%</div>
    </div>
    <div class="ring-label">${label}<br>${sub}</div>
  </div>`
}

// A ring-shaped placeholder used for both "still loading" and "no data available" —
// keeps every card the same fixed size regardless of what data actually came back.
function emptyRing(label, sub) {
  return `<div class="ring-wrap empty">
    <div class="ring empty-ring"><div class="ring-inner">--</div></div>
    <div class="ring-label">${label}<br>${sub}</div>
  </div>`
}

function updateStatEl(name, stats) {
  const sid = encodeId(name)
  const el       = document.getElementById(`stat-${sid}`)
  const kdaEl    = document.getElementById(`kda-${sid}`)
  const ringsEl  = document.getElementById(`rings-${sid}`)
  if (!el) return

  // No stats resolved at all — bot, private profile, or lookup failed. Show an
  // explicit "hidden" state at the same fixed size, not blank space.
  if (!stats) {
    el.innerHTML  = `<span class="rank-badge tier-unranked">Account hidden</span>`
    el.className  = 'stat-line'
    if (kdaEl)   kdaEl.innerHTML = '<span class="dim">-- / -- / --</span>'
    if (ringsEl) ringsEl.innerHTML = `<div class="rings-inner">${emptyRing('Last 8', '--')}${emptyRing('Champ', '--')}</div>`
    return
  }

  matchesCache.set(sid, stats.history?.matches ?? [])

  el.innerHTML = `<span class="rank-badge tier-${stats.tier}">${escapeHtml(stats.display)}</span>`
  el.className = 'stat-line'

  const h = stats.history
  if (kdaEl) {
    if (h?.games && h.kda) {
      const [k, d, a] = h.kda.split(' / ').map(Number)
      const ratio = d > 0 ? (k + a) / d : k + a
      const kdaCls = ratio >= 4 ? 'kda-good' : ratio < 2 ? 'kda-bad' : ''
      kdaEl.innerHTML = `<span class="${kdaCls}">${h.kda} KDA</span> · ${h.csPerMin} CS/min`
    } else {
      kdaEl.innerHTML = '<span class="dim">No recent match data</span>'
    }
  }

  if (ringsEl) {
    if (h?.games) {
      const formPct = Math.round((h.wins / h.games) * 100)
      const formColor = formPct >= 55 ? 'var(--green)' : formPct <= 45 ? 'var(--red)' : 'var(--gold)'
      const formRing = ring(formPct, formColor, 'Last ' + h.games, `${h.wins}-${h.losses}`, 'hoverable')

      const champGames = h.currentChampWins + h.currentChampLosses
      const champPct   = champGames > 0 ? Math.round((h.currentChampWins / champGames) * 100) : 0
      // Small-sample thresholds — we only ever see up to 8 games total, so this is a
      // "worth a glance" heuristic, not a claim of real statistical significance.
      const isThreat = champGames >= 3 && champPct >= 65
      const isWeak   = champGames >= 3 && champPct <= 35
      const isStreak = champGames >= 2 && h.currentChampLosses === 0

      let champRing
      if (champGames > 0) {
        // Same neutral scale as the Last-8 ring (green = high win%, red = low) — the
        // pick-label pill below is what carries "threat to you" vs "good news" framing.
        const champColor = champPct >= 55 ? 'var(--green)' : champPct <= 45 ? 'var(--red)' : 'var(--gold)'
        champRing = ring(champPct, champColor, 'Champ', `${h.currentChampWins}-${h.currentChampLosses}`, '')
      } else {
        champRing = emptyRing('Champ', 'New')
      }

      let pickLabel = ''
      if (isThreat) pickLabel = '<span class="pick-label threat">&#9888; Threat</span>'
      else if (isStreak) pickLabel = `<span class="pick-label streak">${h.currentChampWins} win streak</span>`
      else if (isWeak) pickLabel = '<span class="pick-label weak">&#9660; Weak on champ</span>'
      else if (champGames >= 4) pickLabel = '<span class="pick-label comfort">Comfort pick</span>'
      else if (champGames > 0 && champGames <= 2) pickLabel = '<span class="pick-label new">New pick</span>'

      ringsEl.innerHTML = `<div class="rings-inner" data-sid="${sid}">${formRing}${champRing}</div>${pickLabel}`
    } else {
      ringsEl.innerHTML = `<div class="rings-inner">${emptyRing('Last 8', '--')}${emptyRing('Champ', '--')}</div>`
    }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Match history tooltip (hover the "Last 8" ring) ─────────────────────────────
const tooltip = document.getElementById('match-tooltip')

document.addEventListener('mouseover', (e) => {
  const ringEl = e.target.closest('.ring-wrap.hoverable')
  if (!ringEl) return
  const container = ringEl.closest('.rings-inner')
  if (!container) return
  const matches = matchesCache.get(container.dataset.sid)
  if (!matches || !matches.length) return

  tooltip.innerHTML = matches.map(m => `
    <div class="tt-row ${m.win ? 'tt-win' : 'tt-loss'}">
      <span class="tt-result">${m.win ? 'W' : 'L'}</span>
      <span class="tt-champ">${escapeHtml(m.champion)}</span>
      <span class="tt-kda">${m.kills}/${m.deaths}/${m.assists}</span>
      <span class="tt-cs">${m.csPerMin} CS/min</span>
    </div>`).join('')
  tooltip.classList.remove('hidden')
  positionTooltip(ringEl)
})

document.addEventListener('mouseout', (e) => {
  const ringEl = e.target.closest('.ring-wrap.hoverable')
  if (!ringEl) return
  if (e.relatedTarget && (e.relatedTarget === tooltip || tooltip.contains(e.relatedTarget))) return
  tooltip.classList.add('hidden')
})

function positionTooltip(anchorEl) {
  const rect = anchorEl.getBoundingClientRect()
  const tw = tooltip.offsetWidth || 180
  let left = rect.left
  if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8
  if (left < 8) left = 8
  let top = rect.bottom + 6
  if (top + tooltip.offsetHeight > window.innerHeight - 8) top = rect.top - tooltip.offsetHeight - 6
  tooltip.style.left = `${left}px`
  tooltip.style.top  = `${top}px`
}
