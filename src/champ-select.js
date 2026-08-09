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

function pickCard({ champion, reason }) {
  return `<div class="pick-card">
    <div class="pick-name">${escapeHtml(champion)}</div>
    <div class="pick-reason">${escapeHtml(reason)}</div>
  </div>`
}

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
      document.getElementById('ai-cards').innerHTML = ''
    }
    return
  }

  const allyPicks = myTeam.filter(p => p.champion && !p.isMe).map(p => p.champion)
  const promptKey = `${position}|${allyPicks.join(',')}|${enemyPicks.join(',')}|${bans.join(',')}`
  if (promptKey === lastAIPromptKey) return
  lastAIPromptKey = promptKey

  const el       = document.getElementById('ai-content')
  const cardsEl  = document.getElementById('ai-cards')
  el.className   = 'loading'
  el.style.color = ''
  el.textContent = '✦ Asking AI for picks...'
  cardsEl.innerHTML = ''

  const posName = { TOP:'Top', JUNGLE:'Jungle', MIDDLE:'Mid', BOTTOM:'Bot', UTILITY:'Support' }[position] ?? position
  const lines = [
    `Champion select. My role: ${posName}`,
    allyPicks.length  ? `Ally picks so far:  ${allyPicks.join(', ')}` : 'Ally picks: none yet',
    enemyPicks.length ? `Enemy picks so far: ${enemyPicks.join(', ')}` : 'Enemy picks: none yet',
    bans.length       ? `Bans: ${bans.join(', ')}` : 'Bans: none yet',
    `Recommend 3 champions for ${posName} that counter the enemy and synergize with allies.`,
  ]

  aiPending = true
  try {
    const result = await window.cs.aiRecommend(lines.join('\n'))
    if (result) {
      const picks = parsePicks(result)
      if (picks.length) {
        el.textContent = ''
        el.className   = 'hidden'
        cardsEl.innerHTML = picks.map(pickCard).join('')
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

