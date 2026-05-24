const ttsBtnEl = document.getElementById('tts-btn')

// ── Init state ────────────────────────────────────────────────────────────────
async function init() {
  const state = await window.ctrl.getState()
  applyState(state)
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

document.getElementById('log-btn').addEventListener('click',    () => window.ctrl.openLog())
document.getElementById('ai-btn').addEventListener('click',     () => window.ctrl.openAI())
document.getElementById('coffee-btn').addEventListener('click', () => window.ctrl.openUrl('https://buymeacoffee.com/bdannykimt'))
document.getElementById('close-btn').addEventListener('click',  () => window.ctrl.close())

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.ctrl.close()
})

init()
