const POS_SHORT = {
  TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'SUP', '': '', UNKNOWN: ''
}

const SPELL_NAMES = {
  1:  'Cleanse',  3:  'Exhaust', 4:  'Flash',    6:  'Ghost',
  7:  'Heal',     11: 'Smite',   12: 'Teleport', 13: 'Clarity',
  14: 'Ignite',   21: 'Barrier', 32: 'Mark',     39: 'Mark',
}

const PORTRAIT_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'

let lastAIPromptKey = null
let aiPending       = false

let csState = null   // latest full cs-update payload

window.cs.onUpdate(async (state) => {
  csState = state
  renderHeader(state)
  renderTeams(state)
  maybeRequestAI(state)
})

function renderHeader({ position, bans }) {
  const pos = POS_SHORT[position] ?? ''
  document.getElementById('role-label').textContent =
    pos ? `CHAMP SELECT  ·  ROLE: ${pos}` : 'CHAMP SELECT'
  document.getElementById('bans-label').textContent =
    bans.length ? `Bans: ${bans.join(', ')}` : ''
}

function renderTeams({ myTeam, theirTeam, myLocked }) {
  document.getElementById('ally-list').innerHTML  = myTeam.map(p => playerRow(p, true,  myLocked)).join('')
  document.getElementById('enemy-list').innerHTML = theirTeam.map(p => playerRow(p, false, null)).join('')
}

function playerRow(p, isAlly, myLocked) {
  const posKey = POS_SHORT[p.position] ?? ''
  const isMe   = isAlly && p.isMe
  const champ  = p.champion
  const cid    = p.championId

  const rowClass = isAlly ? 'player-row' : 'player-row enemy-row'

  let champClass = 'champ-name'
  let champText  = champ ?? '—'
  if (!champ)    { champClass += ' empty'; champText = '—' }
  else if (isMe) { champClass += ' me' }
  else           { champClass += ' locked' }

  let portraitEl
  if (cid && cid > 0) {
    const pClass = `portrait${isMe ? ' me' : champ ? ' locked' : ''}`
    portraitEl = `<img class="${pClass}" src="${PORTRAIT_BASE}/${cid}.png"
      onerror="this.outerHTML='<div class=\\'portrait-placeholder\\'></div>'">`
  } else {
    portraitEl = `<div class="portrait-placeholder"></div>`
  }

  const posPill = posKey
    ? `<span class="pos-pill pos-${posKey}">${posKey}</span>`
    : ''

  const spellPill = (id) => {
    const name = SPELL_NAMES[id]
    if (!name) return ''
    const cls = `spell-pill spell-${name.toLowerCase()}`
    return `<span class="${cls}">${name}</span>`
  }
  const spells = (p.spell1 || p.spell2)
    ? `<div class="spell-line">${spellPill(p.spell1)}${spellPill(p.spell2)}</div>`
    : ''

  return `<div class="${rowClass}">
    ${portraitEl}
    <div class="player-info">
      <div class="name-line">
        <span class="${champClass}">${isMe ? '▶ ' : ''}${champText}</span>
        ${posPill}
      </div>
      ${spells}
    </div>
  </div>`
}

// Parses "1. ChampName — reason" lines (also tolerates a plain "-" instead of an em dash)
function parsePicks(text) {
  const picks = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\d+[.):]?\s*([\w' .]+?)\s*[—–-]\s*(.+?)\s*$/)
    if (m) picks.push({ champion: m[1].trim(), reason: m[2].trim() })
  }
  return picks
}

// Champions the player swapped out this champ select (lowercase → display name).
// The window is recreated per champ select, so this resets on its own.
const dismissedPicks = new Map()
let shownPicks     = []     // [{champion, reason} | {loading:true} | {note}] — one entry per card
let lastPromptCtx  = null   // draft context reused when asking for a single replacement

function pickCard(p, idx) {
  if (p.loading) return `<div class="pick-card loading"><div class="pick-name">…</div><div class="pick-reason">Finding another pick</div></div>`
  if (p.note)    return `<div class="pick-card note"><div class="pick-reason">${escapeHtml(p.note)}</div></div>`
  return `<div class="pick-card swappable" data-idx="${idx}" title="Click to swap for a different pick">
    <div class="pick-name">${escapeHtml(p.champion)}</div>
    <div class="pick-reason">${escapeHtml(p.reason)}</div>
  </div>`
}

function renderPicks() {
  document.getElementById('ai-cards').innerHTML = shownPicks.map(pickCard).join('')
}

function buildPickPrompt(ctx, count, shownNames) {
  const { posName, allyPicks, enemyPicks, bans } = ctx
  const dismissed = [...dismissedPicks.values()]
  const avoid = [...new Set([...dismissed, ...shownNames])]
  return [
    `Champion select. My role: ${posName}`,
    allyPicks.length  ? `Ally picks so far:  ${allyPicks.join(', ')}` : 'Ally picks: none yet',
    enemyPicks.length ? `Enemy picks so far: ${enemyPicks.join(', ')}` : 'Enemy picks: none yet',
    bans.length       ? `Bans: ${bans.join(', ')}` : 'Bans: none yet',
    avoid.length      ? `Do not recommend: ${avoid.join(', ')}` : '',
    `Recommend ${count} champion${count === 1 ? '' : 's'} for ${posName} that counter the enemy and synergize with allies.`,
  ].filter(Boolean).join('\n')
}

// Clicking a card dismisses that champion and swaps in one fresh recommendation,
// keeping the other cards where they are.
async function swapPick(idx) {
  const old = shownPicks[idx]
  if (!old || old.loading || old.note || !lastPromptCtx) return

  dismissedPicks.set(old.champion.toLowerCase(), old.champion)
  const slot = { loading: true }
  shownPicks[idx] = slot
  renderPicks()

  const stillShown = () => shownPicks.filter(p => p.champion).map(p => p.champion)
  let replacement = null
  try {
    const result = await window.cs.aiRecommend(buildPickPrompt(lastPromptCtx, 1, stillShown()))
    const candidate = result ? parsePicks(result)[0] : null
    const key = candidate?.champion.toLowerCase()
    const taken = shownPicks.some(p => p.champion && p.champion.toLowerCase() === key)
    if (candidate && !dismissedPicks.has(key) && !taken) replacement = candidate
  } catch { /* falls through to the note below */ }

  // The draft may have changed (cards reset, or you locked in) while we waited
  const at = shownPicks.indexOf(slot)
  if (at === -1) return
  shownPicks[at] = replacement ?? { note: 'No other suggestion right now' }
  renderPicks()
}

document.getElementById('ai-cards').addEventListener('click', (e) => {
  const card = e.target.closest('.pick-card.swappable')
  if (card) swapPick(Number(card.dataset.idx))
})

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── AI recommendations ────────────────────────────────────────────────────────
async function maybeRequestAI({ position, myTeam, theirTeam, bans, myLocked }) {
  if (aiPending) return

  const enemyPicks = theirTeam.filter(p => p.champion).map(p => p.champion)
  if (!position || position === 'UNKNOWN' || enemyPicks.length < 1) return

  if (myLocked) {
    const el = document.getElementById('ai-content')
    if (!el.classList.contains('locked-in')) {
      el.className   = 'locked-in'
      el.textContent = `✓ Locked in: ${myLocked}`
      el.style.color = ''
      shownPicks = []
      renderPicks()
    }
    return
  }

  const allyPicks = myTeam.filter(p => p.champion && !p.isMe).map(p => p.champion)
  const promptKey = `${position}|${allyPicks.join(',')}|${enemyPicks.join(',')}|${bans.join(',')}`
  if (promptKey === lastAIPromptKey) return
  lastAIPromptKey = promptKey

  const el       = document.getElementById('ai-content')
  el.className   = 'loading'
  el.style.color = ''
  el.textContent = '✦ Asking AI for picks...'
  shownPicks = []
  renderPicks()

  const posName = { TOP:'Top', JUNGLE:'Jungle', MIDDLE:'Mid', BOTTOM:'Bot', UTILITY:'Support' }[position] ?? position
  lastPromptCtx = { posName, allyPicks, enemyPicks, bans }

  aiPending = true
  try {
    const result = await window.cs.aiRecommend(buildPickPrompt(lastPromptCtx, 3, []))
    if (result) {
      const picks = parsePicks(result).filter(p => !dismissedPicks.has(p.champion.toLowerCase()))
      if (picks.length) {
        el.textContent = ''
        el.className   = 'hidden'
        shownPicks = picks
        renderPicks()
      } else {
        // Fallback: AI didn't follow the expected format — show raw text rather than nothing
        el.className   = ''
        el.style.color = '#7ee8f5'
        el.textContent = '✦ ' + result
      }
    } else {
      el.className   = 'waiting'
      el.textContent = 'AI unavailable — set API key in HUD'
    }
  } catch (err) {
    el.className   = 'waiting'
    el.textContent = `AI error: ${err.message || 'Could not reach AI'}`
  } finally {
    aiPending = false
  }
}

