// ── DOM refs ─────────────────────────────────────────────────────────────────
const statusBar  = document.getElementById('status-bar')
const statusDot  = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const keyInput   = document.getElementById('key-input')
const saveBtn    = document.getElementById('save-btn')
const keyLabel   = document.getElementById('key-label')
const feedback   = document.getElementById('save-feedback')
const closeBtn   = document.getElementById('close-btn')

// ── Close button ──────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => window.aiSetup.close())

// ── Link: open console.anthropic.com ─────────────────────────────────────────
document.querySelectorAll('.link').forEach(el => {
  el.addEventListener('click', () => window.aiSetup.openUrl('https://console.anthropic.com'))
})

// ── Init: check current status ───────────────────────────────────────────────
async function init() {
  const { hasKey } = await window.aiSetup.getStatus()
  setStatus(hasKey)
}

function setStatus(hasKey) {
  if (hasKey) {
    statusBar.className = 'enabled'
    statusDot.textContent = '●'
    statusText.textContent = 'AI ENABLED'
    keyLabel.textContent = 'Key saved — paste a new key below to update'
    keyInput.placeholder = 'Paste new sk-ant-... key to update'
  } else {
    statusBar.className = 'disabled'
    statusDot.textContent = '●'
    statusText.textContent = 'AI NOT ACTIVE'
    keyLabel.textContent = ''
    keyInput.placeholder = 'Paste sk-ant-... key here'
  }
  showFeedback('', '')
  keyInput.value = ''
  keyInput.classList.remove('error')
}

// ── Save key ──────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const key = keyInput.value.trim()
  if (!key) {
    showFeedback('Enter your API key first', 'error')
    keyInput.classList.add('error')
    return
  }
  if (!key.startsWith('sk-ant-')) {
    showFeedback('Invalid key — must start with sk-ant-', 'error')
    keyInput.classList.add('error')
    return
  }

  saveBtn.disabled = true
  saveBtn.textContent = '...'
  const res = await window.aiSetup.saveKey(key)
  saveBtn.disabled = false
  saveBtn.textContent = 'SAVE'

  if (res && res.success) {
    showFeedback('Key verified and saved! AI coaching is now active.', 'success')
    setStatus(true)
  } else {
    const errMsg = res && res.error ? res.error : 'Failed to save key — try again'
    showFeedback(`Error: ${errMsg}`, 'error')
    keyInput.classList.add('error')
  }
})

keyInput.addEventListener('input', () => {
  keyInput.classList.remove('error')
  showFeedback('', '')
})

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click()
  if (e.key === 'Escape') window.aiSetup.close()
})

function showFeedback(msg, type) {
  feedback.textContent = msg
  feedback.className = type || ''
}

init()
