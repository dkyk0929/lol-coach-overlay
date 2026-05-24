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

// ── Build state ───────────────────────────────────────────────────────────────
let buildData        = null   // { mostUsed, mostWon, totalGames, patch, ddVersion }
let buildMode        = 'mostUsed'  // 'mostUsed' | 'mostWon'
let buildFetching    = false
let lastBuildChamp   = null   // prevent re-fetching same champ

window.cs.onUpdate(async (state) => {
  renderHeader(state)
  renderTeams(state)
  maybeRequestAI(state)
  maybeRequestBuild(state)
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

// ── Build fetcher ─────────────────────────────────────────────────────────────
async function maybeRequestBuild({ myLocked, position }) {
  if (!myLocked) return
  if (buildFetching) return
  if (myLocked === lastBuildChamp) return   // already fetched for this champ

  lastBuildChamp = myLocked
  buildData      = null
  buildMode      = 'mostUsed'
  showBuildSection(true)
  setBuildStatus('Fetching build data...')

  buildFetching = true
  try {
    const data = await window.cs.getBuild(myLocked, position)
    buildData = data
    if (data) {
      renderBuild()
    } else {
      setBuildStatus('Build data unavailable')
    }
  } catch {
    setBuildStatus('Could not fetch build')
  } finally {
    buildFetching = false
  }
}

function showBuildSection(show) {
  document.getElementById('build-section').classList.toggle('hidden', !show)
}

function setBuildStatus(msg) {
  document.getElementById('build-status').textContent = msg
  document.getElementById('build-status').style.display = msg ? '' : 'none'
  document.getElementById('build-runes').classList.add('hidden')
  document.getElementById('build-items').classList.add('hidden')
  document.getElementById('btn-apply-runes').classList.add('hidden')
}

function renderBuild() {
  if (!buildData) return

  const view = buildData[buildMode]
  if (!view) return

  // Clear status
  document.getElementById('build-status').style.display = 'none'

  // Runes
  const runeEl = document.getElementById('build-runes')
  if (view.runes) {
    document.getElementById('build-keystone').textContent  = view.runes.keystone
    document.getElementById('build-secondary').textContent = view.runes.secondaryTree
    document.getElementById('build-wr').textContent        = `${view.runes.winRate}% WR`
    runeEl.classList.remove('hidden')

    const applyBtn = document.getElementById('btn-apply-runes')
    applyBtn.textContent = 'Apply Runes'
    applyBtn.className   = ''     // reset any applied/error state
    applyBtn.classList.remove('hidden')
  } else {
    runeEl.classList.add('hidden')
    document.getElementById('btn-apply-runes').classList.add('hidden')
  }

  // Items
  const itemsEl = document.getElementById('build-items')
  const listEl  = document.getElementById('build-item-list')
  if (view.items?.ids?.length) {
    const ver = buildData.ddVersion ?? '14.24.1'
    listEl.innerHTML = view.items.ids.map((id, i) => {
      const name = view.items.names?.[i] ?? `#${id}`
      const sep  = i < view.items.ids.length - 1 ? '<span class="item-sep">›</span>' : ''
      return `<img class="item-icon"
        src="https://ddragon.leagueoflegends.com/cdn/${ver}/img/item/${id}.png"
        title="${name}"
        onerror="this.outerHTML='<div class=\\'item-icon-placeholder\\'>${i+1}</div>'"
      >${sep}`
    }).join('')
    itemsEl.classList.remove('hidden')
  } else {
    itemsEl.classList.add('hidden')
  }
}

// ── Build toggle buttons ──────────────────────────────────────────────────────
document.getElementById('btn-most-used').addEventListener('click', () => {
  buildMode = 'mostUsed'
  document.getElementById('btn-most-used').classList.add('active')
  document.getElementById('btn-most-won').classList.remove('active')
  if (buildData) renderBuild()
})

document.getElementById('btn-most-won').addEventListener('click', () => {
  buildMode = 'mostWon'
  document.getElementById('btn-most-won').classList.add('active')
  document.getElementById('btn-most-used').classList.remove('active')
  if (buildData) renderBuild()
})

// ── Apply runes button ────────────────────────────────────────────────────────
document.getElementById('btn-apply-runes').addEventListener('click', async () => {
  if (!buildData) return
  const view = buildData[buildMode]
  if (!view?.runes) return

  const btn = document.getElementById('btn-apply-runes')
  btn.textContent = 'Applying...'
  btn.disabled    = true

  const champName = lastBuildChamp ?? 'Champion'
  const label     = buildMode === 'mostUsed' ? 'Popular' : 'High WR'
  const result    = await window.cs.applyRunes({
    ids:            view.runes.ids,
    primaryStyleId: view.runes.primaryStyleId,
    subStyleId:     view.runes.subStyleId,
    name:           `Coach: ${champName} (${label})`,
  })

  if (result?.ok) {
    btn.textContent = '✓ Applied!'
    btn.classList.add('applied')
  } else {
    btn.textContent = `✗ ${result?.error ?? 'Failed'}`
    btn.classList.add('error')
  }
  btn.disabled = false
  setTimeout(() => {
    btn.textContent = 'Apply Runes'
    btn.classList.remove('applied', 'error')
  }, 3000)
})
