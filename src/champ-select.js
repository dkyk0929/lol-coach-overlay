const POS_SHORT = {
  TOP: 'TOP', JUNGLE: 'JG', MIDDLE: 'MID', BOTTOM: 'BOT', UTILITY: 'SUP', '': '', UNKNOWN: ''
}

const PORTRAIT_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons'

let lastAIPromptKey = null
let aiPending       = false

window.cs.onUpdate(async (state) => {
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

  return `<div class="${rowClass}">
    ${portraitEl}
    <div class="player-info">
      <div class="name-line">
        <span class="${champClass}">${isMe ? '▶ ' : ''}${champText}</span>
        ${posPill}
      </div>
    </div>
  </div>`
}

// ── AI recommendations ─────────────────────────────────────────────────────────

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
    }
    return
  }

  const allyPicks = myTeam.filter(p => p.champion && !p.isMe).map(p => p.champion)
  const promptKey = `${position}|${allyPicks.join(',')}|${enemyPicks.join(',')}|${bans.join(',')}`
  if (promptKey === lastAIPromptKey) return
  lastAIPromptKey = promptKey

  const el = document.getElementById('ai-content')
  el.className   = 'loading'
  el.style.color = ''
  el.textContent = '✦ Asking AI for picks...'

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
      el.className   = ''
      el.style.color = '#7ee8f5'
      el.textContent = '✦ ' + result
    } else {
      el.className   = 'waiting'
      el.textContent = 'AI unavailable — set API key in HUD'
    }
  } catch {
    el.className   = 'waiting'
    el.textContent = 'Could not reach AI'
  } finally {
    aiPending = false
  }
}
