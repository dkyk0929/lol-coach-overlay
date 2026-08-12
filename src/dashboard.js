const $ = (id) => document.getElementById(id)

document.getElementById('btn-close').addEventListener('click', () => window.dashboard.close())

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

window.dashboard.onData((data) => {
  const waitingEl = $('waiting-msg')
  const contentEl = $('content')

  if (!data?.running) {
    waitingEl.classList.remove('hidden')
    contentEl.classList.add('hidden')
    return
  }
  waitingEl.classList.add('hidden')
  contentEl.classList.remove('hidden')

  $('jg-text').textContent = data.jgLine || 'detecting…'
  $('jg-text').style.color = data.jgColor || ''

  $('cs-text').textContent = data.csText || '—'
  $('cs-text').style.color = data.csColor || ''
  $('wave-text').textContent = data.waveTrend || ''
  const goldParts = []
  if (data.goldText) goldParts.push(data.goldText)
  if (data.objCountdown) goldParts.push(data.objCountdown)
  if (data.allyDrakes != null || data.enemyDrakes != null) {
    goldParts.push(`🐉 ${data.allyDrakes ?? 0}·${data.enemyDrakes ?? 0}`)
  }
  $('gold-text').textContent = goldParts.join('  ·  ')
  $('gold-text').style.color = data.goldColor || ''

  $('focus-text').textContent = data.focusText || ''
  $('focus-text').style.color = data.focusColor || ''

  const allinCard = $('allin-card')
  if (data.allIn) {
    $('allin-text').textContent = '⚔ ' + data.allIn
    allinCard.classList.remove('hidden')
  } else {
    allinCard.classList.add('hidden')
  }

  const feedList = $('feed-list')
  const alerts = data.alerts ?? []
  feedList.innerHTML = alerts.map(a => `
    <div class="feed-row pri-${a.pri || 'normal'}">
      <span class="feed-time">${fmtClock(a.time)}</span>
      <span class="feed-msg">${escapeHtml(a.msg)}</span>
    </div>`).join('')
})
