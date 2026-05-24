const notifEl  = document.getElementById('notif')
const notifMsg = document.getElementById('notif-msg')

let hideTimer = null

const STYLES = {
  urgent:   { border: '#FF3B3B', text: '#ffaaaa', glow: 'rgba(255,59,59,0.55)',  dur: 4000 },
  warning:  { border: '#C89B3C', text: '#C8AA6E', glow: 'rgba(200,155,60,0.45)', dur: 3500 },
  ai:       { border: '#0BC4E3', text: '#7ee8f5', glow: 'rgba(11,196,227,0.45)', dur: 5000 },
  gameplan: { border: '#0BC4E3', text: '#7ee8f5', glow: 'rgba(11,196,227,0.45)', dur: 0 },
  normal:   { border: 'rgba(200,155,60,0.35)', text: '#C8AA6E', glow: 'none',    dur: 3000 },
}

window.notif.onNotif(({ msg, pri }) => {
  if (hideTimer) clearTimeout(hideTimer)

  const s = STYLES[pri] || STYLES.normal
  notifEl.style.borderTopColor = s.border
  notifMsg.style.color         = s.text
  notifMsg.style.textShadow    = s.glow !== 'none' ? `0 0 18px ${s.glow}` : ''
  notifMsg.textContent         = msg

  notifEl.classList.remove('show')
  requestAnimationFrame(() => requestAnimationFrame(() => notifEl.classList.add('show')))

  if (s.dur > 0) {
    hideTimer = setTimeout(() => notifEl.classList.remove('show'), s.dur)
  }
})

window.notif.onDismiss(() => {
  if (hideTimer) clearTimeout(hideTimer)
  notifEl.classList.remove('show')
})
