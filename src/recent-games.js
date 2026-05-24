document.getElementById('close-btn').addEventListener('click', () => window.recentGames.close())

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function render(games) {
  const list = document.getElementById('game-list')
  if (!games || !games.length) {
    list.innerHTML = '<div class="no-games">No games recorded yet</div>'
    return
  }

  list.innerHTML = games.map(g => {
    const result  = g.result === 'Win' ? 'win' : g.result === 'Lose' ? 'lose' : 'none'
    const badge   = g.result === 'Win' ? 'W' : g.result === 'Lose' ? 'L' : '?'
    const champ   = g.champion ?? '?'
    const pos     = g.position ? ` · ${g.position.slice(0,3)}` : ''
    const kda     = `${g.kills ?? 0}/${g.deaths ?? 0}/${g.assists ?? 0}`
    const cspm    = g.gameTime > 60 ? `${(g.cs / (g.gameTime / 60)).toFixed(1)} cs/m` : '—'
    const dur     = g.gameTime > 0 ? fmtTime(g.gameTime) : '—'
    return `
      <div class="game-row">
        <span class="badge ${result}">${badge}</span>
        <span class="champ">${champ}${pos}</span>
        <span class="kda">${kda}</span>
        <span class="cspm">${cspm}</span>
        <span class="dur">${dur}</span>
      </div>`
  }).join('')
}

window.recentGames.onData(render)
