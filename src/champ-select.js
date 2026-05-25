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
let csState          = null   // latest full cs-update payload

window.cs.onUpdate(async (state) => {
  csState = state
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
    const data = await window.cs.getBuild(myLocked, position, csState?.myChampionId ?? 0)
    if (data?.error) {
      setBuildStatus(`Failed: ${data.error}`)
    } else if (data?.mostUsed) {
      buildData = data
      renderBuild()
    } else {
      setBuildStatus('No rune data from client')
    }
  } catch (e) {
    setBuildStatus(`Error: ${e.message}`)
  } finally {
    buildFetching = false
  }
}

function showBuildSection(show) {
  document.getElementById('build-section').classList.toggle('hidden', !show)
}

function setBuildStatus(msg) {
  const statusEl  = document.getElementById('build-status')
  const contentEl = document.getElementById('build-content')
  statusEl.textContent = msg
  statusEl.style.display  = msg ? '' : 'none'
  contentEl.classList.add('hidden')
}

function renderBuild() {
  if (!buildData) return
  const view = buildData[buildMode]
  if (!view) return

  document.getElementById('build-status').style.display = 'none'
  document.getElementById('build-content').classList.remove('hidden')

  // ── Runes ────────────────────────────────────────────────────────────────
  if (view.runes) {
    const r = view.runes
    const iconEl = document.getElementById('build-keystone-icon')
    if (r.keystoneIcon) {
      iconEl.src   = r.keystoneIcon
      iconEl.style.display = ''
    } else {
      iconEl.style.display = 'none'
    }
    document.getElementById('build-keystone-name').textContent = r.keystone
    document.getElementById('build-rune-trees').textContent    = `${r.primaryTree}  +  ${r.secondaryTree}`
    document.getElementById('build-rune-stats').textContent    =
      r.winRate ? `${r.winRate}% WR · ${r.pickRate.toLocaleString()} games` : ''
  }

  // ── Items ─────────────────────────────────────────────────────────────────
  const itemCol  = document.getElementById('build-item-col')
  const iconBox  = document.getElementById('build-item-icons')
  const nameBox  = document.getElementById('build-item-names')
  if (view.items?.ids?.length) {
    itemCol.style.display = ''
    document.getElementById('build-divider').style.display = ''
    const ver = buildData.ddVersion ?? '14.24.1'
    iconBox.innerHTML = view.items.ids.map((id, i) =>
      `<img class="item-icon"
        src="https://ddragon.leagueoflegends.com/cdn/${ver}/img/item/${id}.png"
        title="${view.items.names?.[i] ?? id}"
        onerror="this.outerHTML='<div class=\\'item-icon-ph\\'></div>'">`
    ).join('')
    nameBox.textContent = view.items.names?.join('  ·  ') ?? ''
  } else {
    itemCol.style.display = 'none'
    document.getElementById('build-divider').style.display = 'none'
  }

}

// ── Build toggle buttons (auto-apply on click) ────────────────────────────────
async function applyCurrentBuild(mode, btn) {
  if (!buildData) return
  const view = buildData[mode]
  if (!view) return

  btn.textContent = '⚡ Applying...'
  btn.disabled    = true

  const result = await window.cs.applyBuild({
    runes:       view.runes  ?? null,
    items:       view.items  ?? null,
    champName:   lastBuildChamp ?? 'Champion',
    champId:     csState?.myChampionId ?? 0,
    summonerId:  csState?.mySummonerId ?? 0,
    mode,
  })

  btn.disabled = false
  if (result?.ok) {
    btn.textContent = '✓ Applied'
    btn.classList.add('applied')
  } else {
    btn.textContent = '✗ Failed'
    btn.classList.add('error')
    console.warn('[apply-build]', result?.error)
  }
  setTimeout(() => {
    btn.textContent = btn.id === 'btn-most-used' ? 'Most Played' : 'Highest WR'
    btn.classList.remove('applied', 'error')
  }, 2500)
}

document.getElementById('btn-most-used').addEventListener('click', async function () {
  buildMode = 'mostUsed'
  this.classList.add('active')
  document.getElementById('btn-most-won').classList.remove('active')
  if (buildData) {
    renderBuild()
    await applyCurrentBuild('mostUsed', this)
  }
})

document.getElementById('btn-most-won').addEventListener('click', async function () {
  buildMode = 'mostWon'
  this.classList.add('active')
  document.getElementById('btn-most-used').classList.remove('active')
  if (buildData) {
    renderBuild()
    await applyCurrentBuild('mostWon', this)
  }
})
