document.getElementById('btn-close').addEventListener('click', () => window.postGame.close())

window.postGame.onData(async (d) => {
  renderHeader(d)
  renderEvents(d)
  await requestAnalysis(d)
})

function renderHeader({ result, champion, position, kills, deaths, assists, cspm, gameTime, allyDrakes, enemyDrakes }) {
  const badge = document.getElementById('result-badge')
  if (result === 'Win') {
    badge.textContent = '🏆 VICTORY'
    badge.className = 'win'
  } else if (result === 'Lose') {
    badge.textContent = '💀 DEFEAT'
    badge.className = 'lose'
  } else {
    badge.textContent = 'GAME OVER'
    badge.className = 'unknown'
  }

  const pos = { TOP:'Top', JUNGLE:'JG', MIDDLE:'Mid', BOTTOM:'Bot', UTILITY:'Sup' }[position] ?? position ?? '?'
  document.getElementById('champ-label').textContent = `${champion ?? '?'} · ${pos}`

  const dur = fmtTime(gameTime)
  const drakeStr = ` · Drakes ${allyDrakes}–${enemyDrakes}`
  document.getElementById('stats-label').textContent =
    `${kills}/${deaths}/${assists}  ·  ${cspm} CS/min${drakeStr}  ·  ${dur}`
}

function renderEvents({ alertLogFull }) {
  if (!alertLogFull?.length) return
  // Exclude objective timer alerts (grub/baron spawn reminders) — those are
  // in-game prompts, not meaningful key events worth showing in a recap
  const urgent = alertLogFull
    .filter(a => a.pri === 'urgent' && a.cat !== 'objective')
    .slice(0, 5)
  if (!urgent.length) return
  const el = document.getElementById('events-label')
  el.textContent = 'KEY EVENTS: ' + urgent.map(a => {
    const t = fmtTime(a.time)
    return `${t} ${a.msg.replace(/[🐛🐉🟣⚔⚠✅📍🗡🔥🛡👁💀⚡✦●]/gu, '').trim()}`
  }).join('  ·  ')
}

async function requestAnalysis(d) {
  const el = document.getElementById('analysis-text')
  el.className = 'loading'
  el.textContent = '✦ Analyzing your game...'

  const { result, champion, position, kills, deaths, assists, cspm, gameTime,
          allyDrakes, enemyDrakes, allyTeam, enemyTeam, isARAM, alertLogFull } = d

  const pos     = position ?? 'unknown'
  const phase   = gameTime < 1200 ? 'early' : gameTime < 2100 ? 'mid' : 'late'
  // Exclude objective timer reminders from key events sent to AI — same as display filter
  const urgents = (alertLogFull ?? [])
    .filter(a => a.pri === 'urgent' && a.cat !== 'objective')
    .map(a => a.msg.replace(/[^\w\s·\-]/gu, '').trim())
    .slice(0, 6)

  const resultKnown   = result === 'Win' || result === 'Lose'
  const outcomeWord   = result === 'Win' ? 'won' : 'lost'
  const closingPrompt = resultKnown
    ? `In 3-4 sentences, explain the main reason we ${outcomeWord} and the top 1-2 things to improve. Be specific. Reference champions and stats.`
    : `Game result was not captured. Do NOT guess or assume the outcome — do not say "you won" or "you lost". In 3-4 sentences, analyze the performance based on the stats and give the top 1-2 specific improvements.`

  const lines = [
    `Game result: ${result ?? 'UNKNOWN — do not assume win or loss'}`,
    `My champion: ${champion ?? '?'} (${pos}) — ${phase} game ended at ${fmtTime(gameTime)}`,
    `KDA: ${kills}/${deaths}/${assists} | CS/min: ${cspm}`,
    isARAM ? 'Game mode: ARAM' : `Drakes: Ally ${allyDrakes} vs Enemy ${enemyDrakes}`,
    allyTeam?.length  ? `Ally team:  ${allyTeam.join(', ')}` : '',
    enemyTeam?.length ? `Enemy team: ${enemyTeam.join(', ')}` : '',
    urgents.length    ? `Key events: ${urgents.join(' | ')}` : '',
    closingPrompt,
  ].filter(Boolean)

  try {
    const analysis = await window.postGame.aiAnalysis(lines.join('\n'))
    if (analysis) {
      const clean = analysis.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').trim()
      el.className = ''
      el.textContent = clean
      // Persist to battle log
      window.postGame.saveLog({ ...d, analysis: clean })
    } else {
      // No API key — show a rule-based summary
      const fallback = buildFallbackAnalysis(d)
      el.className = 'no-ai'
      el.textContent = fallback
      window.postGame.saveLog({ ...d, analysis: fallback })
    }
  } catch {
    el.className = 'no-ai'
    el.textContent = 'Could not reach AI for analysis.'
  }
}

function buildFallbackAnalysis({ result, champion, position, kills, deaths, assists, cspm, gameTime, allyDrakes, enemyDrakes, isARAM }) {
  const outcome  = result === 'Win' ? 'won' : result === 'Lose' ? 'lost' : 'finished (result not captured)'
  const csRate   = parseFloat(cspm)
  const parts    = []

  parts.push(`You ${outcome} as ${champion ?? 'your champion'} — ${kills}/${deaths}/${assists} KDA in ${fmtTime(gameTime)}.`)

  if (!isARAM && position !== 'UTILITY' && position !== 'JUNGLE') {
    const csGrade = csRate >= 7.5 ? 'excellent' : csRate >= 6 ? 'solid' : csRate >= 4.5 ? 'average' : 'below average'
    parts.push(`CS rate: ${cspm}/min (${csGrade}).`)
  }

  if (!isARAM) {
    if (allyDrakes > enemyDrakes)       parts.push(`Team controlled Dragon (${allyDrakes}–${enemyDrakes}).`)
    else if (enemyDrakes > allyDrakes)  parts.push(`Enemy had Dragon advantage (${enemyDrakes}–${allyDrakes}).`)
  }

  if (deaths >= 7)
    parts.push('High death count — safer positioning and knowing when to disengage will help.')
  else if (csRate < 5 && position !== 'UTILITY' && position !== 'JUNGLE' && !isARAM)
    parts.push('CS rate needs work — prioritize wave management over trading.')
  else if (result === 'Win' && kills + assists >= deaths * 2)
    parts.push('Positive KDA contributed to the win — keep it up.')

  parts.push('Add an API key in the AI Setup panel for detailed coaching.')
  return parts.join(' ')
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
