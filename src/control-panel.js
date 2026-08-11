const ttsBtnEl = document.getElementById('tts-btn')

// ── Init state ────────────────────────────────────────────────────────────────
async function init() {
  const state = await window.ctrl.getState()
  applyState(state)
  const { hasSecondDisplay } = await window.ctrl.getDisplayInfo()
  if (hasSecondDisplay) {
    document.getElementById('dashboard-btn').classList.remove('hidden')
    const autoBtn = document.getElementById('dashboard-autostart-btn')
    autoBtn.classList.remove('hidden')
    const autoStart = await window.ctrl.getDashboardAutoStart()
    autoBtn.textContent = `AUTO-START: ${autoStart ? 'ON' : 'OFF'}`
    let autoStartOn = autoStart   // tracked as a boolean, not sniffed back out of textContent
    autoBtn.addEventListener('click', async () => {
      autoStartOn = await window.ctrl.setDashboardAutoStart(!autoStartOn)
      autoBtn.textContent = `AUTO-START: ${autoStartOn ? 'ON' : 'OFF'}`
    })
  }
}

function applyState({ ttsMuted }) {
  if (ttsMuted) {
    ttsBtnEl.textContent = '🔇 VOICE OFF'
    ttsBtnEl.classList.add('muted')
  } else {
    ttsBtnEl.textContent = '🔊 VOICE ON'
    ttsBtnEl.classList.remove('muted')
  }
}

window.ctrl.onStateChange(applyState)

// ── Buttons ───────────────────────────────────────────────────────────────────
ttsBtnEl.addEventListener('click', async () => {
  const state = await window.ctrl.ttsToggle()
  applyState(state)
})

document.getElementById('log-btn').addEventListener('click',       () => window.ctrl.openLog())
document.getElementById('ai-btn').addEventListener('click',        () => window.ctrl.openAI())
document.getElementById('coffee-btn').addEventListener('click',    () => window.ctrl.openUrl('https://buymeacoffee.com/bdannykimt'))
document.getElementById('close-btn').addEventListener('click',     () => window.ctrl.close())
document.getElementById('dashboard-btn').addEventListener('click', () => {
  window.ctrl.switchToDashboard()
  window.ctrl.close()
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.ctrl.close()
})

init()
