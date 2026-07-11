document.getElementById('btn-close').addEventListener('click', () => window.battleLog.close())

document.getElementById('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('Delete all battle log entries?')) return
  await window.battleLog.clearAll()
})

window.battleLog.onData(({ battleLog, history }) => render(battleLog, history))

// Use event delegation for delete buttons and expand clicks
document.getElementById('log-list').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('.btn-delete')
  if (delBtn) {
    e.stopPropagation()
    await window.battleLog.deleteEntry(delBtn.dataset.date)
    return
  }
  const entry = e.target.closest('.log-entry.has-analysis')
  if (entry) entry.classList.toggle('expanded')
})

function render(battleLog = [], history = []) {
  const list = document.getElementById('log-list')

  // Merge: session history as base, enrich with AI analysis from battle log
  // Match by date proximity (within 3 minutes)
  const merged = history.map(h => {
    const hDate = new Date(h.date).getTime()
    const match = battleLog.find(b => Math.abs(new Date(b.date).getTime() - hDate) < 180000)
    return match ? { ...h, analysis: match.analysis } : h
  })

  // Also add any battle log entries not already matched (edge cases)
  for (const b of battleLog) {
    const bDate = new Date(b.date).getTime()
    const already = history.some(h => Math.abs(new Date(h.date).getTime() - bDate) < 180000)
    if (!already) merged.push(b)
  }

  // Sort newest first
  merged.sort((a, b) => new Date(b.date) - new Date(a.date))

  // Update clear-all button visibility
  document.getElementById('btn-clear-all').style.display = merged.length ? '' : 'none'

  if (!merged.length) {
    list.innerHTML = '<div id="empty-state">No games recorded yet.<br>Stats save automatically after each match.</div>'
    return
  }

  list.innerHTML = merged.map(entryHTML).join('')
}

function entryHTML(e) {
  const result   = e.result === 'Win' ? 'win' : e.result === 'Lose' ? 'lose' : 'none'
  const badge    = e.result === 'Win' ? 'W'   : e.result === 'Lose' ? 'L'   : '?'
  const pos      = { TOP:'Top', JUNGLE:'JG', MIDDLE:'Mid', BOTTOM:'Bot', UTILITY:'Sup' }[e.position] ?? (e.position ?? '')
  const kda      = `${e.kills ?? 0}/${e.deaths ?? 0}/${e.assists ?? 0}`
  const cspm     = e.cspm != null ? `${Number(e.cspm).toFixed(1)} cs/m`
                 : (e.cs != null && e.gameTime > 60 ? `${(e.cs / (e.gameTime / 60)).toFixed(1)} cs/m` : '')
  const dur      = fmtTime(e.gameTime ?? 0)
  const stats    = [cspm, dur].filter(Boolean).join(' · ')
  const date     = fmtDate(e.date)
  const hasAI    = !!e.analysis
  const hasResearch = !!e.matchupResearchUsed
  const analysis = hasAI
    ? e.analysis.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '<span class="no-analysis">No AI analysis for this game.</span>'

  return `<div class="log-entry${hasAI ? ' has-analysis' : ''}">
    <div class="entry-summary">
      <span class="result-badge ${result}">${badge}</span>
      <span class="entry-champ">${e.champion ?? '?'}</span>
      ${hasResearch ? '<span class="entry-research" title="Matchup research loaded — coaching was grounded in live search">✦</span>' : ''}
      <span class="entry-pos">${pos}</span>
      <span class="entry-kda">${kda}</span>
      <span class="entry-stats">${stats}</span>
      <span class="entry-date">${date}</span>
      ${hasAI ? '<span class="entry-chevron">▾</span>' : ''}
      <button class="btn-delete" data-date="${e.date}" title="Delete entry">✕</button>
    </div>
    ${hasAI ? `<div class="entry-analysis">${analysis}</div>` : ''}
  </div>`
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function fmtDate(iso) {
  if (!iso) return ''
  try {
    const d  = new Date(iso)
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const da = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${mo}/${da} ${hh}:${mm}`
  } catch { return '' }
}
